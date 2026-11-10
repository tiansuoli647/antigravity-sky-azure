// Persistent preferences for Antigravity Glass Studio (Single Theme: Sky Azure See-Through).
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { platformPaths } from './platform.mjs';

export const SKY_AZURE_THEME = {
  id: 'sky',
  nameZh: '晴空碧海',
  nameEn: 'Sky Azure',
  descZh: '桌面同款海天蔚蓝毛玻璃，兼具真实磨砂雾化质感与柔和窗口透视',
  descEn: 'Sky-azure frosted glass with tactile blur and subtle behind-window translucency',
  blur: 22,
  saturation: 190,
  bgOpacity: 22,
  sidebarOpacity: 42,
  cardOpacity: 58,
  specular: 75,
};

export const DEFAULT_PREFERENCES = {
  enabled: true,
  language: 'zh',
  blur: SKY_AZURE_THEME.blur,
  saturation: SKY_AZURE_THEME.saturation,
  bgOpacity: SKY_AZURE_THEME.bgOpacity,
  sidebarOpacity: SKY_AZURE_THEME.sidebarOpacity,
  cardOpacity: SKY_AZURE_THEME.cardOpacity,
  specular: SKY_AZURE_THEME.specular,
  windowBackdrop: 'blurbehind', // 'blurbehind' | 'acrylic' | 'clear'
  pulseGlass: true,
  floatingPill: true,
};

function clamp(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizePreferences(raw = {}, base = DEFAULT_PREFERENCES) {
  const merged = { ...base, ...(raw && typeof raw === 'object' ? raw : {}) };
  const validBackdrops = ['blurbehind', 'acrylic', 'clear'];
  return {
    enabled: typeof merged.enabled === 'boolean' ? merged.enabled : base.enabled,
    language: merged.language === 'en' ? 'en' : 'zh',
    blur: clamp(merged.blur, 0, 48, base.blur),
    saturation: clamp(merged.saturation, 100, 240, base.saturation),
    bgOpacity: clamp(merged.bgOpacity, 0, 85, base.bgOpacity),
    sidebarOpacity: clamp(merged.sidebarOpacity, 8, 90, base.sidebarOpacity),
    cardOpacity: clamp(merged.cardOpacity, 15, 92, base.cardOpacity),
    specular: clamp(merged.specular, 0, 100, base.specular),
    windowBackdrop: validBackdrops.includes(merged.windowBackdrop) ? merged.windowBackdrop : base.windowBackdrop,
    pulseGlass: typeof merged.pulseGlass === 'boolean' ? merged.pulseGlass : base.pulseGlass,
    floatingPill: typeof merged.floatingPill === 'boolean' ? merged.floatingPill : base.floatingPill,
  };
}

export class PreferencesStore {
  constructor({ file = platformPaths().settings } = {}) {
    this.file = file;
  }

  async readRaw() {
    try {
      const text = await readFile(this.file, 'utf8');
      if (text.length > 524288) return {};
      const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  async get() {
    const raw = await this.readRaw();
    return normalizePreferences(raw, DEFAULT_PREFERENCES);
  }

  async snapshot() {
    return {
      config: await this.get(),
      theme: SKY_AZURE_THEME,
    };
  }

  async set(patch = {}) {
    const currentRaw = await this.readRaw();
    const current = normalizePreferences(currentRaw, DEFAULT_PREFERENCES);
    const next = normalizePreferences(patch, current);
    const toSave = { ...next, updatedAt: new Date().toISOString() };
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(toSave, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
      await rename(temp, this.file);
    } catch (err) {
      try { await unlink(temp); } catch {}
      throw err;
    }
    return {
      config: next,
      theme: SKY_AZURE_THEME,
    };
  }
}
