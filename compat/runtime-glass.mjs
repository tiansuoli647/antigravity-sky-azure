// Runtime CDP injector & live bridge for Antigravity Glass Studio.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { platformPaths } from './platform.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const UNDERLAY_SCRIPT = join(HERE, 'acrylic-underlay.ps1');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const BINDING = '__agGlassRuntimeCallV1';
let underlayProc = null;
let lastUnderlaySpawnAt = 0;

export function applyNativeDesktopSeeThrough(config = {}) {
  if (process.platform !== 'win32') return;
  try {
    const enabled = config.enabled !== false;
    const bgOp = Math.min(85, Math.max(0, Number.isFinite(Number(config.bgOpacity)) ? Number(config.bgOpacity) : 22));
    // Calibrated for DWM Acrylic Gaussian Blur underlay: default bgOp=22 -> alpha=168 (~66% Sky-Azure UI + ~34% DWM Gaussian-blurred backdrop)
    const alphaByte = enabled ? Math.round(145 + (bgOp / 85) * 85) : 255;
    const enInt = enabled ? 1 : 0;

    // 1. Write live state file for the singleton AgAcrylicUnderlay daemon
    const localAppData = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Local');
    const stateDir = join(localAppData, 'AntigravityGlass');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, 'underlay-state.txt'), `${enInt}|${alphaByte}`, 'utf8');

    // 2. Ensure the singleton DWM Acrylic Underlay daemon is running on the Default desktop
    const now = Date.now();
    if (!underlayProc && now - lastUnderlaySpawnAt > 8000) {
      lastUnderlaySpawnAt = now;
      const psExe = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const child = spawn(psExe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', UNDERLAY_SCRIPT], {
        windowsHide: true,
        stdio: 'ignore',
      });
      underlayProc = child;
      child.on('error', err => {
        underlayProc = null;
        try { writeFileSync(join(stateDir, 'underlay-spawn.log'), `ERR: ${err.message}\n`, 'utf8'); } catch {}
      });
      child.on('exit', (code, sig) => {
        underlayProc = null;
        try { writeFileSync(join(stateDir, 'underlay-spawn.log'), `EXIT: code=${code} sig=${sig} at ${new Date().toISOString()}\n`, 'utf8'); } catch {}
      });
      child.unref();
    }
  } catch (err) {
    try {
      const localAppData = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Local');
      writeFileSync(join(localAppData, 'AntigravityGlass', 'underlay-spawn.log'), `CATCH: ${err.message}\n`, 'utf8');
    } catch {}
  }
}

export function validTarget(target, port) {
  try {
    const page = new URL(target.url);
    const ws = new URL(target.webSocketDebuggerUrl);
    return (
      target.type === 'page' &&
      ['http:', 'https:'].includes(page.protocol) &&
      LOOPBACK.has(page.hostname) &&
      ws.protocol === 'ws:' &&
      LOOPBACK.has(ws.hostname) &&
      Number(ws.port) === port
    );
  } catch {
    return false;
  }
}

function jsonGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET' }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
        if (body.length > 1048576) req.destroy(new Error('Discovery response too large'));
      });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) throw new Error('Renderer discovery unavailable');
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('Renderer discovery timeout')));
    req.end();
  });
}

export async function discoverTargets(profile = platformPaths().profile) {
  const text = await readFile(join(profile, 'DevToolsActivePort'), 'utf8');
  if (text.length > 1024) throw new Error('Invalid renderer discovery file');
  const port = Number(text.split(/\r?\n/)[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid renderer port');
  const targets = await jsonGet(port, '/json/list');
  if (!Array.isArray(targets)) throw new Error('Invalid renderer discovery response');
  return targets.filter(target => validTarget(target, port));
}

export class CdpConnection {
  constructor(url, { WebSocketImpl = globalThis.WebSocket, timeout = 5000, onEvent = () => {}, onClose = () => {} } = {}) {
    this.url = url;
    this.WebSocketImpl = WebSocketImpl;
    this.timeout = timeout;
    this.onEvent = onEvent;
    this.onClose = onClose;
    this.pending = new Map();
    this.nextId = 0;
    this.closed = false;
  }

  async open() {
    if (!this.WebSocketImpl) throw new Error('This Node runtime has no WebSocket support');
    this.ws = new this.WebSocketImpl(this.url);
    this.ws.addEventListener('message', event => {
      try {
        if (typeof event.data !== 'string' || event.data.length > 2097152) return;
        const message = JSON.parse(event.data);
        if (message.id) {
          const item = this.pending.get(message.id);
          if (!item) return;
          this.pending.delete(message.id);
          clearTimeout(item.timer);
          if (message.error) item.reject(new Error('Renderer command failed: ' + message.error.code));
          else item.resolve(message.result || {});
        } else if (message.method) {
          this.onEvent(message);
        }
      } catch {}
    });
    this.ws.addEventListener('close', () => this.disconnect());
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close();
        reject(new Error('Renderer connection timeout'));
      }, this.timeout);
      this.ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.ws.addEventListener('error', () => {
        clearTimeout(timer);
        this.close();
        reject(new Error('Renderer connection failed'));
      }, { once: true });
    });
    return this;
  }

  command(method, params = {}) {
    if (this.closed || this.ws?.readyState !== 1) return Promise.reject(new Error('Renderer disconnected'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Renderer command timeout'));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  disconnect() {
    if (this.closed) return;
    this.closed = true;
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error('Renderer disconnected'));
    }
    this.pending.clear();
    this.onClose();
  }

  close() {
    this.disconnect();
    this.ws?.close();
  }
}

function rendererBridge(binding) {
  if (window !== window.top) return;
  if (window.__agGlassRuntimeBridge && window.agGlassHost) return;
  window.__agGlassRuntimeBridge?.dispose();
  const pending = new Map();
  let sequence = 0;
  const call = (type, input) =>
    new Promise(resolve => {
      if (pending.size >= 8) {
        resolve({});
        return;
      }
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({});
      }, 10000);
      pending.set(id, { resolve, timer });
      try {
        window[binding](JSON.stringify({ id, type, input }));
      } catch {
        clearTimeout(timer);
        pending.delete(id);
        resolve({});
      }
    });

  window.__agGlassRuntimeBridge = {
    binding,
    resolve(id, result) {
      const item = pending.get(id);
      if (!item) return;
      clearTimeout(item.timer);
      pending.delete(id);
      item.resolve(result);
    },
    dispose() {
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.resolve({});
      }
      pending.clear();
      delete window.__agGlassRuntimeBridge;
    },
  };

  window.agGlassHost = {
    getPreferences: () => call('getPreferences', {}),
    setPreferences: input => call('setPreferences', input),
  };
}

export function makeGlassRendererSource(rendererCode, initialConfig = {}, owner = null, generation = 0) {
  const prefix = 'module.exports = ';
  const idx = rendererCode.indexOf(prefix);
  if (idx < 0) throw new Error('Glass renderer source format invalid');
  const fnBody = rendererCode.slice(idx + prefix.length).trim().replace(/;$/, '');
  const version = createHash('sha256')
    .update(rendererCode + rendererBridge.toString() + JSON.stringify(owner))
    .digest('hex');

  const binding = owner ? `${BINDING}_${owner.replaceAll('-', '')}` : BINDING;
  const upgrade = `if(window.__agGlassRuntimeVersion!==${JSON.stringify(version)}){window.__agGlassDispose?.();window.__agGlassRuntimeBridge?.dispose();delete window.agGlassHost;window.__agGlassRuntimeVersion=${JSON.stringify(version)};}`;
  const initCfg = `window.__agGlassInitialConfig=${JSON.stringify(initialConfig)};`;
  const code =
    `${upgrade}` +
    `window.__agGlassRuntimeOwner=${JSON.stringify(owner)};` +
    `${initCfg}` +
    `(${rendererBridge.toString()})(${JSON.stringify(binding)});` +
    `(${fnBody})();`;

  return owner
    ? `if(!window.__agGlassRuntimeRank||window.__agGlassRuntimeRank[0]<=${generation}){window.__agGlassRuntimeRank=[${generation},${JSON.stringify(owner)}];${code}}`
    : code;
}

export class RuntimeGlassEngine {
  constructor({
    preferences,
    rendererCode,
    profile = platformPaths().profile,
    dataDir = platformPaths().data,
    owner = null,
    owns = async () => true,
    enabled = async () => true,
    interval = 3000,
  } = {}) {
    this.preferences = preferences;
    this.rendererCode = rendererCode;
    this.profile = profile;
    this.dataDir = dataDir;
    this.owner = owner;
    this.owns = owns;
    this.enabled = enabled;
    this.interval = interval;
    this.sessions = new Map();
    this.running = false;
    this.binding = owner ? `${BINDING}_${owner.replaceAll('-', '')}` : BINDING;
    this.health = { state: 'waiting', windows: 0, message: 'Waiting for Antigravity host renderer' };
  }

  async setHealth(state, message) {
    this.health = { state, windows: this.sessions.size, message, checkedAt: new Date().toISOString() };
    if (this.dataDir && (await this.owns())) {
      try {
        await mkdir(this.dataDir, { recursive: true });
        await writeFile(join(this.dataDir, 'glass-state.json'), JSON.stringify(this.health, null, 2));
      } catch {}
    }
  }

  async buildSource() {
    const config = await this.preferences.get();
    return makeGlassRendererSource(this.rendererCode, config, this.owner, Date.now());
  }

  async onEvent(connection, message) {
    if (this.stopping || !(await this.owns())) return;
    const p = message.params || {};
    if (message.method === 'Runtime.executionContextCreated') {
      if (p.context?.auxData?.isDefault && p.context.auxData.frameId === connection.frameId && p.context.origin === connection.origin) {
        connection.contexts.add(p.context.id);
      }
      return;
    }
    if (message.method === 'Runtime.executionContextsCleared') {
      connection.contexts.clear();
      return;
    }
    if (message.method === 'Runtime.executionContextDestroyed') {
      connection.contexts.delete(p.executionContextId);
      return;
    }
    if (message.method !== 'Runtime.bindingCalled' || p.name !== this.binding || !connection.contexts.has(p.executionContextId)) {
      return;
    }
    if (typeof p.payload !== 'string' || p.payload.length > 65536) return;
    let payload;
    try {
      payload = JSON.parse(p.payload);
    } catch {
      return;
    }
    try {
      let result = {};
      if (payload.type === 'getPreferences') {
        result = await this.preferences.snapshot();
      } else if (payload.type === 'setPreferences') {
        result = await this.preferences.set(payload.input || {});
        await this.broadcastConfig(result.config);
      }
      await connection.command('Runtime.evaluate', {
        expression: `window.__agGlassRuntimeBridge?.resolve(${Number(payload.id)}, ${JSON.stringify(result)})`,
        contextId: p.executionContextId,
      });
    } catch {}
  }

  async attach(target) {
    const connection = new CdpConnection(target.webSocketDebuggerUrl, {
      onEvent: msg => { void this.onEvent(connection, msg); },
    });
    connection.origin = new URL(target.url).origin;
    connection.contexts = new Set();
    try {
      await connection.open();
      if (this.stopping || !(await this.owns())) throw new Error('Ownership changed');
      const frame = await connection.command('Page.getFrameTree');
      connection.frameId = frame.frameTree?.frame?.id;
      if (!connection.frameId) throw new Error('Main renderer frame unavailable');

      // Force Chromium compositor root background color to full alpha transparency
      try {
        await connection.command('Emulation.setDefaultBackgroundColorOverride', {
          color: { r: 224, g: 242, b: 254, a: 255 },
        });
      } catch {}

      await connection.command('Runtime.enable');
      await connection.command('Runtime.addBinding', { name: this.binding });
      const currentCfg = await this.preferences.get();
      applyNativeDesktopSeeThrough(currentCfg);
      const source = await this.buildSource();
      const guardedSource = `if (location.origin === ${JSON.stringify(connection.origin)}) { ${source} }`;
      connection.guardedSource = guardedSource;
      connection.script = (await connection.command('Page.addScriptToEvaluateOnNewDocument', { source: guardedSource })).identifier;
      const evalRes = await connection.command('Runtime.evaluate', { expression: guardedSource });
      if (evalRes.exceptionDetails) throw new Error('Glass renderer evaluation failed');
      return connection;
    } catch (err) {
      try { if (connection.script) await connection.command('Page.removeScriptToEvaluateOnNewDocument', { identifier: connection.script }); } catch {}
      try { await connection.command('Runtime.removeBinding', { name: this.binding }); } catch {}
      connection.close();
      throw err;
    }
  }

  async broadcastConfig(config) {
    applyNativeDesktopSeeThrough(config);
    const expr = `window.__agGlassApplyConfig?.(${JSON.stringify(config)})`;
    for (const [url, connection] of this.sessions) {
      try {
        await connection.command('Emulation.setDefaultBackgroundColorOverride', {
          color: { r: 224, g: 242, b: 254, a: 255 },
        });
        await connection.command('Runtime.evaluate', { expression: expr });
      } catch {
        connection.close();
        this.sessions.delete(url);
      }
    }
  }

  async tick() {
    if (this.busy || this.stopping) return;
    this.busy = true;
    try {
      if (!(await this.owns())) {
        await this.detachAll(false);
        return;
      }
      if (!(await this.enabled())) {
        await this.detachAll(true);
        await this.setHealth('disabled', 'Plugin is disabled in Antigravity config');
        return;
      }
      const targets = await discoverTargets(this.profile);
      const active = new Set(targets.map(t => t.webSocketDebuggerUrl));
      for (const [url, conn] of this.sessions) {
        if (!active.has(url) || conn.closed) {
          conn.close();
          this.sessions.delete(url);
        }
      }
      for (const target of targets) {
        if (!this.sessions.has(target.webSocketDebuggerUrl)) {
          this.sessions.set(target.webSocketDebuggerUrl, await this.attach(target));
        }
      }
      const currentConfig = await this.preferences.get();
      applyNativeDesktopSeeThrough(currentConfig);
      const expectedVersion = createHash('sha256')
        .update(this.rendererCode + rendererBridge.toString() + JSON.stringify(this.owner))
        .digest('hex');
      for (const [url, conn] of this.sessions) {
        try {
          await conn.command('Emulation.setDefaultBackgroundColorOverride', {
            color: { r: 224, g: 242, b: 254, a: 255 },
          });
          const check = await conn.command('Runtime.evaluate', {
            returnByValue: true,
            expression: `Boolean(window.__agGlassInstalled && window.__agGlassRuntimeVersion === ${JSON.stringify(expectedVersion)} && document.getElementById("ag-glass-host-stylesheet"))`,
          });
          if (!check.result?.value) {
            const source = await this.buildSource();
            const guarded = `if (location.origin === ${JSON.stringify(conn.origin)}) { ${source} }`;
            await conn.command('Runtime.evaluate', { expression: guarded });
          } else {
            await conn.command('Runtime.evaluate', {
              expression: `window.__agGlassApplyConfig?.(${JSON.stringify(currentConfig)})`,
            });
          }
        } catch {
          conn.close();
          this.sessions.delete(url);
        }
      }
      await this.setHealth(
        this.sessions.size > 0 ? 'mounted' : 'waiting',
        this.sessions.size > 0 ? `Sky Azure see-through active on ${this.sessions.size} window(s)` : 'Waiting for Antigravity window'
      );
    } catch (err) {
      await this.setHealth('reconnecting', `Renderer connection retrying: ${err.message}`);
    } finally {
      this.busy = false;
    }
  }

  async detachAll(disposeDom = false) {
    for (const conn of this.sessions.values()) {
      try {
        if (disposeDom && (await this.owns())) {
          await conn.command('Runtime.evaluate', {
            expression: 'window.__agGlassDispose?.();window.__agGlassRuntimeBridge?.dispose();delete window.agGlassHost;',
          });
        }
        if (conn.script) await conn.command('Page.removeScriptToEvaluateOnNewDocument', { identifier: conn.script });
        await conn.command('Runtime.removeBinding', { name: this.binding });
      } catch {}
      conn.close();
    }
    this.sessions.clear();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.stopping = false;
    void this.tick();
    this.timer = setInterval(() => { void this.tick(); }, this.interval);
    this.timer.unref?.();
  }

  async stop({ disposeDom = false } = {}) {
    this.running = false;
    this.stopping = true;
    clearInterval(this.timer);
    const isEnabled = await this.enabled().catch(() => true);
    await this.detachAll(disposeDom || !isEnabled);
  }
}
