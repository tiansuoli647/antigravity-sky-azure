import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { installedAgentExecutable, platformPaths } from '../../compat/platform.mjs';

export async function loadSidecarSdk() {
  try {
    return await import('sidecar_sdk');
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    try {
      const file = createRequire(import.meta.url).resolve('sidecar_sdk');
      return import(pathToFileURL(file).href);
    } catch (resolveError) {
      if (resolveError.code !== 'MODULE_NOT_FOUND') throw resolveError;
      return loadBundledSdk();
    }
  }
}

async function loadBundledSdk() {
  const exe = installedAgentExecutable();
  const root = join(platformPaths().data, 'sdk');
  const info = await stat(exe);
  const stamp = `${info.size}:${info.mtimeMs}`;
  let cached = false;
  try {
    cached = (await readFile(join(root, 'version.txt'), 'utf8')) === stamp;
  } catch {}
  if (!cached) {
    const binary = await readFile(exe);
    const marker = binary.indexOf('export class SidecarApp');
    const start = binary.lastIndexOf("import { execFileSync } from 'node:child_process';", marker);
    const tail = "return provided === this.#token;\n  }\n}\n";
    const tailIndex = binary.indexOf(tail, marker);
    const preloadMarker = binary.indexOf('window.sidecar =');
    const preloadStart = binary.lastIndexOf('(function() {', preloadMarker);
    const preloadTail = '\n})();';
    const preloadEnd = binary.indexOf(preloadTail, preloadMarker);
    if (
      marker < 0 ||
      start < 0 ||
      marker - start > 12000 ||
      tailIndex < marker ||
      tailIndex - marker > 24000 ||
      preloadStart < 0 ||
      preloadEnd < preloadMarker ||
      preloadEnd - preloadStart > 24000
    ) {
      throw new Error('Incompatible Sidecar SDK format in host binary');
    }
    const sdk = binary.subarray(start, tailIndex + Buffer.byteLength(tail)).toString('utf8');
    const preload = binary.subarray(preloadStart, preloadEnd + Buffer.byteLength(preloadTail)).toString('utf8');
    if (!sdk.includes("const BIND_HOST = '127.0.0.1'") || !preload.includes('window.sidecar =')) {
      throw new Error('SDK resource verification failed');
    }
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'index.mjs'), sdk);
    await writeFile(join(root, 'preload.js'), preload);
    await writeFile(join(root, 'version.txt'), stamp);
  }
  return import(pathToFileURL(join(root, 'index.mjs')).href);
}
