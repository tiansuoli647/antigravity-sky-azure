"""Reversible ASAR adapter enabling OS-level behind-window see-through & Sky Azure glassmorphism in Antigravity.

--check   validates the archive in memory without modifying any files.
--status  inspects whether app.asar has native glass patch applied.
--apply   creates a verified SHA-256 backup of app.asar and injects native window see-through + renderer hook.
--restore restores the original app.asar from a backup directory.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import struct
import sys
from pathlib import Path

MARKER = '// AG_GLASS_NATIVE_V1'


def resolve_paths():
    home = Path.home()
    if sys.platform == 'win32':
        local = Path(os.environ.get('LOCALAPPDATA', home / 'AppData' / 'Local'))
        app = local / 'Programs' / 'antigravity' / 'resources' / 'app.asar'
    elif sys.platform == 'darwin':
        local = home / 'Library' / 'Application Support'
        app = Path('/Applications/Antigravity.app/Contents/Resources/app.asar')
    else:
        local = Path(os.environ.get('XDG_DATA_HOME', home / '.local' / 'share'))
        app = Path('/opt/Antigravity/resources/app.asar')
    backups = local / 'AntigravityGlassBackups'
    return app, backups


def walk(entry, prefix=''):
    for key, value in entry.get('files', {}).items():
        path = f'{prefix}/{key}' if prefix else key
        if 'files' in value:
            yield from walk(value, path)
        elif 'offset' in value and not value.get('unpacked'):
            yield path, value


def parse_archive(data):
    sizes = struct.unpack('<4I', data[:16])
    header = json.loads(data[16:16 + sizes[3]])
    return header, 8 + sizes[1]


def unpatched_original(current, backups):
    header, base = parse_archive(current)
    entry = header['files']['dist']['files']['utils.js']
    utils_bytes = current[base + int(entry['offset']):base + int(entry['offset']) + entry['size']]
    if MARKER.encode('utf-8') not in utils_bytes:
        return current
    digest = hashlib.sha256(current).hexdigest()
    if backups.is_dir():
        for directory in sorted(backups.iterdir(), reverse=True):
            note_path = directory / 'patch.json'
            if not note_path.is_file():
                continue
            note = json.loads(note_path.read_text(encoding='utf-8'))
            if note.get('patchedSha256') != digest:
                continue
            original = (directory / 'app.asar').read_bytes()
            if hashlib.sha256(original).hexdigest() != note['originalSha256']:
                raise RuntimeError('Original archive backup integrity mismatch.')
            return original
    raise RuntimeError('app.asar is already patched by another session and no matching backup was found.')


def build_patched(data):
    header, base = parse_archive(data)
    files = list(walk(header))
    bodies = {
        name: data[base + int(entry['offset']):base + int(entry['offset']) + entry['size']]
        for name, entry in files
    }

    # 1. Patch dist/utils.js for transparent BrowserWindow/BaseWindow & DWM + Layered see-through
    utils = bodies['dist/utils.js'].decode('utf-8')
    if MARKER in utils:
        raise RuntimeError('Native glass adapter is already installed in dist/utils.js.')

    # Inject transparent backgroundColor (#00000000)
    bg_match = re.search(
        r"^[ \t]*const\s+backgroundColor\s*=\s*isLight\s*\?\s*['\"]#FAFAFA['\"]\s*:\s*['\"]#131313['\"];?",
        utils,
        re.MULTILINE,
    )
    if bg_match:
        indent_bg = re.match(r"^[ \t]*", bg_match.group(0)).group(0)
        utils = utils[:bg_match.start()] + f"{indent_bg}{MARKER}\n{indent_bg}const backgroundColor = '#00000000';" + utils[bg_match.end():]
    else:
        bg_old = "    const backgroundColor = isLight ? '#FAFAFA' : '#131313';"
        if bg_old in utils:
            utils = utils.replace(bg_old, f"    {MARKER}\n    const backgroundColor = '#00000000';", 1)
        else:
            raise RuntimeError('backgroundColor anchor not found in dist/utils.js.')

    # Inject backgroundMaterial and vibrancy
    tb_match = re.search(r"^[ \t]*titleBarStyle:\s*['\"]hidden['\"],?", utils, re.MULTILINE)
    if tb_match:
        indent_tb = re.match(r"^[ \t]*", tb_match.group(0)).group(0)
        tb_replacement = (
            f"{indent_tb}backgroundMaterial: process.platform === 'win32' ? 'acrylic' : undefined,\n"
            f"{indent_tb}vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,\n"
            f"{indent_tb}titleBarStyle: 'hidden',"
        )
        utils = utils[:tb_match.start()] + tb_replacement + utils[tb_match.end():]
    else:
        tb_anchor = "        titleBarStyle: 'hidden',"
        if tb_anchor in utils:
            tb_replacement = (
                "        backgroundMaterial: process.platform === 'win32' ? 'acrylic' : undefined,\n"
                "        vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,\n"
                "        titleBarStyle: 'hidden',"
            )
            utils = utils.replace(tb_anchor, tb_replacement, 1)
        else:
            raise RuntimeError('titleBarStyle anchor not found in dist/utils.js.')

    # Modern BaseWindow / WebContentsView curtain transparent layer support
    curtain_match = re.search(r"^[ \t]*const\s+curtainColor\s*=\s*getHubCurtainColor\(\);?", utils, re.MULTILINE)
    if curtain_match:
        indent_c = re.match(r"^[ \t]*", curtain_match.group(0)).group(0)
        utils = utils[:curtain_match.start()] + f"{indent_c}const curtainColor = '#00000000';" + utils[curtain_match.end():]

    curtain_view_match = re.search(
        r"const\s+curtainView\s*=\s*new\s+(?:electron_1\.)?WebContentsView\(\s*\{\s*webPreferences:\s*\{\s*sandbox:\s*true,\s*javascript:\s*false\s*\},?\s*\}\);?",
        utils,
    )
    if curtain_view_match:
        utils = (
            utils[:curtain_view_match.start()]
            + "const curtainView = new electron_1.WebContentsView({\n        webPreferences: { sandbox: true, javascript: false, transparent: true },\n    });"
            + utils[curtain_view_match.end():]
        )

    curtain_recolor_old = (
        "    if (!w.isDestroyed?.()) {\n"
        "        w.setBackgroundColor?.(normalized);\n"
        "    }\n"
        "    if (!curtain.webContents?.isDestroyed?.()) {\n"
        "        curtain.setBackgroundColor?.(normalized);"
    )
    curtain_recolor_new = (
        "    if (!w.isDestroyed?.()) {\n"
        "        w.setBackgroundColor?.('#00000000');\n"
        "    }\n"
        "    if (!curtain.webContents?.isDestroyed?.()) {\n"
        "        curtain.setBackgroundColor?.('#00000000');"
    )
    if curtain_recolor_old in utils:
        utils = utils.replace(curtain_recolor_old, curtain_recolor_new, 1)

    curtain_css_old = "const css = `html, body { background: ${normalized} !important; }`;"
    curtain_css_new = "const css = `html, body { background: #00000000 !important; }`;"
    if curtain_css_old in utils:
        utils = utils.replace(curtain_css_old, curtain_css_new, 1)

    # Locate setWindowOpenHandler hook anchor (supports win.webContents or hubContents)
    hook_match = re.search(
        r"^[ \t]*(?:win\.webContents|hubContents)\.setWindowOpenHandler\s*\(\s*\(details\)\s*=>\s*\{",
        utils,
        re.MULTILINE,
    )
    if not hook_match:
        raise RuntimeError('setWindowOpenHandler anchor not found in dist/utils.js.')

    indent_h = re.match(r"^[ \t]*", hook_match.group(0)).group(0)
    win_hook = f"""{indent_h}// AG_GLASS_NATIVE_V1: Win32 Layered + DWM behind-window see-through & Sky Azure renderer injection
{indent_h}const applyAgGlassNative = (overrideOpts) => {{
{indent_h}    try {{
{indent_h}        const os = require('os');
{indent_h}        const cp = require('child_process');
{indent_h}        const localAppData = process.env.LOCALAPPDATA || path_1.default.join(os.homedir(), 'AppData', 'Local');
{indent_h}        const settingsPath = path_1.default.join(localAppData, 'AntigravityGlass', 'settings.json');
{indent_h}        let cfg = {{}};
{indent_h}        if (fs.existsSync(settingsPath)) {{
{indent_h}            try {{ cfg = JSON.parse(fs.readFileSync(settingsPath, 'utf-8').replace(/^\\uFEFF/, '')); }} catch (_) {{}}
{indent_h}        }}
{indent_h}        if (overrideOpts && typeof overrideOpts === 'object') {{
{indent_h}            if (typeof overrideOpts.glassEnabled === 'boolean') cfg.enabled = overrideOpts.glassEnabled;
{indent_h}            if (typeof overrideOpts.bgOpacity === 'number') cfg.bgOpacity = overrideOpts.bgOpacity;
{indent_h}        }}
{indent_h}        if (process.platform === 'win32') {{
{indent_h}            const enabled = cfg.enabled !== false;
{indent_h}            const bgOp = Math.min(85, Math.max(0, Number.isFinite(Number(cfg.bgOpacity)) ? Number(cfg.bgOpacity) : 22));
{indent_h}            const alphaByte = enabled ? Math.round(145 + (bgOp / 85) * 85) : 255;
{indent_h}            const enInt = enabled ? 1 : 0;
{indent_h}            const stateDir = path_1.default.join(localAppData, 'AntigravityGlass');
{indent_h}            fs.mkdirSync(stateDir, {{ recursive: true }});
{indent_h}            fs.writeFileSync(path_1.default.join(stateDir, 'underlay-state.txt'), `${{enInt}}|${{alphaByte}}`, 'utf-8');
{indent_h}            const candidatePlugins = ['antigravity-glass', 'antigravity-sky-azure'];
{indent_h}            let underlayScript = null;
{indent_h}            for (const pName of candidatePlugins) {{
{indent_h}                const candidate = path_1.default.join(os.homedir(), '.gemini', 'config', 'plugins', pName, 'compat', 'acrylic-underlay.ps1');
{indent_h}                if (fs.existsSync(candidate)) {{ underlayScript = candidate; break; }}
{indent_h}            }}
{indent_h}            if (underlayScript) {{
{indent_h}                const psExe = path_1.default.join(process.env.SystemRoot || 'C:\\\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
{indent_h}                const child = cp.spawn(psExe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', underlayScript], {{
{indent_h}                    windowsHide: true,
{indent_h}                    stdio: 'ignore',
{indent_h}                }});
{indent_h}                child.on('error', () => {{}});
{indent_h}                child.unref();
{indent_h}            }}
{indent_h}        }}
{indent_h}    }} catch (_) {{}}
{indent_h}}};
{indent_h}win.__applyAgGlassNative = applyAgGlassNative;
{indent_h}win.once?.('ready-to-show', () => applyAgGlassNative());
{indent_h}win.once?.('show', () => applyAgGlassNative());
{indent_h}setTimeout(() => applyAgGlassNative(), 500);
{indent_h}const agGlassContents = (typeof hubContents !== 'undefined' && hubContents) ? hubContents : win.webContents;
{indent_h}agGlassContents?.on('dom-ready', () => {{
{indent_h}    try {{
{indent_h}        applyAgGlassNative();
{indent_h}        const os = require('os');
{indent_h}        const candidatePlugins = ['antigravity-glass', 'antigravity-sky-azure'];
{indent_h}        let rendererPath = null;
{indent_h}        for (const pName of candidatePlugins) {{
{indent_h}            const candidate = path_1.default.join(os.homedir(), '.gemini', 'config', 'plugins', pName, 'compat', 'glass-renderer.cjs');
{indent_h}            if (fs.existsSync(candidate)) {{ rendererPath = candidate; break; }}
{indent_h}        }}
{indent_h}        if (rendererPath) {{
{indent_h}            const localAppData = process.env.LOCALAPPDATA || path_1.default.join(os.homedir(), 'AppData', 'Local');
{indent_h}            const settingsPath = path_1.default.join(localAppData, 'AntigravityGlass', 'settings.json');
{indent_h}            let initCfg = {{}};
{indent_h}            if (fs.existsSync(settingsPath)) {{
{indent_h}                try {{ initCfg = JSON.parse(fs.readFileSync(settingsPath, 'utf-8').replace(/^\\uFEFF/, '')); }} catch (_) {{}}
{indent_h}            }}
{indent_h}            const src = fs.readFileSync(rendererPath, 'utf-8');
{indent_h}            const prefix = 'module.exports = ';
{indent_h}            const fn = src.slice(src.indexOf(prefix) + prefix.length).trim().replace(/;$/, '');
{indent_h}            const js = `window.__agGlassNativeTransparent=true;window.__agGlassInitialConfig=${{JSON.stringify(initCfg)}};(${{fn}})();`;
{indent_h}            void agGlassContents.executeJavaScript(js).catch(() => {{}});
{indent_h}        }}
{indent_h}    }} catch (_) {{}}
{indent_h}}});
"""
    utils = utils[:hook_match.start()] + win_hook + utils[hook_match.start():]
    bodies['dist/utils.js'] = utils.encode('utf-8')

    # 2. Patch dist/ipcHandlers.js so titleBarOverlay stays transparent (#00000000) & syncs Win32 see-through
    ipc = bodies['dist/ipcHandlers.js'].decode('utf-8')
    ipc_pattern = re.compile(r"win\.setTitleBarOverlay\(\s*\{[^{}]*color:\s*options\.color[^{}]*\}\s*\);?", re.DOTALL)
    ipc_match = ipc_pattern.search(ipc)
    if ipc_match:
        ipc_new = f"""{MARKER}
            win.setTitleBarOverlay({{
                color: '#00000000',
                symbolColor: '#0c4a6e',
                height: 30,
            }});
            if (typeof win.__applyAgGlassNative === 'function' && options && typeof options.glassEnabled === 'boolean') {{
                win.__applyAgGlassNative(options);
            }}"""
        ipc = ipc[:ipc_match.start()] + ipc_new + ipc[ipc_match.end():]
        bodies['dist/ipcHandlers.js'] = ipc.encode('utf-8')
    elif MARKER not in ipc:
        ipc_old = """            win.setTitleBarOverlay({
                color: options.color,
                symbolColor: options.symbolColor,
                height: 30,
            });"""
        if ipc_old in ipc:
            ipc = ipc.replace(ipc_old, f"""            {MARKER}
            win.setTitleBarOverlay({{
                color: '#00000000',
                symbolColor: '#0c4a6e',
                height: 30,
            }});
            if (typeof win.__applyAgGlassNative === 'function' && options && typeof options.glassEnabled === 'boolean') {{
                win.__applyAgGlassNative(options);
            }}""", 1)
            bodies['dist/ipcHandlers.js'] = ipc.encode('utf-8')

    cursor = 0
    packed = []
    for name, entry in sorted(files, key=lambda item: int(item[1]['offset'])):
        body = bodies[name]
        entry['offset'] = str(cursor)
        entry['size'] = len(body)
        if 'integrity' in entry:
            block = entry['integrity'].get('blockSize', 4194304)
            entry['integrity'] = {
                'algorithm': 'SHA256',
                'hash': hashlib.sha256(body).hexdigest(),
                'blockSize': block,
                'blocks': [hashlib.sha256(body[i:i + block]).hexdigest() for i in range(0, len(body), block)],
            }
        packed.append(body)
        cursor += len(body)

    raw = json.dumps(header, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    pad = (-len(raw)) % 4
    result = struct.pack('<4I', 4, 8 + len(raw) + pad, 4 + len(raw) + pad, len(raw)) + raw + (b'\x00' * pad) + b''.join(packed)

    # Verify packed archive integrity
    verified, new_base = parse_archive(result)
    for name, entry in walk(verified):
        value = result[new_base + int(entry['offset']):new_base + int(entry['offset']) + entry['size']]
        assert value == bodies[name]
        if 'integrity' in entry:
            assert hashlib.sha256(value).hexdigest() == entry['integrity']['hash']
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--check', action='store_true')
    group.add_argument('--status', action='store_true')
    group.add_argument('--apply', action='store_true')
    group.add_argument('--restore', type=Path, nargs='?', const=Path('__LATEST__'))
    args = parser.parse_args()

    app, backups = resolve_paths()
    if args.status:
        if not app.is_file():
            print(f'app.asar not found at: {app}')
            return
        current = app.read_bytes()
        header, base = parse_archive(current)
        entry = header['files']['dist']['files']['utils.js']
        utils_bytes = current[base + int(entry['offset']):base + int(entry['offset']) + entry['size']]
        if MARKER.encode('utf-8') in utils_bytes:
            print('Native see-through adapter is active (patched).')
        else:
            print('Native see-through adapter is not installed (unpatched).')
        return

    if args.restore:
        target = args.restore
        if target == Path('__LATEST__'):
            if not backups.is_dir():
                raise RuntimeError(f'No backups directory found at: {backups}')
            candidates = [d for d in backups.iterdir() if d.is_dir() and (d / 'patch.json').is_file()]
            if not candidates:
                raise RuntimeError(f'No valid backups found in {backups}')
            target = sorted(candidates, reverse=True)[0]
        if not target.is_dir():
            raise RuntimeError(f'Backup directory not found: {target}')
        note = json.loads((target / 'patch.json').read_text(encoding='utf-8'))
        original = (target / 'app.asar').read_bytes()
        assert hashlib.sha256(original).hexdigest() == note['originalSha256']
        app.write_bytes(original)
        print(f'Restored original app.asar successfully from: {target}')
        return

    current = app.read_bytes()
    original = unpatched_original(current, backups)
    patched = build_patched(original)
    print('Validated ASAR structure, offsets, and SHA-256 block integrity.')
    if args.check:
        print('Check passed (dry-run only, no files modified).')
        return

    if current == patched:
        print('Native see-through adapter is already active.')
        return

    backup = backups / datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    backup.mkdir(parents=True, exist_ok=False)
    (backup / 'app.asar').write_bytes(original)
    (backup / 'patch.json').write_text(
        json.dumps({
            'originalSha256': hashlib.sha256(original).hexdigest(),
            'patchedSha256': hashlib.sha256(patched).hexdigest(),
        }, indent=2),
        encoding='utf-8',
    )
    try:
        app.write_bytes(patched)
        assert app.read_bytes() == patched
    except Exception:
        app.write_bytes(current)
        raise
    print('Applied native behind-window see-through patch. Backup saved at:', backup)


if __name__ == '__main__':
    main()
