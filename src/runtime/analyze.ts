import { DecisionCache, buildCacheKey } from '../cache/decision-cache';
import { decide, selectVisibleDecisions } from '../domain/policy';
import { lensForDecision, type LensConfig } from '../domain/lens';
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
  lens: LensConfig;
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

function legacyLens(goal: string, mode: Mode): LensConfig {
  const now = new Date(0).toISOString();
  return {
    id: 'legacy-analysis-call',
    version: 1,
    name: 'Legacy analysis call',
    goal: normalizeGoal(goal),
    target: ['A relevant person, problem, or signal'],
    evidence: ['Specific evidence in the post'],
    exclusions: [],
    desiredActions: ['Inspect the original post'],
    mode,
    strictness: 'balanced',
    maxActions: 3,
    maxItems: 30,
    createdAt: now,
    updatedAt: now,
  };
}

function requireLens(input: { lens?: LensConfig; goal?: string; mode?: Mode }): LensConfig {
  if (input.lens) return input.lens;
  if (input.goal && input.mode) return legacyLens(input.goal, input.mode);
  throw new JevAdapterError('contract', 'A saved Lens is required before analysis.');
}

export async function getCacheState(
  cache: DecisionCache,
  candidates: readonly VisibleCandidate[],
  lensOrGoal: LensConfig | string,
  mode?: Mode,
): Promise<{ keys: Map<string, string>; hits: Map<string, CacheEntry>; misses: VisibleCandidate[] }> {
  await cache.hydrate();
  const lens = typeof lensOrGoal === 'string' ? legacyLens(lensOrGoal, mode ?? 'find_signal') : lensOrGoal;
  const keys = new Map<string, string>();
  const hits = new Map<string, CacheEntry>();
  const misses: VisibleCandidate[] = [];
  const missKeys = new Set<string>();
  const keyedCandidates = await Promise.all(candidates.map(async (candidate) => ({
    candidate,
    key: await buildCacheKey({
      lens,
      normalizedPostText: candidate.text,
    }),
  })));
  for (const { candidate, key } of keyedCandidates) {
    keys.set(candidate.id, key);
    const hit = cache.get(key);
    if (
      hit &&
      hit.model === MODEL &&
      hit.contractVersion === CONTRACT_VERSION &&
      hit.policyVersion === POLICY_VERSION
    ) {
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
  lens?: LensConfig;
  /** Legacy fields are accepted only for source compatibility; product callers must pass lens. */
  goal?: string;
  mode?: Mode;
  cache: DecisionCache;
  evaluate?: SessionEvaluator;
  now?: () => number;
  performanceNow?: () => number;
}): Promise<AnalysisRun> {
  if (input.candidates.length < 1 || input.candidates.length > 30) {
    throw new JevAdapterError('contract', 'Analysis requires 1–30 eligible candidates.');
  }
  const lens = requireLens(input);
  const clock = input.now ?? Date.now;
  const measure = input.performanceNow ?? (() => performance.now());
  const started = measure();
  const { keys, hits, misses } = await getCacheState(input.cache, input.candidates, lens);
  const evaluate = input.evaluate ?? ((evaluationInput) => evaluateWithJev(evaluationInput));
  let providerEvaluation: ProviderEvaluation | undefined;

  if (misses.length > 0) {
    providerEvaluation = await evaluate({
      apiKey: input.apiKey,
      candidates: misses,
      lens,
    });
    for (const candidate of misses) {
      const signals = providerEvaluation.signalsByCandidateId.get(candidate.id);
      const key = keys.get(candidate.id);
      if (!signals || !key) throw new JevAdapterError('contract', 'Provider omitted a candidate answer.');
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
    if (!entry) throw new JevAdapterError('contract', 'No decision signals were available for a candidate.');
    return decide(candidate, entry.signals, lens);
  });
  const visibleDecisions = selectVisibleDecisions(decisions, input.candidates, lens.maxActions);
  const stats = {
    reviewed: input.candidates.length,
    cacheHits: hits.size,
    providerEvaluated: misses.length,
    act: decisions.filter((decision) => decision.label === 'act').length,
    inspect: decisions.filter((decision) => decision.label === 'inspect').length,
    passed: decisions.filter((decision) => decision.label === 'pass').length,
    uncertain: decisions.filter((decision) => decision.label === 'uncertain').length,
    shown: visibleDecisions.length,
    worthActingOn: decisions.filter((decision) => decision.label === 'act').length,
  };
  const receipt = createReceipt({
    lens,
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

export function lensSummary(lens: LensConfig): Pick<LensConfig, 'goal' | 'mode' | 'strictness'> {
  return lensForDecision(lens);
}
