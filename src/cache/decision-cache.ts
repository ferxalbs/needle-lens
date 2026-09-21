import type { CacheEntry, JevSignals, LensConfig } from '../domain/types';
import {
  CONTRACT_VERSION,
  MODEL,
  POLICY_VERSION,
  PROVIDER,
} from '../domain/types';
import { lensForDecision } from '../domain/lens';
import { sha256Hex, stableJson } from '../security/hash';

export const CACHE_STORAGE_KEY = 'needleLensDecisionCache';
export const CACHE_MAX_ENTRIES = 500;
export const CACHE_MAX_BYTES = 5 * 1024 * 1024;
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type CacheRetention = 'off' | 'session' | '24h';

export type SessionStorageLike = {
  get(keys: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string): Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isProbabilityMap(value: unknown): boolean {
  return isRecord(value) && Object.entries(value).length >= 2 && Object.values(value).every(
    (entry) => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 && entry <= 1,
  );
}

function isChoice(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.choice === 'string' && isProbabilityMap(value.probabilities) &&
    typeof value.confidence === 'number' && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1;
}

function isScore(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.score === 'number' && Number.isFinite(value.score) &&
    typeof value.value === 'number' && Number.isFinite(value.value) && value.value >= 0 && value.value <= 1 &&
    isProbabilityMap(value.probabilities) && typeof value.confidence === 'number' && Number.isFinite(value.confidence) &&
    value.confidence >= 0 && value.confidence <= 1;
}

function isNoul(value: unknown): boolean {
  return isRecord(value) && typeof value.value === 'number' && Number.isFinite(value.value) && value.value >= 0 && value.value <= 1;
}

function isSignal(value: unknown): value is JevSignals {
  if (!isRecord(value)) return false;
  return isChoice(value.decision) && isChoice(value.relationship) && isScore(value.matchesGoal) &&
    isScore(value.evidenceStrength) && isScore(value.actionability) && isNoul(value.targetMatch) &&
    isNoul(value.hasConcreteNeed) && isNoul(value.matchesExclusion);
}

function isCacheEntry(value: unknown): value is CacheEntry {
  if (!isRecord(value)) return false;
  return isSignal(value.signals) && typeof value.measuredAt === 'number' && Number.isFinite(value.measuredAt) &&
    typeof value.model === 'string' && typeof value.contractVersion === 'string' && typeof value.policyVersion === 'string';
}

export async function buildCacheKey(input: {
  provider?: string;
  model?: string;
  contractVersion?: string;
  policyVersion?: string;
  lens?: LensConfig;
  mode?: LensConfig['mode'];
  normalizedGoal?: string;
  normalizedPostText: string;
}): Promise<string> {
  const lens = input.lens ? lensForDecision(input.lens) : {
    mode: input.mode ?? 'find_signal',
    goal: input.normalizedGoal ?? '',
    target: [],
    evidence: [],
    exclusions: [],
    desiredActions: [],
    strictness: 'balanced',
  };
  return sha256Hex(stableJson({
    provider: input.provider ?? PROVIDER,
    model: input.model ?? MODEL,
    contractVersion: input.contractVersion ?? CONTRACT_VERSION,
    policyVersion: input.policyVersion ?? POLICY_VERSION,
    lens,
    normalizedPostText: input.normalizedPostText,
  }));
}

export class DecisionCache {
  private readonly entries = new Map<string, CacheEntry>();
  private hydrated = false;
  private readonly retention: CacheRetention;
  private readonly now: () => number;

  constructor(
    private readonly storage?: SessionStorageLike,
    options: { retention?: CacheRetention; now?: () => number } = {},
  ) {
    this.retention = options.retention ?? 'session';
    this.now = options.now ?? Date.now;
  }

  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    if (this.retention === 'off' || !this.storage) return;
    const stored = await this.storage.get(CACHE_STORAGE_KEY);
    const raw = stored[CACHE_STORAGE_KEY];
    if (!isRecord(raw)) return;
    for (const [key, value] of Object.entries(raw)) {
      if (isCacheEntry(value) && !this.isExpired(value)) this.entries.set(key, value);
    }
    this.prune();
  }

  get(key: string): CacheEntry | undefined {
    if (this.retention === 'off') return undefined;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  async set(key: string, value: CacheEntry): Promise<void> {
    if (this.retention === 'off') return;
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
    return [...this.entries.values()].filter((entry) => !this.isExpired(entry));
  }

  private isExpired(entry: CacheEntry): boolean {
    return this.retention === '24h' && this.now() - entry.measuredAt > CACHE_TTL_MS;
  }

  private prune(): void {
    for (const [key, entry] of this.entries) if (this.isExpired(entry)) this.entries.delete(key);
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
    if (this.storage && this.retention !== 'off') {
      await this.storage.set({ [CACHE_STORAGE_KEY]: Object.fromEntries(this.entries) });
    }
  }
}
