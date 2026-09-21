import { describe, expect, it } from 'vitest';
import { DecisionCache, buildCacheKey } from '../src/cache/decision-cache';
import { analyzeCandidates } from '../src/runtime/analyze';
import type { JevSignals, VisibleCandidate } from '../src/domain/types';
import type { ProviderEvaluation } from '../src/domain/types';

const candidates: VisibleCandidate[] = Array.from({ length: 8 }, (_, index) => ({
  id: `status_orchestration_${index}`,
  source: 'x-visible-dom',
  text: `visible orchestration post ${index}`,
  viewportState: 'visible',
  viewportIndex: index,
}));

const signals: JevSignals = {
  matchesGoal: { value: 0.9, confidence: 0.95 },
  urgency: { value: 0.8, confidence: 0.9 },
  novelty: { value: 0.7, confidence: 0.9 },
  needIsReal: { value: 0.9 },
  userCanHelp: { value: 0.9 },
  hasConcreteAction: { value: 0.9 },
  containsEvidence: { value: 0.8 },
  isPromotional: { value: 0.1 },
};

function evaluator(calls: { count: number; batchSizes: number[] }) {
  return async (input: {
    apiKey: string;
    candidates: readonly VisibleCandidate[];
    goal: string;
    mode: 'find_people' | 'find_problems' | 'find_signal';
  }): Promise<ProviderEvaluation> => {
    calls.count += 1;
    calls.batchSizes.push(input.candidates.length);
    expect(input.apiKey).toBe('ts_test_key_123');
    return {
      signalsByCandidateId: new Map(input.candidates.map((candidate) => [candidate.id, signals])),
      model: 'jev-latest',
      usage: { inputTokens: 10, outputTokens: 20 },
      latencyMs: 7,
    };
  };
}

describe('session orchestration', () => {
  it('makes one provider call for misses and zero calls on a fully cached rerun', async () => {
    const calls = { count: 0, batchSizes: [] as number[] };
    const cache = new DecisionCache();
    const first = await analyzeCandidates({
      apiKey: 'ts_test_key_123',
      candidates,
      goal: 'find leads',
      mode: 'find_people',
      cache,
      evaluate: evaluator(calls),
      now: () => 1_000,
      performanceNow: () => 42,
    });
    expect(calls).toEqual({ count: 1, batchSizes: [8] });
    expect(first.receipt.stats).toMatchObject({ reviewed: 8, cacheHits: 0, providerEvaluated: 8, shown: 3 });
    expect(first.cards).toHaveLength(3);

    const second = await analyzeCandidates({
      apiKey: 'ts_test_key_123',
      candidates,
      goal: 'find leads',
      mode: 'find_people',
      cache,
      evaluate: evaluator(calls),
      now: () => 2_000,
      performanceNow: () => 84,
    });
    expect(calls).toEqual({ count: 1, batchSizes: [8] });
    expect(second.receipt.stats).toMatchObject({ reviewed: 8, cacheHits: 8, providerEvaluated: 0, shown: 3 });
  });

  it('sends only misses in one request for a partial cache', async () => {
    const calls = { count: 0, batchSizes: [] as number[] };
    const cache = new DecisionCache();
    const firstKey = await buildCacheKey({ mode: 'find_people', normalizedGoal: 'find leads', normalizedPostText: candidates[0]!.text });
    await cache.set(firstKey, {
      signals,
      measuredAt: 1,
      model: 'jev-latest',
      contractVersion: 'systemone-v1',
      policyVersion: 'policy-v1',
    });
    const result = await analyzeCandidates({
      apiKey: 'ts_test_key_123',
      candidates,
      goal: 'find leads',
      mode: 'find_people',
      cache,
      evaluate: evaluator(calls),
      now: () => 2_000,
      performanceNow: () => 10,
    });
    expect(calls).toEqual({ count: 1, batchSizes: [7] });
    expect(result.receipt.stats).toMatchObject({ reviewed: 8, cacheHits: 1, providerEvaluated: 7 });
  });

  it('deduplicates identical uncached post text within one provider batch', async () => {
    const duplicateCandidates = candidates.map((candidate, index) => index === 1
      ? { ...candidate, id: 'status_duplicate', text: candidates[0]!.text }
      : candidate);
    const calls = { count: 0, batchSizes: [] as number[] };
    const cache = new DecisionCache();
    const result = await analyzeCandidates({
      apiKey: 'ts_test_key_123',
      candidates: duplicateCandidates,
      goal: 'find leads',
      mode: 'find_people',
      cache,
      evaluate: evaluator(calls),
      now: () => 3_000,
      performanceNow: () => 12,
    });

    expect(calls).toEqual({ count: 1, batchSizes: [7] });
    expect(result.receipt.stats).toMatchObject({ reviewed: 8, cacheHits: 0, providerEvaluated: 7 });
    expect(result.decisions).toHaveLength(8);
  });
});
