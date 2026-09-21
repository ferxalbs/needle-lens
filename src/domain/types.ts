import type { LensConfig, LensMode, LensStrictness } from './lens';

export const MIN_ITEMS = 1 as const;
export const MAX_ITEMS = 30 as const;
export const PROVIDER = 'TypeSafe AI' as const;
export const PROVIDER_ORIGIN = 'https://api.typesafe.ai' as const;
export const PROVIDER_ENDPOINT = `${PROVIDER_ORIGIN}/v1/systemone` as const;
export const MODEL = 'jev-latest' as const;
export const CONTRACT_VERSION = 'systemone-jev-lens-v2' as const;
export const POLICY_VERSION = 'policy-v2' as const;
export const MAX_CANDIDATE_TEXT = 20_000 as const;

export type Mode = LensMode;
export type Strictness = LensStrictness;
export type DecisionLabel = 'act' | 'inspect' | 'pass' | 'uncertain';
export type Relationship = 'person' | 'problem' | 'signal' | 'promotion' | 'noise';
export type ReceiptPhase = 'awaiting_outcome' | 'complete';
export type Outcome = 'contacted' | 'investigated' | 'saved_for_later' | 'discarded' | 'no_action';
export type ProbabilityMap = Readonly<Record<string, number>>;
export type ChoiceSignal<T extends string = string> = { choice: T; probabilities: ProbabilityMap; confidence: number };
export type ScoreSignal = { score: number; value: number; probabilities: ProbabilityMap; confidence: number };
export type NoulSignal = { value: number };

export type VisibleCandidate = {
  id: string;
  source: 'x-visible-dom';
  author?: string;
  text: string;
  canonicalUrl?: string;
  viewportState: 'visible' | 'near-viewport';
  viewportIndex: number;
};

export type JevSignals = {
  decision: ChoiceSignal<DecisionLabel>;
  relationship: ChoiceSignal<Relationship>;
  matchesGoal: ScoreSignal;
  evidenceStrength: ScoreSignal;
  actionability: ScoreSignal;
  targetMatch: NoulSignal;
  hasConcreteNeed: NoulSignal;
  matchesExclusion: NoulSignal;
};

export type Decision = {
  candidateId: string;
  label: DecisionLabel;
  actionScore: number;
  probability: number;
  confidence: number;
  boundary: string;
  reason: string;
  signals: JevSignals;
};

export type ProviderUsage = { inputTokens?: number; outputTokens?: number };
export type ProviderEvaluation = { signalsByCandidateId: ReadonlyMap<string, JevSignals>; model: string; usage?: ProviderUsage; latencyMs: number };

export type AnalysisStats = {
  reviewed: number;
  cacheHits: number;
  providerEvaluated: number;
  act: number;
  inspect: number;
  passed: number;
  uncertain: number;
  shown: number;
  worthActingOn: number;
};

export type CostStatus = 'reported' | 'estimated' | 'unavailable';
export type SessionReceipt = {
  version: 1;
  phase: ReceiptPhase;
  lensId: string;
  lensName: string;
  strictness: LensStrictness;
  goal: string;
  mode: LensMode;
  provider: typeof PROVIDER;
  model: string;
  stats: AnalysisStats;
  providerLatencyMs: number;
  totalLatencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  costStatus: CostStatus;
  costUsd?: number;
  outcome?: Outcome;
  completedAt?: string;
};

export type CacheEntry = { signals: JevSignals; measuredAt: number; model: string; contractVersion: string; policyVersion: string };

export const MODE_LABELS: Record<LensMode, string> = { find_people: 'Find people', find_problems: 'Find problems', find_signal: 'Find signal' };
export const OUTCOME_LABELS: Record<Outcome, string> = { contacted: 'Contacted someone', investigated: 'Investigated a problem', saved_for_later: 'Saved for later', discarded: 'Discarded the leads', no_action: 'No action' };

export type { LensConfig, LensMode, LensStrictness };
