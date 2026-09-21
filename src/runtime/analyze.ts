import { DecisionCache, buildCacheKey } from '../cache/decision-cache';
import { decide, selectVisibleDecisions } from '../domain/policy';
import { createReceipt } from '../domain/receipt';
import {
  CONTRACT_VERSION,
  MODEL,
  POLICY_VERSION,
  type CacheEntry,
  type Decision,
  type Mode,
  type ProviderEvaluation,
  type SessionReceipt,
  type VisibleCandidate,
} from '../domain/types';
import type { ResultCard } from '../messaging/protocol';
import { evaluateWithJev, JevAdapterError } from '../provider/jev-adapter';

export type SessionEvaluator = (input: {
  apiKey: string;
  candidates: readonly VisibleCandidate[];
  goal: string;
  mode: Mode;
}) => Promise<ProviderEvaluation>;

export type AnalysisRun = {
  cards: ResultCard[];
  decisions: Decision[];
  receipt: SessionReceipt;
  noUsefulAction: boolean;
};

function normalizeGoal(goal: string): string {
  return goal.replace(/\s+/g, ' ').trim().slice(0, 500);
}

export async function getCacheState(
  cache: DecisionCache,
  candidates: readonly VisibleCandidate[],
  goal: string,
  mode: Mode,
): Promise<{ keys: Map<string, string>; hits: Map<string, CacheEntry>; misses: VisibleCandidate[] }> {
  await cache.hydrate();
  const keys = new Map<string, string>();
  const hits = new Map<string, CacheEntry>();
  const misses: VisibleCandidate[] = [];
  const missKeys = new Set<string>();
  for (const candidate of candidates) {
    const key = await buildCacheKey({
      mode,
      normalizedGoal: normalizeGoal(goal),
      normalizedPostText: candidate.text,
    });
    keys.set(candidate.id, key);
    const hit = cache.get(key);
    if (hit && hit.model === MODEL && hit.contractVersion === CONTRACT_VERSION && hit.policyVersion === POLICY_VERSION) {
      hits.set(candidate.id, hit);
    } else if (!missKeys.has(key)) {
      misses.push(candidate);
      missKeys.add(key);
    }
  }
  return { keys, hits, misses };
}

export async function analyzeCandidates(input: {
  apiKey: string;
  candidates: readonly VisibleCandidate[];
  goal: string;
  mode: Mode;
  cache: DecisionCache;
  evaluate?: SessionEvaluator;
  now?: () => number;
  performanceNow?: () => number;
}): Promise<AnalysisRun> {
  const clock = input.now ?? Date.now;
  const measure = input.performanceNow ?? (() => performance.now());
  const started = measure();
  const { keys, hits, misses } = await getCacheState(input.cache, input.candidates, input.goal, input.mode);
  const evaluate = input.evaluate ?? evaluateWithJev;
  let providerEvaluation: ProviderEvaluation | undefined;

  if (misses.length > 0) {
    providerEvaluation = await evaluate({
      apiKey: input.apiKey,
      candidates: misses,
      goal: normalizeGoal(input.goal),
      mode: input.mode,
    });
    for (const candidate of misses) {
      const signals = providerEvaluation.signalsByCandidateId.get(candidate.id);
      const key = keys.get(candidate.id);
      if (!signals || !key) throw new JevAdapterError('contract', `Provider omitted ${candidate.id}.`);
      await input.cache.set(key, {
        signals,
        measuredAt: clock(),
        model: providerEvaluation.model,
        contractVersion: CONTRACT_VERSION,
        policyVersion: POLICY_VERSION,
      });
    }
  }

  const decisions = input.candidates.map((candidate) => {
    const key = keys.get(candidate.id);
    const entry = hits.get(candidate.id) ?? (key ? input.cache.get(key) : undefined);
    if (!entry) throw new JevAdapterError('contract', `No decision signals were available for ${candidate.id}.`);
    return decide(candidate, entry.signals, input.mode);
  });
  const visibleDecisions = selectVisibleDecisions(decisions, input.candidates);
  const stats = {
    reviewed: input.candidates.length,
    cacheHits: hits.size,
    providerEvaluated: misses.length,
    worthActingOn: decisions.filter((decision) => decision.label === 'act').length,
    shown: visibleDecisions.length,
  };
  const receipt = createReceipt({
    goal: normalizeGoal(input.goal),
    mode: input.mode,
    stats,
    providerEvaluation,
    totalLatencyMs: Math.round(measure() - started),
  });
  const byId = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const cards: ResultCard[] = visibleDecisions.flatMap((decision) => {
    const candidate = byId.get(decision.candidateId);
    return candidate ? [{ candidate, decision }] : [];
  });
  return {
    cards,
    decisions,
    receipt,
    noUsefulAction: cards.length === 0,
  };
}
