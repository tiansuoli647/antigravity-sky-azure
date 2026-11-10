/**
 * Antigravity Glass Studio - 晴空碧海透视面板 (Antigravity 2.23+ UI)
 */

const I18N = {
  zh: {
    titleMain: '晴空碧海 · 透视毛玻璃',
    subtitleMain: '桌面同款海天蔚蓝专属主题 · 窗口后方内容实时穿透',
    enabledOn: '已开启',
    enabledOff: '已停用',
    themeBadge: '晴空碧海 (Sky Azure)',
    secBackdrop: '窗口后方内容透视模式 (DWM)',
    secBackdropHint: '控制底层操作系统窗口穿透方式',
    mBlurTitle: '清透毛玻璃透视 (推荐)',
    mBlurDesc: '清晰透视窗口后方壁纸与窗口，失焦亦保持透视',
    mClearTitle: '高清无损穿透',
    mClearDesc: '底层窗口 100% 无模糊穿透，仅内部卡片毛玻璃',
    mAcrylicTitle: 'Win11 原生重度亚克力',
    mAcrylicDesc: '系统 DWM 重度磨砂模糊窗口后方内容',
    secOpacity: '晴空蓝透视度调节',
    secOpacityHint: '数值越低，窗口后面的桌面与内容越清晰',
    lblBgOpacity: '主画布晴空滤镜浓度 (Canvas)',
    lblSidebarOpacity: '顶栏与侧边栏天蓝浓度 (Sidebar)',
    lblCardOpacity: '对话气泡与输入框云白浓度 (Cards)',
    secRefraction: '内部毛玻璃折射与冰晶高光',
    resetBtn: '恢复默认',
    lblBlur: '组件高斯模糊半径 (Blur)',
    lblSaturation: '晴空色彩饱和度增强 (Saturation)',
    lblSpecular: '冰白边缘折射高光 (Specular Rim)',
    secIntegration: '宿主联动设置',
    lblFloatingPill: '在主窗口右上角显示「晴空碧海」一键开关胶囊',
    lblPulseGlass: '为 Antigrative Dashboard 状态栏同步启用晴空蓝毛玻璃',
    cdpMounted: '已实时挂载',
    cdpWaiting: '等待连接主窗口',
    metricBlur: '模糊',
    metricSat: '饱和度',
    metricSeeThrough: '透视率',
  },
  en: {
    titleMain: 'Sky Azure · See-Through Glass',
    subtitleMain: 'Exclusive Sky-Cerulean Theme with Behind-Window See-Through',
    enabledOn: 'Enabled',
    enabledOff: 'Disabled',
    themeBadge: 'Sky Azure',
    secBackdrop: 'Behind-Window See-Through Mode (DWM)',
    secBackdropHint: 'OS window transparency mode',
    mBlurTitle: 'Clear Frosted See-Through (Recommended)',
    mBlurDesc: 'Crisp see-through of desktop & windows behind, stays active when unfocused',
    mClearTitle: 'Pure Unblurred See-Through',
    mClearDesc: '100% clear window background, frost only on inner cards & sidebar',
    mAcrylicTitle: 'Win11 Heavy Acrylic',
    mAcrylicDesc: 'Heavy OS DWM acrylic blur behind window',
    secOpacity: 'See-Through Opacity Hierarchy',
    secOpacityHint: 'Lower values make behind-window content clearer',
    lblBgOpacity: 'Main Canvas Sky Veil Opacity',
    lblSidebarOpacity: 'Topbar & Sidebar Sky Opacity',
    lblCardOpacity: 'Cards & Composer Cloud Opacity',
    secRefraction: 'Refraction & Ice Rim Highlight',
    resetBtn: 'Reset Defaults',
    lblBlur: 'Component Gaussian Blur',
    lblSaturation: 'Sky Saturation Boost',
    lblSpecular: 'Ice Specular Rim Highlight',
    secIntegration: 'Host Integration',
    lblFloatingPill: 'Show Quick Toggle Pill in Top-Right Titlebar',
    lblPulseGlass: 'Apply Sky Azure Glass to Antigrative Dashboard',
    cdpMounted: 'Live Mounted',
    cdpWaiting: 'Connecting',
    metricBlur: 'Blur',
    metricSat: 'Sat',
    metricSeeThrough: 'See-Through',
  },
};

let state = {
  config: null,
  health: { state: 'waiting' },
};

let saveTimer = null;

async function apiFetch(path, options = {}) {
  if (window.sidecar?.fetch) {
    const res = await window.sidecar.fetch(path, options);
    return res.json();
  }
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  return res.json();
}

function t(key) {
  const lang = state.config?.language === 'en' ? 'en' : 'zh';
  return I18N[lang]?.[key] || I18N.zh[key] || key;
}

function updateSliderFill(input) {
  if (!input) return;
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const val = Number(input.value) || 0;
  const pct = Math.max(0, Math.min(100, Math.round(((val - min) / (max - min)) * 100)));
  input.style.background = `linear-gradient(to right, var(--slider-fill) 0%, var(--slider-fill) ${pct}%, var(--slider-track) ${pct}%, var(--slider-track) 100%)`;
}

function updatePreview() {
  const cfg = state.config;
  if (!cfg) return;

  const card = document.getElementById('preview-glass-card');
  const dot = card?.querySelector('.preview-pulse-dot');
  if (!card) return;

  const isDark = document.body.classList.contains('theme-dark') ||
                 document.body.classList.contains('vscode-dark') ||
                 window.matchMedia('(prefers-color-scheme: dark)').matches;

  const enabled = cfg.enabled !== false;
  const blurVal = Number(cfg.blur) || 22;
  const satVal = Number(cfg.saturation) || 190;
  const specRatio = Math.min(1, Math.max(0, (Number(cfg.specular) || 75) / 100));
  const cardAlpha = Math.min(0.95, Math.max(0.15, (Number(cfg.cardOpacity) || 58) / 100)).toFixed(2);
  const seeThroughPct = Math.max(0, 100 - (Number(cfg.bgOpacity) || 22));

  if (!enabled) {
    card.style.backdropFilter = 'none';
    card.style.webkitBackdropFilter = 'none';
    card.style.background = isDark ? 'rgba(30, 41, 59, 0.92)' : 'rgba(255, 255, 255, 0.92)';
    card.style.boxShadow = 'none';
    if (dot) {
      dot.style.background = '#94a3b8';
      dot.style.boxShadow = 'none';
    }
  } else {
    const mode = cfg.windowBackdrop || 'blurbehind';
    const filterBlur = mode === 'clear' ? Math.max(4, Math.round(blurVal * 0.45)) : blurVal;

    card.style.backdropFilter = `blur(${filterBlur}px) saturate(${satVal}%)`;
    card.style.webkitBackdropFilter = `blur(${filterBlur}px) saturate(${satVal}%)`;

    const rimAlpha = (0.35 + specRatio * 0.6).toFixed(2);
    if (isDark) {
      card.style.background = `rgba(15, 23, 42, ${cardAlpha})`;
      card.style.boxShadow = `0 8px 24px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(125, 211, 252, ${rimAlpha})`;
      card.style.border = `1px solid rgba(56, 189, 248, ${(0.2 + specRatio * 0.25).toFixed(2)})`;
    } else {
      card.style.background = `rgba(255, 255, 255, ${cardAlpha})`;
      card.style.boxShadow = `0 8px 24px rgba(2, 132, 199, 0.16), inset 0 1px 0 rgba(255, 255, 255, ${rimAlpha})`;
      card.style.border = `1px solid rgba(255, 255, 255, ${(0.5 + specRatio * 0.45).toFixed(2)})`;
    }

    if (dot) {
      dot.style.background = 'var(--sky-accent)';
      dot.style.boxShadow = '0 0 8px var(--sky-accent)';
    }
  }

  document.getElementById('preview-theme-badge').textContent = t('themeBadge');
  document.getElementById('preview-metrics').textContent =
    `${t('metricBlur')} ${blurVal}px · ${t('metricSat')} ${satVal}% · ${t('metricSeeThrough')} ${seeThroughPct}%`;

  const healthBadge = document.getElementById('engine-health-badge');
  const isMounted = state.health?.state === 'mounted';
  healthBadge.textContent = isMounted ? t('cdpMounted') : t('cdpWaiting');
  healthBadge.classList.toggle('status-live', isMounted);
}

function syncControlsFromState() {
  const cfg = state.config;
  if (!cfg) return;

  document.getElementById('title-main').textContent = t('titleMain');
  document.getElementById('subtitle-main').textContent = t('subtitleMain');
  document.getElementById('lang-btn').textContent = cfg.language === 'en' ? '中文' : 'EN';

  const masterBtn = document.getElementById('master-toggle');
  masterBtn.setAttribute('aria-pressed', String(cfg.enabled));
  document.getElementById('toggle-label').textContent = cfg.enabled ? t('enabledOn') : t('enabledOff');

  document.getElementById('sec-backdrop').textContent = t('secBackdrop');
  document.getElementById('sec-backdrop-hint').textContent = t('secBackdropHint');
  document.getElementById('m-blur-title').textContent = t('mBlurTitle');
  document.getElementById('m-blur-desc').textContent = t('mBlurDesc');
  document.getElementById('m-clear-title').textContent = t('mClearTitle');
  document.getElementById('m-clear-desc').textContent = t('mClearDesc');
  document.getElementById('m-acrylic-title').textContent = t('mAcrylicTitle');
  document.getElementById('m-acrylic-desc').textContent = t('mAcrylicDesc');

  document.getElementById('sec-opacity').textContent = t('secOpacity');
  document.getElementById('sec-opacity-hint').textContent = t('secOpacityHint');
  document.getElementById('lbl-bg-opacity').textContent = t('lblBgOpacity');
  document.getElementById('lbl-sidebar-opacity').textContent = t('lblSidebarOpacity');
  document.getElementById('lbl-card-opacity').textContent = t('lblCardOpacity');
  document.getElementById('sec-refraction').textContent = t('secRefraction');
  document.getElementById('reset-btn').textContent = t('resetBtn');
  document.getElementById('lbl-blur').textContent = t('lblBlur');
  document.getElementById('lbl-saturation').textContent = t('lblSaturation');
  document.getElementById('lbl-specular').textContent = t('lblSpecular');
  document.getElementById('sec-integration').textContent = t('secIntegration');
  document.getElementById('lbl-floating-pill').textContent = t('lblFloatingPill');
  document.getElementById('lbl-pulse-glass').textContent = t('lblPulseGlass');

  const selectedMode = cfg.windowBackdrop || 'blurbehind';
  for (const btn of document.querySelectorAll('.mode-btn')) {
    const isSelected = btn.dataset.mode === selectedMode;
    btn.setAttribute('aria-selected', String(isSelected));
    btn.setAttribute('aria-checked', String(isSelected));
  }

  const bindRange = (id, valId, val, unit) => {
    const input = document.getElementById(id);
    const out = document.getElementById(valId);
    if (input) {
      input.value = String(val);
      updateSliderFill(input);
    }
    if (out) out.textContent = `${val} ${unit}`;
  };

  bindRange('rng-bg-opacity', 'val-bg-opacity', cfg.bgOpacity, '%');
  bindRange('rng-sidebar-opacity', 'val-sidebar-opacity', cfg.sidebarOpacity, '%');
  bindRange('rng-card-opacity', 'val-card-opacity', cfg.cardOpacity, '%');
  bindRange('rng-blur', 'val-blur', cfg.blur, 'px');
  bindRange('rng-saturation', 'val-saturation', cfg.saturation, '%');
  bindRange('rng-specular', 'val-specular', cfg.specular, '%');

  document.getElementById('chk-floating-pill').checked = cfg.floatingPill !== false;
  document.getElementById('chk-pulse-glass').checked = cfg.pulseGlass !== false;

  updatePreview();
}

async function pushUpdate(patch, immediate = false) {
  if (state.config) {
    state.config = { ...state.config, ...patch };
    updatePreview();
  }
  clearTimeout(saveTimer);
  const send = async () => {
    try {
      const res = await apiFetch('/api/preferences', {
        method: 'POST',
        body: JSON.stringify(patch),
      });
      if (res?.config) {
        state.config = res.config;
        state.health = res.health || state.health;
        syncControlsFromState();
      }
    } catch (err) {
      console.error('Failed to save preferences:', err);
    }
  };
  if (immediate) {
    await send();
  } else {
    saveTimer = setTimeout(send, 40);
  }
}

function wireEvents() {
  document.getElementById('lang-btn').addEventListener('click', () => {
    const nextLang = state.config?.language === 'en' ? 'zh' : 'en';
    void pushUpdate({ language: nextLang }, true);
  });

  document.getElementById('master-toggle').addEventListener('click', () => {
    void pushUpdate({ enabled: !state.config?.enabled }, true);
  });

  for (const btn of document.querySelectorAll('.mode-btn')) {
    btn.addEventListener('click', () => {
      void pushUpdate({ windowBackdrop: btn.dataset.mode }, true);
    });
  }

  document.getElementById('reset-btn').addEventListener('click', async () => {
    try {
      const res = await apiFetch('/api/preferences', {
        method: 'POST',
        body: JSON.stringify({ action: 'reset' }),
      });
      if (res?.config) {
        state.config = res.config;
        state.health = res.health || state.health;
        syncControlsFromState();
      }
    } catch (err) {
      console.error('Failed to reset preferences:', err);
    }
  });

  const sliderMap = [
    ['rng-bg-opacity', 'val-bg-opacity', 'bgOpacity', '%'],
    ['rng-sidebar-opacity', 'val-sidebar-opacity', 'sidebarOpacity', '%'],
    ['rng-card-opacity', 'val-card-opacity', 'cardOpacity', '%'],
    ['rng-blur', 'val-blur', 'blur', 'px'],
    ['rng-saturation', 'val-saturation', 'saturation', '%'],
    ['rng-specular', 'val-specular', 'specular', '%'],
  ];

  for (const [id, outId, key, unit] of sliderMap) {
    const el = document.getElementById(id);
    const out = document.getElementById(outId);
    el.addEventListener('input', () => {
      const val = Number(el.value);
      out.textContent = `${val} ${unit}`;
      updateSliderFill(el);
      void pushUpdate({ [key]: val }, false);
    });
  }

  document.getElementById('chk-floating-pill').addEventListener('change', e => {
    void pushUpdate({ floatingPill: e.target.checked }, true);
  });

  document.getElementById('chk-pulse-glass').addEventListener('change', e => {
    void pushUpdate({ pulseGlass: e.target.checked }, true);
  });
}

function setupThemeSync() {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    updatePreview();
    for (const id of ['rng-bg-opacity', 'rng-sidebar-opacity', 'rng-card-opacity', 'rng-blur', 'rng-saturation', 'rng-specular']) {
      updateSliderFill(document.getElementById(id));
    }
  };
  mql.addEventListener('change', onChange);

  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
}

async function init() {
  wireEvents();
  setupThemeSync();

  try {
    const initial = await apiFetch('/api/state');
    if (initial?.config) {
      state = initial;
      syncControlsFromState();
    }
  } catch (err) {
    console.error('Failed to fetch initial state:', err);
  }

  setInterval(async () => {
    try {
      const latest = await apiFetch('/api/state');
      if (latest?.health) {
        state.health = latest.health;
        updatePreview();
      }
    } catch {}
  }, 4000);
}

void init();
