import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { execFile, spawnSync } from 'node:child_process';
import { loadSidecarSdk } from './sdk.mjs';
import { platformPaths } from '../../compat/platform.mjs';
import { PreferencesStore, DEFAULT_PREFERENCES } from '../../compat/preferences.mjs';
import { SidecarOwner } from '../../compat/sidecar-owner.mjs';
import { RuntimeGlassEngine } from '../../compat/runtime-glass.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER_FILE = join(HERE, '..', '..', 'compat', 'glass-renderer.cjs');
const PATCH_LOADER_FILE = join(HERE, '..', '..', 'compat', 'patch-loader.py');
const preferences = new PreferencesStore();
const ownership = process.env.ANTIGRAVITY_SIDECAR_WEB_PORT ? new SidecarOwner(platformPaths().data) : null;

function isPluginEnabledInHostConfig() {
  try {
    const cfgPath = join(homedir(), '.gemini', 'config', 'config.json');
    const parsed = JSON.parse(readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));
    if (parsed?.plugins?.['antigravity-glass']?.enabled === false) return false;
  } catch {}
  return true;
}

function resolvePythonBin() {
  if (process.env.PYTHON_PATH) {
    const custom = process.env.PYTHON_PATH.trim();
    if (custom) {
      if (existsSync(custom)) return custom;
      try {
        const res = spawnSync(custom, ['--version'], { windowsHide: true, timeout: 2000 });
        if (res.status === 0) return custom;
      } catch {}
    }
  }

  const standardWinPaths = [];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const pyRoot = join(process.env.LOCALAPPDATA, 'Programs', 'Python');
    if (existsSync(pyRoot)) {
      try {
        const entries = readdirSync(pyRoot, { withFileTypes: true });
        for (const entry of entries.sort((a, b) => b.name.localeCompare(a.name))) {
          if (entry.isDirectory() && entry.name.toLowerCase().startsWith('python')) {
            const exe = join(pyRoot, entry.name, 'python.exe');
            if (existsSync(exe)) standardWinPaths.push(exe);
          }
        }
      } catch {}
    }
    for (const ver of ['Python313', 'Python312', 'Python311', 'Python310']) {
      const fallback = join(process.env.LOCALAPPDATA, 'Programs', 'Python', ver, 'python.exe');
      if (existsSync(fallback) && !standardWinPaths.includes(fallback)) {
        standardWinPaths.push(fallback);
      }
    }
  }

  const candidates = ['python', 'python3', 'py', ...standardWinPaths];
  for (const c of candidates) {
    if (c.includes('/') || c.includes('\\')) {
      if (existsSync(c)) return c;
    } else {
      try {
        const res = spawnSync(c, ['--version'], { windowsHide: true, timeout: 2000 });
        if (res.status === 0) return c;
      } catch {}
    }
  }

  return 'python';
}

function ensureAsarPatched() {
  if (!isPluginEnabledInHostConfig()) return;
  const py = resolvePythonBin();
  execFile(py, [PATCH_LOADER_FILE, '--apply'], { windowsHide: true, timeout: 45000 }, () => {});
}

const engine = new RuntimeGlassEngine({
  preferences,
  get rendererCode() {
    return readFileSync(RENDERER_FILE, 'utf8');
  },
  owner: ownership?.token || null,
  owns: () => (ownership ? ownership.isOwner() : true),
  enabled: async () => isPluginEnabledInHostConfig(),
});

ensureAsarPatched();

const readLocal = name => readFileSync(join(HERE, name), 'utf8');

async function handlePreferencesUpdate(patch) {
  const result = await preferences.set(patch || {});
  await engine.broadcastConfig(result.config);
  return { ...result, health: engine.health };
}

async function handlePreferencesReset() {
  const result = await preferences.set({ ...DEFAULT_PREFERENCES, keepCustomValues: false });
  await engine.broadcastConfig(result.config);
  return { ...result, health: engine.health };
}

if (process.env.ANTIGRAVITY_SIDECAR_WEB_PORT) {
  const { SidecarApp, Response } = await loadSidecarSdk();
  if (!(await ownership.claim())) process.exit(0);

  const app = new SidecarApp();
  app.page('/', () => readLocal('index.html'));
  app.page('/app.js', () => readLocal('app.js'));
  app.api('/styles.css', () => new Response(readLocal('styles.css'), { contentType: 'text/css; charset=utf-8' }), 'GET');

  app.api('/api/state', async () => ({
    ...(await preferences.snapshot()),
    health: engine.health,
  }), 'GET');

  app.api('/api/preferences', async data => {
    try {
      if (data?.action === 'reset') return await handlePreferencesReset();
      return await handlePreferencesUpdate(data);
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 400, contentType: 'application/json' });
    }
  }, 'POST');

  app.run();
  engine.start();

  const shutdown = async () => {
    const exitTimer = setTimeout(() => process.exit(0), 2000);
    exitTimer.unref();
    await engine.stop();
    ownership.stop();
    process.exit(0);
  };
  ownership.watch(shutdown);
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, () => { void shutdown(); });
  }
} else {
  // Standalone local daemon / preview server when launched outside Sidecar host
  const port = Number(process.env.AG_GLASS_PORT || 17895);
  engine.start();

  const server = createServer(async (req, res) => {
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const url = new URL(req.url, `http://${host}`);
    res.setHeader('Cache-Control', 'no-store');

    if (url.pathname === '/api/state' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ...(await preferences.snapshot()), health: engine.health }));
      return;
    }

    if (url.pathname === '/api/preferences' && req.method === 'POST') {
      let body = '';
      try {
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 524288) throw new Error('Payload too large');
        }
        const data = JSON.parse(body || '{}');
        const out = data?.action === 'reset' ? await handlePreferencesReset() : await handlePreferencesUpdate(data);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(out));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (url.pathname === '/preload.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end('// Standalone mode');
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readLocal('index.html'));
      return;
    }
    if (url.pathname === '/app.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(readLocal('app.js'));
      return;
    }
    if (url.pathname === '/styles.css') {
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      res.end(readLocal('styles.css'));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`Antigravity Glass Studio running at http://127.0.0.1:${port}`);
  });
}
