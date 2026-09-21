import type { CacheEntry, JevSignals, Mode } from '../domain/types';
import {
  CONTRACT_VERSION,
  MODEL,
  POLICY_VERSION,
  PROVIDER,
} from '../domain/types';
import { sha256Hex, stableJson } from '../security/hash';

export const CACHE_STORAGE_KEY = 'needleLensDecisionCache';
export const CACHE_MAX_ENTRIES = 500;
export const CACHE_MAX_BYTES = 5 * 1024 * 1024;

export type SessionStorageLike = {
  get(keys: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string): Promise<void>;
};

function isSignal(value: unknown): value is JevSignals {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const scoreFields = ['matchesGoal', 'urgency', 'novelty'];
  const noulFields = ['needIsReal', 'userCanHelp', 'hasConcreteAction', 'containsEvidence', 'isPromotional'];
  return scoreFields.every((field) => {
    const signal = record[field];
    return (
      typeof signal === 'object' &&
      signal !== null &&
      typeof (signal as Record<string, unknown>).value === 'number' &&
      typeof (signal as Record<string, unknown>).confidence === 'number'
    );
  }) && noulFields.every((field) => {
    const signal = record[field];
    return (
      typeof signal === 'object' &&
      signal !== null &&
      typeof (signal as Record<string, unknown>).value === 'number'
    );
  });
}

function isCacheEntry(value: unknown): value is CacheEntry {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    isSignal(record.signals) &&
    typeof record.measuredAt === 'number' &&
    typeof record.model === 'string' &&
    typeof record.contractVersion === 'string' &&
    typeof record.policyVersion === 'string'
  );
}

export async function buildCacheKey(input: {
  provider?: string;
  model?: string;
  contractVersion?: string;
  policyVersion?: string;
  mode: Mode;
  normalizedGoal: string;
  normalizedPostText: string;
}): Promise<string> {
  return sha256Hex(
    stableJson({
      provider: input.provider ?? PROVIDER,
      model: input.model ?? MODEL,
      contractVersion: input.contractVersion ?? CONTRACT_VERSION,
      policyVersion: input.policyVersion ?? POLICY_VERSION,
      mode: input.mode,
      normalizedGoal: input.normalizedGoal,
      normalizedPostText: input.normalizedPostText,
    }),
  );
}

export class DecisionCache {
  private readonly entries = new Map<string, CacheEntry>();
  private hydrated = false;

  constructor(private readonly storage?: SessionStorageLike) {}

  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    if (!this.storage) return;
    const stored = await this.storage.get(CACHE_STORAGE_KEY);
    const raw = stored[CACHE_STORAGE_KEY];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return;
    for (const [key, value] of Object.entries(raw)) {
      if (isCacheEntry(value)) this.entries.set(key, value);
    }
    this.prune();
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  async set(key: string, value: CacheEntry): Promise<void> {
    if (!isCacheEntry(value)) throw new Error('Invalid decision cache entry.');
    this.entries.delete(key);
    this.entries.set(key, value);
    this.prune();
    await this.persist();
  }

  async clear(): Promise<void> {
    this.entries.clear();
    if (this.storage) await this.storage.remove(CACHE_STORAGE_KEY);
  }

  size(): number {
    return this.entries.size;
  }

  values(): readonly CacheEntry[] {
    return [...this.entries.values()];
  }

  private prune(): void {
    while (this.entries.size > CACHE_MAX_ENTRIES || this.serializedBytes() > CACHE_MAX_BYTES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  private serializedBytes(): number {
    return new TextEncoder().encode(JSON.stringify(Object.fromEntries(this.entries))).byteLength;
  }

  private async persist(): Promise<void> {
    if (this.storage) {
      await this.storage.set({
        [CACHE_STORAGE_KEY]: Object.fromEntries(this.entries),
      });
    }
  }
}
