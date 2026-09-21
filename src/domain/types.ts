export const MIN_ITEMS = 8 as const;
export const MAX_ITEMS = 30 as const;
export const PROVIDER = 'TypeSafe AI' as const;
export const PROVIDER_ORIGIN = 'https://api.typesafe.ai' as const;
export const PROVIDER_ENDPOINT = `${PROVIDER_ORIGIN}/v1/systemone` as const;
export const MODEL = 'jev-latest' as const;
export const CONTRACT_VERSION = 'systemone-v1' as const;
export const POLICY_VERSION = 'policy-v1' as const;

export type Mode = 'find_people' | 'find_problems' | 'find_signal';

export type DecisionLabel = 'act' | 'inspect' | 'pass' | 'uncertain';

export type ReceiptPhase = 'awaiting_outcome' | 'complete';

export type Outcome =
  | 'contacted'
  | 'investigated'
  | 'saved_for_later'
  | 'discarded'
  | 'no_action';

export type ScoreSignal = {
  value: number;
  confidence: number;
};

export type NoulSignal = {
  value: number;
};

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
  matchesGoal: ScoreSignal;
  urgency: ScoreSignal;
  novelty: ScoreSignal;
  needIsReal: NoulSignal;
  userCanHelp: NoulSignal;
  hasConcreteAction: NoulSignal;
  containsEvidence: NoulSignal;
  isPromotional: NoulSignal;
};

export type Decision = {
  candidateId: string;
  label: DecisionLabel;
  actionScore: number;
  reason: string;
  signals: JevSignals;
};

export type ProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

export type ProviderEvaluation = {
  signalsByCandidateId: ReadonlyMap<string, JevSignals>;
  model: string;
  usage?: ProviderUsage;
  latencyMs: number;
};

export type AnalysisStats = {
  reviewed: number;
  cacheHits: number;
  providerEvaluated: number;
  worthActingOn: number;
  shown: number;
};

export type CostStatus = 'reported' | 'estimated' | 'unavailable';

export type SessionReceipt = {
  version: 1;
  phase: ReceiptPhase;
  goal: string;
  mode: Mode;
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

export type CacheEntry = {
  signals: JevSignals;
  measuredAt: number;
  model: string;
  contractVersion: string;
  policyVersion: string;
};

export const MODE_LABELS: Record<Mode, string> = {
  find_people: 'Find people',
  find_problems: 'Find problems',
  find_signal: 'Find signal',
};

export const OUTCOME_LABELS: Record<Outcome, string> = {
  contacted: 'Contacted someone',
  investigated: 'Investigated a problem',
  saved_for_later: 'Saved for later',
  discarded: 'Discarded the leads',
  no_action: 'No action',
};
