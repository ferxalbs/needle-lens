import { describe, expect, it } from 'vitest';
import {
  CACHE_MAX_BYTES,
  CACHE_MAX_ENTRIES,
  DecisionCache,
  buildCacheKey,
} from '../src/cache/decision-cache';
import type { JevSignals } from '../src/domain/types';

const sampleSignals: JevSignals = {
  matchesGoal: { value: 0.8, confidence: 0.9 },
  urgency: { value: 0.6, confidence: 0.8 },
  novelty: { value: 0.7, confidence: 0.7 },
  needIsReal: { value: 0.7 },
  userCanHelp: { value: 0.8 },
  hasConcreteAction: { value: 0.8 },
  containsEvidence: { value: 0.6 },
  isPromotional: { value: 0.1 },
};

class MemoryStorage {
  value: Record<string, unknown> = {};
  async get(key: string) { return { [key]: this.value[key] }; }
  async set(items: Record<string, unknown>) { Object.assign(this.value, items); }
  async remove(key: string) { delete this.value[key]; }
}

describe('decision cache', () => {
  it('uses a digest key and changes when policy inputs change', async () => {
    const first = await buildCacheKey({ mode: 'find_people', normalizedGoal: 'help', normalizedPostText: 'a post' });
    const same = await buildCacheKey({ mode: 'find_people', normalizedGoal: 'help', normalizedPostText: 'a post' });
    const changed = await buildCacheKey({ mode: 'find_people', normalizedGoal: 'help', normalizedPostText: 'a different post' });
    const changedMode = await buildCacheKey({ mode: 'find_signal', normalizedGoal: 'help', normalizedPostText: 'a post' });
    const changedGoal = await buildCacheKey({ mode: 'find_people', normalizedGoal: 'different goal', normalizedPostText: 'a post' });
    const changedPolicy = await buildCacheKey({ policyVersion: 'policy-v2', mode: 'find_people', normalizedGoal: 'help', normalizedPostText: 'a post' });
    expect(first).toBe(same);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(changed);
    expect(first).not.toBe(changedMode);
    expect(first).not.toBe(changedGoal);
    expect(first).not.toBe(changedPolicy);
  });

  it('persists signals without raw post text', async () => {
    const storage = new MemoryStorage();
    const cache = new DecisionCache(storage);
    await cache.set('digest', {
      signals: sampleSignals,
      measuredAt: 1,
      model: 'jev-latest',
      contractVersion: 'systemone-v1',
      policyVersion: 'policy-v1',
    });
    expect(JSON.stringify(storage.value)).not.toContain('private post text');
    const hydrated = new DecisionCache(storage);
    await hydrated.hydrate();
    expect(hydrated.get('digest')?.signals.matchesGoal.value).toBe(0.8);
  });

  it('enforces the entry and serialized-byte LRU bounds', async () => {
    const storage = new MemoryStorage();
    const cache = new DecisionCache(storage);
    for (let index = 0; index < CACHE_MAX_ENTRIES + 25; index += 1) {
      await cache.set(`entry-${index}`, {
        signals: sampleSignals,
        measuredAt: index,
        model: 'jev-latest',
        contractVersion: 'systemone-v1',
        policyVersion: 'policy-v1',
      });
    }
    expect(cache.size()).toBe(CACHE_MAX_ENTRIES);
    const serialized = JSON.stringify(storage.value.needleLensDecisionCache);
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(CACHE_MAX_BYTES);
    expect(cache.get('entry-0')).toBeUndefined();
    expect(cache.get(`entry-${CACHE_MAX_ENTRIES + 24}`)).toBeDefined();
  });
});
