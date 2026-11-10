---
name: glass-theme-control
description: Control and customize the Antigravity Sky Azure Glass (antigravity-glass) plugin settings, including behind-window see-through mode (blurbehind vs clear), Gaussian blur radius, surface opacities, specular rim highlights, and ASAR native window transparency patching. Use when the user asks to adjust the Sky Azure frosted glass parameters, window transparency, or inspect the glass plugin status.
---

# Antigravity Sky Azure Glass Control (`antigravity-glass`)

This skill manages the **Antigravity Sky Azure Glass** (`antigravity-glass`) plugin, which provides a single unified **Sky Azure (晴空碧海)** theme with true behind-window desktop transparency.

## Configuration File Path

Preferences are persisted as JSON in:
- **Windows**: `%LOCALAPPDATA%\AntigravityGlass\settings.json` (`C:\Users\<User>\AppData\Local\AntigravityGlass\settings.json`)

## Schema & Optical Parameters

The plugin enforces a single theme (`preset: "sky"`) with the following schema:

| Key | Type | Range / Values | Default | Description |
| --- | --- | --- | --- | --- |
| `enabled` | `boolean` | `true` \| `false` | `true` | Master switch for the glass optical engine |
| `preset` | `string` | `"sky"` | `"sky"` | Fixed Sky Azure (晴空碧海) theme |
| `windowBackdrop` | `string` | `"blurbehind"` \| `"clear"` | `"blurbehind"` | Native Win32 DWM mode: frosted see-through (`blurbehind`) or clear see-through (`clear`) |
| `blur` | `number` | `0` – `48` (px) | `18` | CSS `backdrop-filter: blur()` radius on cards and sidebars |
| `saturation` | `number` | `80` – `260` (%) | `180` | `backdrop-filter: saturate()` multiplier |
| `bgOpacity` | `number` | `0` – `75` (%) | `18` | Sky-blue glass tint opacity over the transparent window base (`0` = fully clear window base) |
| `sidebarOpacity` | `number` | `5` – `92` (%) | `32` | Sidebar & titlebar sky-blue glass opacity |
| `cardOpacity` | `number` | `10` – `95` (%) | `45` | Floating message cards & composer glass opacity |
| `specular` | `number` | `0` – `100` (%) | `68` | Specular rim border & top-edge refraction highlight intensity |
| `noise` | `number` | `0` – `25` (%) | `3` | Subtle surface grain opacity |

## Native Behind-Window Transparency (`patch-loader.py`)

Because Electron's `BrowserWindow` defaults to an opaque `#FAFAFA` / `#131313` background in `resources/app.asar` (`dist/utils.js`), CSS alone cannot reveal desktop content behind the window unless the main process `BrowserWindow` is configured with `backgroundColor: '#00000000'` and DWM composition attributes.

Run the reversible ASAR patcher:

```powershell
# Check status
python "$env:USERPROFILE\.gemini\config\plugins\antigravity-glass\compat\patch-loader.py" --status

# Apply behind-window see-through patch (creates backup in %LOCALAPPDATA%\AntigravityGlassBackups)
python "$env:USERPROFILE\.gemini\config\plugins\antigravity-glass\compat\patch-loader.py" --apply

# Restore original app.asar
python "$env:USERPROFILE\.gemini\config\plugins\antigravity-glass\compat\patch-loader.py" --restore
```
