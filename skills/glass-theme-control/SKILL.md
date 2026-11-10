---
name: glass-theme-control
description: Control and customize the Antigravity Sky Azure Glass (antigravity-glass) plugin settings, including behind-window see-through mode (blurbehind, acrylic, clear), Gaussian blur radius, surface opacities, specular rim highlights, and ASAR native window transparency patching. Use when the user asks to adjust the Sky Azure frosted glass parameters, window transparency, or inspect the glass plugin status.
---

# Antigravity Sky Azure Glass Control (`antigravity-glass`)

This skill manages the **Antigravity Sky Azure Glass** (`antigravity-glass`) plugin, which provides a single unified **Sky Azure (晴空碧海)** aesthetic with true behind-window desktop transparency.

## Configuration File Path

Preferences are persisted as JSON in:
- **Windows**: `%LOCALAPPDATA%\AntigravityGlass\settings.json` (`C:\Users\<User>\AppData\Local\AntigravityGlass\settings.json`)
- **macOS**: `~/Library/Application Support/AntigravityGlass/settings.json`
- **Linux**: `${XDG_DATA_HOME:-~/.local/share}/AntigravityGlass/settings.json`

## Schema & Optical Parameters (v2.1.0)

The optical engine enforces the Sky Azure single-theme configuration defined in `compat/preferences.mjs`:

| Key | Type | Range / Valid Values | Default | Optical & Functional Description |
| :--- | :--- | :--- | :--- | :--- |
| `enabled` | `boolean` | `true` \| `false` | `true` | Master switch for the glass optical engine |
| `language` | `string` | `"zh"` \| `"en"` | `"zh"` | Studio UI and label display language |
| `windowBackdrop` | `string` | `"blurbehind"` \| `"acrylic"` \| `"clear"` | `"blurbehind"` | Native Win32 DWM composition mode: frosted see-through (`blurbehind`), Windows 11 acrylic material (`acrylic`), or lossless 100% clear pass-through (`clear`) |
| `blur` | `number` | `0` – `48` (px) | `22` | Component Gaussian blur radius via `backdrop-filter: blur(Npx)` on cards and sidebars |
| `saturation` | `number` | `100` – `240` (%) | `190` | Sky-azure chroma saturation gain multiplier via `backdrop-filter: saturate(N%)` |
| `bgOpacity` | `number` | `0` – `85` (%) | `22` | Main canvas sky-blue tint opacity over the transparent window base (`0` = 100% clear desktop pass-through) |
| `sidebarOpacity` | `number` | `8` – `90` (%) | `42` | Sidebar and titlebar structural semi-transparency creating depth-of-field separation |
| `cardOpacity` | `number` | `15` – `92` (%) | `58` | Chat message cards, code blocks, and composer cloud-white glass opacity ensuring high text contrast |
| `specular` | `number` | `0` – `100` (%) | `75` | Fresnel ice-crystal specular rim highlight and top-edge refraction line intensity |
| `pulseGlass` | `boolean` | `true` \| `false` | `true` | Dynamic optical breathing glow on dashboard and status indicators |
| `floatingPill` | `boolean` | `true` \| `false` | `true` | Quick-toggle floating status pill widget mounted on the top-right header |

### Default Configuration Example (`settings.json`)

```json
{
  "enabled": true,
  "language": "zh",
  "blur": 22,
  "saturation": 190,
  "bgOpacity": 22,
  "sidebarOpacity": 42,
  "cardOpacity": 58,
  "specular": 75,
  "windowBackdrop": "blurbehind",
  "pulseGlass": true,
  "floatingPill": true
}
```

## Native Behind-Window Transparency (`patch-loader.py`)

Because Electron's `BrowserWindow` defaults to an opaque `#FAFAFA` / `#131313` background in `resources/app.asar` (`dist/utils.js`), CSS alone cannot reveal desktop content behind the window unless the main process `BrowserWindow` is configured with `backgroundColor: '#00000000'`, transparent `WebContentsView` curtain layer, and DWM composition attributes.

The reversible ASAR adapter script `compat/patch-loader.py` provides atomic verification, backup, patching, and restoration of `app.asar`.

### Command Line Interface (CLI) Usage

The script accepts mutually exclusive operations:

```powershell
# 1. Inspect patch status (--status)
# Checks whether app.asar has the native glass patch marker installed
python "$env:USERPROFILE\.gemini\config\plugins\antigravity-glass\compat\patch-loader.py" --status

# 2. Dry-run integrity validation (--check)
# Validates archive header, file offsets, and SHA-256 block integrity in memory without modifying any files
python "$env:USERPROFILE\.gemini\config\plugins\antigravity-glass\compat\patch-loader.py" --check

# 3. Apply native transparency patch (--apply)
# Creates a verified SHA-256 snapshot backup in %LOCALAPPDATA%\AntigravityGlassBackups\<YYYYMMDD-HHMMSS>
# and injects transparent BrowserWindow, curtain layer, and renderer hook into app.asar
python "$env:USERPROFILE\.gemini\config\plugins\antigravity-glass\compat\patch-loader.py" --apply

# 4. Restore original app.asar (--restore)
# Restore from the latest verified backup automatically:
python "$env:USERPROFILE\.gemini\config\plugins\antigravity-glass\compat\patch-loader.py" --restore

# Or restore from a specific backup directory:
python "$env:USERPROFILE\.gemini\config\plugins\antigravity-glass\compat\patch-loader.py" --restore "$env:LOCALAPPDATA\AntigravityGlassBackups\20261110-120000"
```

### CLI Flag Summary

| Flag | Argument | Description |
| :--- | :--- | :--- |
| `--status` | None | Inspects whether the native glass adapter (`MARKER`) is currently active in `resources/app.asar`. |
| `--check` | None | In-memory dry-run verification: validates archive structure, offset alignment, and SHA-256 hashes without writing changes to disk. |
| `--apply` | None | Takes a full timestamped backup to `%LOCALAPPDATA%\AntigravityGlassBackups`, verifies integrity, and rewrites `app.asar` with transparent background and native hooks. |
| `--restore` | `[PATH]` (Optional) | Atomically restores `app.asar` from backup. If path is omitted, restores from the most recent valid backup directory (`__LATEST__`). If path is provided, validates SHA-256 against `patch.json` before restoring. |
