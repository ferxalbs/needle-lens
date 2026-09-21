import {
  createLensConfig,
  duplicateLens,
  restoreSafeDefaults,
  validateLensConfig,
  type LensConfig,
  type LensStrictness,
} from '../domain/lens';
import { MAX_ITEMS } from '../domain/types';
import type { CacheRetention } from '../cache/decision-cache';

export const SETTINGS_STORAGE_KEY = 'needleLensSettings';
export const CONSENT_VERSION = 1 as const;

export type ConsentRecord = {
  version: 1;
  grantedAt: string;
};

export type LensDefaults = {
  strictness: LensStrictness;
  maxActions: 1 | 2 | 3;
  maxItems: number;
};

export type AppSettings = {
  version: 1;
  lenses: LensConfig[];
  activeLensId: string;
  defaults: LensDefaults;
  cacheRetention: CacheRetention;
  consent?: ConsentRecord;
};

export type SettingsStorageLike = {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear?: () => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeDefaults(): AppSettings {
  const lenses = restoreSafeDefaults();
  return {
    version: 1,
    lenses,
    activeLensId: lenses[0]!.id,
    defaults: { strictness: 'balanced', maxActions: 3, maxItems: 30 },
    cacheRetention: 'session',
  };
}

function parseConsent(value: unknown): ConsentRecord | undefined {
  if (!isRecord(value) || value.version !== CONSENT_VERSION || typeof value.grantedAt !== 'string' || Number.isNaN(Date.parse(value.grantedAt))) return undefined;
  return { version: 1, grantedAt: new Date(value.grantedAt).toISOString() };
}

function parseSettings(value: unknown): AppSettings | undefined {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.lenses) || typeof value.activeLensId !== 'string') return undefined;
  const lenses: LensConfig[] = [];
  for (const rawLens of value.lenses) {
    try {
      const lens = validateLensConfig(rawLens);
      if (lenses.some((entry) => entry.id === lens.id)) return undefined;
      lenses.push(lens);
    } catch {
      return undefined;
    }
  }
  if (lenses.length === 0 || !lenses.some((lens) => lens.id === value.activeLensId)) return undefined;
  if (!isRecord(value.defaults)) return undefined;
  const defaults = value.defaults;
  if (
    !['exploratory', 'balanced', 'strict'].includes(String(defaults.strictness)) ||
    (defaults.maxActions !== 1 && defaults.maxActions !== 2 && defaults.maxActions !== 3) ||
    typeof defaults.maxItems !== 'number' || !Number.isInteger(defaults.maxItems) || defaults.maxItems < 1 || defaults.maxItems > MAX_ITEMS
  ) return undefined;
  if (value.cacheRetention !== 'off' && value.cacheRetention !== 'session' && value.cacheRetention !== '24h') return undefined;
  const consent = parseConsent(value.consent);
  return {
    version: 1,
    lenses,
    activeLensId: value.activeLensId,
    defaults: {
      strictness: defaults.strictness as LensStrictness,
      maxActions: defaults.maxActions,
      maxItems: defaults.maxItems,
    },
    cacheRetention: value.cacheRetention,
    ...(consent ? { consent } : {}),
  };
}

export class SettingsStore {
  constructor(private readonly storage: SettingsStorageLike) {}

  async get(): Promise<AppSettings> {
    const values = await this.storage.get(SETTINGS_STORAGE_KEY);
    const parsed = parseSettings(values[SETTINGS_STORAGE_KEY]);
    if (parsed) return parsed;
    const defaults = safeDefaults();
    await this.storage.set({ [SETTINGS_STORAGE_KEY]: defaults });
    return defaults;
  }

  async save(settings: AppSettings): Promise<AppSettings> {
    const parsed = parseSettings(settings);
    if (!parsed) throw new Error('Settings were invalid.');
    await this.storage.set({ [SETTINGS_STORAGE_KEY]: parsed });
    return parsed;
  }

  async saveLens(lens: LensConfig): Promise<AppSettings> {
    const valid = validateLensConfig(lens);
    const settings = await this.get();
    const exists = settings.lenses.some((entry) => entry.id === valid.id);
    const lenses = exists
      ? settings.lenses.map((entry) => entry.id === valid.id ? valid : entry)
      : [...settings.lenses, valid];
    return this.save({ ...settings, lenses, activeLensId: exists ? settings.activeLensId : valid.id });
  }

  async createLens(input: Omit<LensConfig, 'id' | 'version' | 'createdAt' | 'updatedAt'>): Promise<LensConfig> {
    const lens = createLensConfig(input);
    await this.saveLens(lens);
    return lens;
  }

  async duplicateLens(id: string): Promise<LensConfig> {
    const settings = await this.get();
    const source = settings.lenses.find((lens) => lens.id === id);
    if (!source) throw new Error('Lens was not found.');
    const duplicate = duplicateLens(source);
    await this.saveLens(duplicate);
    return duplicate;
  }

  async deleteLens(id: string): Promise<AppSettings> {
    const settings = await this.get();
    if (settings.lenses.length <= 1) throw new Error('Keep at least one Lens configuration.');
    const lenses = settings.lenses.filter((lens) => lens.id !== id);
    const activeLensId = settings.activeLensId === id ? lenses[0]!.id : settings.activeLensId;
    return this.save({ ...settings, lenses, activeLensId });
  }

  async setActiveLens(id: string): Promise<AppSettings> {
    const settings = await this.get();
    if (!settings.lenses.some((lens) => lens.id === id)) throw new Error('Lens was not found.');
    return this.save({ ...settings, activeLensId: id });
  }

  async setDefaults(defaults: LensDefaults & { cacheRetention: CacheRetention }): Promise<AppSettings> {
    const settings = await this.get();
    return this.save({
      ...settings,
      defaults: {
        strictness: defaults.strictness,
        maxActions: defaults.maxActions,
        maxItems: defaults.maxItems,
      },
      cacheRetention: defaults.cacheRetention,
    });
  }

  async grantConsent(): Promise<AppSettings> {
    const settings = await this.get();
    return this.save({ ...settings, consent: { version: 1, grantedAt: new Date().toISOString() } });
  }

  async revokeConsent(): Promise<AppSettings> {
    const settings = await this.get();
    const next = { ...settings };
    delete next.consent;
    return this.save(next);
  }

  async clearAll(): Promise<void> {
    if (this.storage.clear) await this.storage.clear();
    else await this.storage.remove(SETTINGS_STORAGE_KEY);
  }

  async exportLens(id: string): Promise<string> {
    const settings = await this.get();
    const lens = settings.lenses.find((entry) => entry.id === id);
    if (!lens) throw new Error('Lens was not found.');
    return JSON.stringify(lens, null, 2);
  }

  async importLens(value: unknown): Promise<LensConfig> {
    const lens = validateLensConfig(value);
    await this.saveLens(lens);
    return lens;
  }
}

export function defaultLensFor(settings: AppSettings): LensConfig {
  return settings.lenses.find((lens) => lens.id === settings.activeLensId) ?? settings.lenses[0]!;
}
