// Main-world Sky Azure Frosted Glass (毛玻璃) renderer for Antigravity App.
module.exports = function installAgGlassRenderer() {
  if (window !== window.top) return;
  if (!document.documentElement || !document.body) {
    document.addEventListener('DOMContentLoaded', installAgGlassRenderer, { once: true });
    return;
  }

  const STYLE_ID = 'ag-glass-host-stylesheet';
  const STAGE_ID = 'ag-glass-backdrop-stage';
  const PILL_ID = 'ag-glass-quick-pill';
  const PULSE_STYLE_ID = 'ag-glass-pulse-shadow-style';
  const STORAGE_KEY = 'ag-glass-sky-azure-v2';

  const DEFAULT_SKY_CONFIG = {
    enabled: true,
    language: 'zh',
    blur: 22,
    saturation: 190,
    bgOpacity: 22,
    sidebarOpacity: 42,
    cardOpacity: 58,
    specular: 75,
    windowBackdrop: 'blurbehind',
    pulseGlass: true,
    floatingPill: true,
  };

  function loadCached() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveCached(cfg) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch {}
  }

  let currentConfig = {
    ...DEFAULT_SKY_CONFIG,
    ...(loadCached() || {}),
    ...(window.__agGlassInitialConfig || {}),
  };

  let themeObserver = null;
  let pulseTimer = null;
  let disposed = false;

  function buildCss(cfg) {
    if (!cfg || cfg.enabled === false) {
      return `/* Antigravity Glass Studio: Disabled */`;
    }

    const blurPx = `${Math.max(4, Number(cfg.blur) ?? 22)}px`;
    const blurSmPx = `${Math.max(6, Math.round((Number(cfg.blur) ?? 22) * 0.72))}px`;
    const satPct = `${Math.max(100, Number(cfg.saturation) ?? 190)}%`;

    const bgRatio = Math.min(0.85, Math.max(0.08, (Number(cfg.bgOpacity) ?? 22) / 100));
    const sidebarRatio = Math.min(0.92, Math.max(0.18, (Number(cfg.sidebarOpacity) ?? 42) / 100));
    const cardRatio = Math.min(0.94, Math.max(0.28, (Number(cfg.cardOpacity) ?? 58) / 100));
    const secRatio = Math.min(0.90, Math.max(0.22, cardRatio * 0.82));
    const mutedRatio = Math.min(0.88, Math.max(0.18, cardRatio * 0.68));

    const specRatio = Math.min(1, Math.max(0, (Number(cfg.specular) ?? 75) / 100));
    const rimTopAlpha = (0.55 + specRatio * 0.42).toFixed(3);
    const borderAlpha = (0.48 + specRatio * 0.42).toFixed(3);

    return `
      :root,
      body.theme-light,
      body.theme-dark,
      body.theme-standalone,
      body[data-agy-theme] {
        --background: #e0f2fe !important;
        --shell: transparent !important;
        --shell-canvas: transparent !important;
        --primary: #0284c7 !important;
        --primary-foreground: #ffffff !important;
        --link: #0369a1 !important;
        --foreground: #082f49 !important;
        --secondary-foreground: #0c4a6e !important;
        --muted-foreground: #0369a1 !important;
        --placeholder: rgba(12, 74, 110, 0.55) !important;
        --border: rgba(255, 255, 255, 0.52) !important;
        --card-border: rgba(255, 255, 255, ${borderAlpha}) !important;
        --glass: rgba(255, 255, 255, ${cardRatio.toFixed(3)}) !important;
        --glass-border: rgba(255, 255, 255, ${borderAlpha}) !important;
        --glass-highlight: rgba(255, 255, 255, ${rimTopAlpha}) !important;
        --glass-shadow: 0 12px 34px -6px rgba(2, 132, 199, 0.18), inset 0 1.5px 0 0 rgba(255, 255, 255, ${rimTopAlpha}) !important;
        --ag-glass-blur: ${blurPx};
        --ag-glass-blur-sm: ${blurSmPx};
        --ag-glass-saturate: ${satPct};
        --ag-glass-rim-top: rgba(255, 255, 255, ${rimTopAlpha});
        --ag-glass-border: rgba(255, 255, 255, ${borderAlpha});
        --ag-glass-shadow: 0 12px 34px -6px rgba(2, 132, 199, 0.18), inset 0 1.5px 0 0 var(--ag-glass-rim-top);
        --ag-glass-shadow-sm: 0 4px 16px -3px rgba(2, 132, 199, 0.13), inset 0 1px 0 0 var(--ag-glass-rim-top);
      }

      /* 1. Root & Body: Sky-Azure frosted base & locked viewport (eliminates right/bottom scrollbars) */
      html {
        background: linear-gradient(135deg, #bae6fd 0%, #e0f2fe 48%, #f0f9ff 100%) !important;
        overflow: hidden !important;
        max-width: 100vw !important;
        max-height: 100vh !important;
      }

      body,
      #root {
        background: transparent !important;
        background-color: transparent !important;
        overflow: hidden !important;
        max-width: 100vw !important;
        max-height: 100vh !important;
      }

      #root {
        position: relative;
        z-index: 1;
      }

      /* Completely hide visual scrollbar bars while keeping wheel/trackpad scrolling intact */
      *,
      *::before,
      *::after {
        scrollbar-width: none !important;
        scrollbar-color: transparent transparent !important;
        -ms-overflow-style: none !important;
      }
      *::-webkit-scrollbar,
      *::-webkit-scrollbar-track,
      *::-webkit-scrollbar-thumb,
      *::-webkit-scrollbar-button,
      *::-webkit-scrollbar-corner {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
        background: transparent !important;
      }

      /* Frosted Sky-Azure Atmospheric Stage (provides optical depth for backdrop-filter blur) */
      #${STAGE_ID} {
        position: fixed;
        inset: 0;
        z-index: 0;
        pointer-events: none;
        overflow: hidden;
        background:
          radial-gradient(circle at 14% 18%, rgba(14, 165, 233, 0.34) 0%, transparent 48%),
          radial-gradient(circle at 86% 22%, rgba(56, 189, 248, 0.30) 0%, transparent 52%),
          radial-gradient(circle at 52% 82%, rgba(255, 255, 255, 0.65) 0%, transparent 55%),
          linear-gradient(180deg, rgba(125, 211, 252, 0.36) 0%, rgba(224, 242, 254, 0.46) 54%, rgba(240, 249, 255, 0.56) 100%);
      }

      /* Tactile frosted glass micro-grain */
      #${STAGE_ID}::after {
        content: "";
        position: absolute;
        inset: 0;
        opacity: 0.038;
        mix-blend-mode: overlay;
        background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      }

      /* 2. Primary Window Canvas & Shell Layers: Frosted Sky-Azure glass layer */
      .bg-background {
        background: linear-gradient(
          180deg,
          rgba(186, 230, 253, ${(bgRatio * 1.15).toFixed(3)}) 0%,
          rgba(224, 242, 254, ${(bgRatio * 1.05).toFixed(3)}) 52%,
          rgba(240, 249, 255, ${(bgRatio * 1.10).toFixed(3)}) 100%
        ) !important;
        background-color: transparent !important;
      }

      /* Clear opaque canvas wrappers in new Antigravity shell architecture */
      .bg-background .bg-background,
      .agy-shell,
      .agy-inset-shell,
      [class*="bg-[var(--shell-canvas)]"],
      .bg-\\[var\\(--shell-canvas\\)\\] {
        background: transparent !important;
        background-color: transparent !important;
      }

      /* Inset sheet and main content body transparency */
      .agy-sheet[data-sheet-inset],
      .agy-sheet[data-sheet-inset] [data-main-content-body],
      .agy-inset-shell [data-side-panel-body],
      [data-main-content-body="true"],
      [data-side-panel-body="true"] {
        background: transparent !important;
        background-color: transparent !important;
      }

      /* Remove bottom composer bleed bar, sticky message bleeds & table bleeds */
      .md-sticky-message-bleed,
      .md-sticky-message-bleed::after,
      .md-sticky-message-bleed::before,
      .pointer-events-none.inset-x-4.bottom-0 {
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        box-shadow: none !important;
      }

      /* 3. Top Titlebar & Left Sidebar: Deep Sky-Cerulean Frosted Glass */
      .bg-sidebar {
        background: linear-gradient(
          180deg,
          rgba(14, 165, 233, ${(sidebarRatio * 0.92).toFixed(3)}) 0%,
          rgba(56, 189, 248, ${(sidebarRatio * 0.78).toFixed(3)}) 52%,
          rgba(186, 230, 253, ${(sidebarRatio * 0.85).toFixed(3)}) 100%
        ) !important;
        background-color: transparent !important;
        backdrop-filter: blur(var(--ag-glass-blur)) saturate(var(--ag-glass-saturate));
        -webkit-backdrop-filter: blur(var(--ag-glass-blur)) saturate(var(--ag-glass-saturate));
        border-right: 1px solid rgba(255, 255, 255, 0.56);
        box-shadow: inset -1px 0 0 0 rgba(255, 255, 255, 0.35);
      }

      /* Elevate top title-menu-bar above the left sidebar (z-10) so dropdowns are never occluded */
      .shrink-0:has([data-testid="title-menu-bar"]) {
        position: relative !important;
        z-index: 8500 !important;
        overflow: visible !important;
      }

      [data-testid="title-menu-bar"].bg-sidebar {
        position: relative !important;
        z-index: 8500 !important;
        overflow: visible !important;
        background: linear-gradient(
          90deg,
          rgba(14, 165, 233, ${(sidebarRatio * 1.02).toFixed(3)}) 0%,
          rgba(56, 189, 248, ${(sidebarRatio * 0.88).toFixed(3)}) 50%,
          rgba(125, 211, 252, ${(sidebarRatio * 0.92).toFixed(3)}) 100%
        ) !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.58);
        border-right: none;
        box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.65);
      }

      /* Strip redundant background/blur ONLY on non-floating inner sidebar list wrappers */
      .bg-sidebar .bg-sidebar:not(.absolute):not(.fixed):not([class*="z-"]) {
        background: transparent !important;
        background-color: transparent !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        border: none !important;
        box-shadow: none !important;
      }

      /* Top Menu Bar & Sidebar Floating Dropdown Menus (Antigravity / File / View / Window) */
      [data-testid="title-menu-bar"] .absolute,
      [data-testid="title-menu-bar"] .absolute.bg-sidebar,
      .bg-sidebar .absolute.bg-sidebar,
      .surface-opaque.bg-sidebar {
        z-index: 9999 !important;
        background: linear-gradient(
          145deg,
          rgba(240, 249, 255, 0.96) 0%,
          rgba(224, 242, 254, 0.92) 100%
        ) !important;
        background-color: rgba(240, 249, 255, 0.94) !important;
        backdrop-filter: blur(28px) saturate(195%) !important;
        -webkit-backdrop-filter: blur(28px) saturate(195%) !important;
        border: 1px solid rgba(255, 255, 255, 0.92) !important;
        border-radius: 10px !important;
        box-shadow: 0 16px 38px -6px rgba(2, 132, 199, 0.28), inset 0 1.5px 0 0 rgba(255, 255, 255, 0.98) !important;
        color: #082f49 !important;
      }

      [data-testid="title-menu-bar"] [data-testid="title-menu-bar-option"] {
        color: #082f49 !important;
        border-radius: 6px !important;
        margin: 1px 4px !important;
        width: calc(100% - 8px) !important;
      }

      [data-testid="title-menu-bar"] [data-testid="title-menu-bar-option"]:hover {
        background: rgba(14, 165, 233, 0.18) !important;
        color: #0284c7 !important;
      }

      /* Sidebar active/hover rows */
      body[data-agy-theme] .agy-sidebar-row .agy-row-actions {
        background: transparent !important;
      }

      .bg-sidebar-secondary,
      .hover\\:bg-sidebar-secondary:hover,
      .agy-sidebar-row:hover,
      .agy-sidebar-row[data-active="true"] {
        background: linear-gradient(
          135deg,
          rgba(255, 255, 255, 0.68) 0%,
          rgba(224, 242, 254, 0.54) 100%
        ) !important;
        backdrop-filter: blur(var(--ag-glass-blur-sm)) saturate(var(--ag-glass-saturate));
        -webkit-backdrop-filter: blur(var(--ag-glass-blur-sm)) saturate(var(--ag-glass-saturate));
        border: 1px solid rgba(255, 255, 255, 0.78);
        box-shadow: var(--ag-glass-shadow-sm);
      }

      .bg-sidebar-muted,
      .hover\\:bg-sidebar-muted:hover,
      .hover\\:\\!\\[--row-bg\\:var\\(--sidebar-muted\\)\\]:hover {
        background: rgba(255, 255, 255, 0.42) !important;
        --row-bg: rgba(255, 255, 255, 0.42) !important;
      }

      /* 4. Message Bubbles, Cards & Chat Composer: Frosted Cloud-White & Ice-Blue Glass */
      .p-px.bg-card-border {
        background: transparent !important;
        background-color: transparent !important;
      }

      .bg-card,
      .agy-user-bubble,
      [data-testid="user-message-bubble"] {
        background: linear-gradient(
          135deg,
          rgba(255, 255, 255, ${(cardRatio * 1.12).toFixed(3)}) 0%,
          rgba(240, 249, 255, ${(cardRatio * 0.98).toFixed(3)}) 60%,
          rgba(224, 242, 254, ${(cardRatio * 0.92).toFixed(3)}) 100%
        ) !important;
        background-color: transparent !important;
        backdrop-filter: blur(var(--ag-glass-blur)) saturate(var(--ag-glass-saturate)) !important;
        -webkit-backdrop-filter: blur(var(--ag-glass-blur)) saturate(var(--ag-glass-saturate)) !important;
        border: 1px solid var(--ag-glass-border) !important;
        box-shadow: var(--ag-glass-shadow) !important;
        transition: background 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
      }

      .bg-card:focus-within {
        border-color: rgba(14, 165, 233, 0.82) !important;
        box-shadow: 0 14px 38px -6px rgba(2, 132, 199, 0.26), inset 0 1.5px 0 0 rgba(255, 255, 255, 0.96) !important;
      }

      /* Enforce frosted glass on Surface Composer against onyx theme overrides */
      body[data-agy-theme] .surface-composer,
      .surface-composer {
        background-color: transparent !important;
        box-shadow: none !important;
      }

      body[data-agy-theme] .surface-composer > .surface-composer-card,
      body[data-newux-theme] .surface-composer > .surface-composer-card,
      .surface-composer > .surface-composer-card,
      .surface-composer-card {
        background: linear-gradient(
          135deg,
          rgba(255, 255, 255, ${(cardRatio * 1.12).toFixed(3)}) 0%,
          rgba(240, 249, 255, ${(cardRatio * 0.98).toFixed(3)}) 60%,
          rgba(224, 242, 254, ${(cardRatio * 0.92).toFixed(3)}) 100%
        ) !important;
        background-color: transparent !important;
        backdrop-filter: blur(var(--ag-glass-blur)) saturate(var(--ag-glass-saturate)) !important;
        -webkit-backdrop-filter: blur(var(--ag-glass-blur)) saturate(var(--ag-glass-saturate)) !important;
        border: 1px solid var(--ag-glass-border) !important;
        box-shadow: var(--ag-glass-shadow) !important;
      }

      body[data-agy-theme] .surface-composer > .surface-composer-card:focus-within,
      .surface-composer-card:focus-within {
        border-color: rgba(14, 165, 233, 0.82) !important;
        box-shadow: 0 14px 38px -6px rgba(2, 132, 199, 0.26), inset 0 1.5px 0 0 rgba(255, 255, 255, 0.96) !important;
      }

      /* Overview Panel & Aux sidebar host */
      .animate-overview-panel,
      [data-testid="overview-panel-host-sibling"] {
        background: linear-gradient(
          135deg,
          rgba(255, 255, 255, ${(cardRatio * 1.10).toFixed(3)}) 0%,
          rgba(240, 249, 255, ${(cardRatio * 0.95).toFixed(3)}) 60%,
          rgba(224, 242, 254, ${(cardRatio * 0.90).toFixed(3)}) 100%
        ) !important;
        backdrop-filter: blur(var(--ag-glass-blur)) saturate(var(--ag-glass-saturate)) !important;
        -webkit-backdrop-filter: blur(var(--ag-glass-blur)) saturate(var(--ag-glass-saturate)) !important;
        border: 1px solid var(--ag-glass-border) !important;
        box-shadow: var(--ag-glass-shadow) !important;
      }

      /* 5. Secondary & Muted Controls */
      .bg-secondary,
      .hover\\:bg-secondary:hover {
        background: rgba(255, 255, 255, ${secRatio.toFixed(3)}) !important;
        backdrop-filter: blur(var(--ag-glass-blur-sm)) saturate(var(--ag-glass-saturate));
        -webkit-backdrop-filter: blur(var(--ag-glass-blur-sm)) saturate(var(--ag-glass-saturate));
        border: 1px solid rgba(255, 255, 255, 0.65);
        box-shadow: inset 0 1px 0 0 var(--ag-glass-rim-top);
      }

      .bg-muted,
      .hover\\:bg-muted:hover {
        background: rgba(224, 242, 254, ${mutedRatio.toFixed(3)}) !important;
        backdrop-filter: blur(var(--ag-glass-blur-sm));
        -webkit-backdrop-filter: blur(var(--ag-glass-blur-sm));
      }

      /* Header actions & aux sidebar buttons */
      [data-testid="toggle-aux-sidebar"].bg-background,
      [data-testid="new-conversation-button"].bg-background {
        background: rgba(255, 255, 255, 0.52) !important;
        backdrop-filter: blur(var(--ag-glass-blur-sm)) saturate(var(--ag-glass-saturate)) !important;
        -webkit-backdrop-filter: blur(var(--ag-glass-blur-sm)) saturate(var(--ag-glass-saturate)) !important;
      }

      [data-testid="worked-for-collapsible"]:hover {
        background: rgba(255, 255, 255, 0.52) !important;
        backdrop-filter: blur(var(--ag-glass-blur-sm)) !important;
        -webkit-backdrop-filter: blur(var(--ag-glass-blur-sm)) !important;
      }

      /* 6. Menus, Dialogs, Popovers, Settings & Code Blocks */
      .settings-modal-backdrop {
        backdrop-filter: blur(14px) saturate(180%) !important;
        -webkit-backdrop-filter: blur(14px) saturate(180%) !important;
        background: rgba(8, 47, 73, 0.32) !important;
      }

      .settings-modal-container {
        background: linear-gradient(
          145deg,
          rgba(240, 249, 255, 0.90) 0%,
          rgba(224, 242, 254, 0.84) 50%,
          rgba(186, 230, 253, 0.80) 100%
        ) !important;
        backdrop-filter: blur(32px) saturate(200%) !important;
        -webkit-backdrop-filter: blur(32px) saturate(200%) !important;
        border: 1px solid rgba(255, 255, 255, 0.88) !important;
        box-shadow: 0 24px 56px -12px rgba(2, 132, 199, 0.35), inset 0 1.5px 0 0 rgba(255, 255, 255, 0.95) !important;
      }

      .settings-modal-container .bg-background {
        background: transparent !important;
        background-color: transparent !important;
      }

      [role="dialog"]:not(.settings-modal-container),
      [role="menu"],
      [role="listbox"],
      .agy-overlay,
      .surface-glass,
      [data-radix-popper-content-wrapper] > div,
      div.z-\[6000\] > div,
      .agwv-menu {
        background: linear-gradient(
          135deg,
          rgba(240, 249, 255, 0.88) 0%,
          rgba(224, 242, 254, 0.80) 100%
        ) !important;
        backdrop-filter: blur(calc(var(--ag-glass-blur) * 1.35)) saturate(var(--ag-glass-saturate)) !important;
        -webkit-backdrop-filter: blur(calc(var(--ag-glass-blur) * 1.35)) saturate(var(--ag-glass-saturate)) !important;
        border: 1px solid rgba(255, 255, 255, 0.82) !important;
        box-shadow: 0 16px 38px -6px rgba(2, 132, 199, 0.24), inset 0 1px 0 0 rgba(255, 255, 255, 0.90) !important;
      }

      pre {
        background: rgba(240, 249, 255, 0.64) !important;
        backdrop-filter: blur(var(--ag-glass-blur-sm)) saturate(var(--ag-glass-saturate)) !important;
        -webkit-backdrop-filter: blur(var(--ag-glass-blur-sm)) saturate(var(--ag-glass-saturate)) !important;
        border: 1px solid rgba(255, 255, 255, 0.72) !important;
        box-shadow: inset 0 1px 0 0 var(--ag-glass-rim-top);
      }

      code:not(pre code) {
        background: rgba(2, 132, 199, 0.08) !important;
        color: #0369a1 !important;
        border-radius: 4px;
        padding: 1px 5px;
        border: 1px solid rgba(2, 132, 199, 0.15) !important;
      }

      .border-border {
        border-color: rgba(255, 255, 255, 0.52) !important;
      }
    `;
  }

  function ensureBackdropStage() {
    let stage = document.getElementById(STAGE_ID);
    if (currentConfig.enabled === false) {
      stage?.remove();
      return;
    }
    if (!stage) {
      stage = document.createElement('div');
      stage.id = STAGE_ID;
      document.body.prepend(stage);
    }
  }

  function syncPulseShadowDom() {
    const host = document.getElementById('ag-pulse-status-bar');
    if (!host || !host.shadowRoot) return;
    let pulseStyle = host.shadowRoot.getElementById(PULSE_STYLE_ID);
    if (currentConfig.enabled === false || currentConfig.pulseGlass === false) {
      pulseStyle?.remove();
      return;
    }
    if (!pulseStyle) {
      pulseStyle = document.createElement('style');
      pulseStyle.id = PULSE_STYLE_ID;
      host.shadowRoot.appendChild(pulseStyle);
    }
    const blurPx = `${Math.max(10, Number(currentConfig.blur) || 22)}px`;
    const satPct = `${Math.max(100, Number(currentConfig.saturation) || 190)}%`;
    const nextCss = `
      :host {
        --pulse-card: rgba(240, 249, 255, 0.68) !important;
        --pulse-foreground: #082f49 !important;
        --pulse-label: #0c4a6e !important;
        --pulse-muted: #0369a1 !important;
        --pulse-accent: #0284c7 !important;
        --pulse-border: rgba(255, 255, 255, 0.75) !important;
      }
      .bar .chip, .card, .menu, .guide {
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.68), rgba(224, 242, 254, 0.56)) !important;
        backdrop-filter: blur(${blurPx}) saturate(${satPct}) !important;
        -webkit-backdrop-filter: blur(${blurPx}) saturate(${satPct}) !important;
        border: 1px solid rgba(255, 255, 255, 0.78) !important;
        box-shadow: 0 8px 24px -4px rgba(2, 132, 199, 0.16), inset 0 1px 0 0 rgba(255, 255, 255, 0.88) !important;
      }
    `;
    if (pulseStyle.textContent !== nextCss) {
      pulseStyle.textContent = nextCss;
    }
  }

  function ensureQuickPill() {
    let pill = document.getElementById(PILL_ID);
    if (currentConfig.floatingPill === false) {
      pill?.remove();
      return;
    }
    if (!pill) {
      pill = document.createElement('div');
      pill.id = PILL_ID;
      const shadow = pill.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host {
            display: inline-flex;
            align-items: center;
            z-index: 60;
            font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
            user-select: none;
            -webkit-app-region: no-drag;
            app-region: no-drag;
          }
          :host([data-mode="inline"]) {
            position: relative;
            margin-right: 4px;
          }
          :host([data-mode="fixed"]) {
            position: fixed;
            right: 44px;
            top: 41px;
          }
          .pill {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            height: 26px;
            padding: 0 10px;
            border-radius: 999px;
            font-size: 11.5px;
            font-weight: 600;
            white-space: nowrap;
            color: #0c4a6e;
            background: linear-gradient(135deg, rgba(255, 255, 255, 0.72), rgba(186, 230, 253, 0.62));
            backdrop-filter: blur(18px) saturate(190%);
            -webkit-backdrop-filter: blur(18px) saturate(190%);
            border: 1px solid rgba(255, 255, 255, 0.84);
            box-shadow: 0 4px 14px rgba(2, 132, 199, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.90);
            cursor: pointer;
            transition: transform 0.15s ease, box-shadow 0.15s ease;
          }
          .pill:hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 18px rgba(2, 132, 199, 0.25), inset 0 1px 0 #ffffff;
          }
          .dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: linear-gradient(135deg, #0ea5e9, #38bdf8);
            box-shadow: 0 0 6px #0ea5e9;
          }
          .pill[data-enabled="false"] .dot {
            background: #94a3b8;
            box-shadow: none;
          }
        </style>
        <button class="pill" id="btn" type="button">
          <span class="dot"></span>
          <span id="label"></span>
        </button>
      `;
      const btn = shadow.getElementById('btn');
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const nextEnabled = currentConfig.enabled === false;
        applyConfig({ ...currentConfig, enabled: nextEnabled });
        window.agGlassHost?.setPreferences?.({ enabled: nextEnabled });
      });
    }

    const anchorEl =
      document.querySelector('[data-testid="app-update-button"]') ||
      document.querySelector('[data-testid="titlebar-more-actions"]') ||
      document.querySelector('[data-testid="toggle-overview-panel"]') ||
      document.querySelector('[data-testid="toggle-aux-sidebar"]') ||
      document.querySelector('[data-testid="pane-titlebar-toolbar"] > div');
    const actionBar = anchorEl?.parentElement;
    if (actionBar) {
      pill.dataset.mode = 'inline';
      if (pill.parentElement !== actionBar || actionBar.firstElementChild !== pill) {
        actionBar.prepend(pill);
      }
    } else {
      pill.dataset.mode = 'fixed';
      if (pill.parentElement !== document.body) {
        document.body.appendChild(pill);
      }
    }

    const shadow = pill.shadowRoot;
    if (shadow) {
      const btn = shadow.getElementById('btn');
      const label = shadow.getElementById('label');
      const lang = currentConfig.language === 'en' ? 'en' : 'zh';
      const enabled = currentConfig.enabled !== false;
      btn.dataset.enabled = String(enabled);
      label.textContent = enabled
        ? (lang === 'en' ? 'Sky Azure · On' : '晴空碧海 · 已开启')
        : (lang === 'en' ? 'Sky Azure · Off' : '晴空碧海 · 已关闭');
      btn.title = lang === 'en'
        ? 'Click to toggle Sky Azure frosted glassmorphism'
        : '点击开启 / 关闭「晴空碧海」毛玻璃效果';
    }
  }

  function applyConfig(nextConfig) {
    if (disposed) return;
    if (nextConfig && typeof nextConfig === 'object') {
      currentConfig = { ...currentConfig, ...nextConfig };
      saveCached(currentConfig);
    }
    ensureBackdropStage();

    try {
      window.electronNative?.setTitleBarOverlay?.({
        color: '#00000000',
        symbolColor: '#0c4a6e',
        glassEnabled: currentConfig.enabled !== false,
        bgOpacity: Number(currentConfig.bgOpacity) ?? 22,
        windowBackdrop: currentConfig.windowBackdrop || 'blurbehind',
      });
    } catch {}

    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    const cssText = buildCss(currentConfig);
    if (style.textContent !== cssText) {
      style.textContent = cssText;
    }
    syncPulseShadowDom();
    ensureQuickPill();
  }

  window.__agGlassApplyConfig = applyConfig;
  window.__agGlassGetConfig = () => ({ ...currentConfig });
  window.__agGlassDispose = () => {
    disposed = true;
    themeObserver?.disconnect();
    clearInterval(pulseTimer);
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(STAGE_ID)?.remove();
    document.getElementById(PILL_ID)?.remove();
    document.getElementById('ag-pulse-status-bar')?.shadowRoot?.getElementById(PULSE_STYLE_ID)?.remove();
    delete window.__agGlassApplyConfig;
    delete window.__agGlassGetConfig;
    delete window.__agGlassDispose;
    delete window.__agGlassInstalled;
  };

  window.__agGlassInstalled = true;
  applyConfig(currentConfig);

  window.agGlassHost?.getPreferences?.().then(res => {
    if (res?.config && !disposed) {
      applyConfig(res.config);
    }
  }).catch(() => {});

  themeObserver = new MutationObserver(() => {
    if (!disposed) applyConfig(currentConfig);
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });

  pulseTimer = setInterval(() => {
    if (!disposed) {
      syncPulseShadowDom();
      ensureQuickPill();
    }
  }, 1500);
};
