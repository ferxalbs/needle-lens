import type { LensConfig, LensStrictness } from './lens';
import type {
  Decision,
  DecisionLabel,
  JevSignals,
  Mode,
  ProbabilityMap,
  Relationship,
  VisibleCandidate,
} from './types';

export type StrictnessProfile = {
  actGoal: number;
  actEvidence: number;
  actActionability: number;
  actTarget: number;
  actProbability: number;
  inspectGoal: number;
  inspectEvidence: number;
  inspectTarget: number;
  inspectProbability: number;
  exclusion: number;
  uncertainty: number;
};

export const STRICTNESS_PROFILES: Record<LensStrictness, StrictnessProfile> = {
  exploratory: {
    actGoal: 0.65,
    actEvidence: 0.55,
    actActionability: 0.55,
    actTarget: 0.45,
    actProbability: 0.55,
    inspectGoal: 0.45,
    inspectEvidence: 0.4,
    inspectTarget: 0.35,
    inspectProbability: 0.4,
    exclusion: 0.8,
    uncertainty: 0.5,
  },
  balanced: {
    actGoal: 0.75,
    actEvidence: 0.65,
    actActionability: 0.65,
    actTarget: 0.65,
    actProbability: 0.65,
    inspectGoal: 0.55,
    inspectEvidence: 0.5,
    inspectTarget: 0.45,
    inspectProbability: 0.5,
    exclusion: 0.7,
    uncertainty: 0.6,
  },
  strict: {
    actGoal: 0.85,
    actEvidence: 0.75,
    actActionability: 0.75,
    actTarget: 0.8,
    actProbability: 0.75,
    inspectGoal: 0.65,
    inspectEvidence: 0.6,
    inspectTarget: 0.6,
    inspectProbability: 0.6,
    exclusion: 0.65,
    uncertainty: 0.75,
  },
};

function profileFor(strictness: LensStrictness): StrictnessProfile {
  return STRICTNESS_PROFILES[strictness];
}

function finiteUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function signalConfidence(signals: JevSignals): number {
  return Math.min(
    finiteUnit(signals.decision.confidence),
    finiteUnit(signals.relationship.confidence),
    finiteUnit(signals.matchesGoal.confidence),
    finiteUnit(signals.evidenceStrength.confidence),
    finiteUnit(signals.actionability.confidence),
  );
}

function signalProbability(signals: JevSignals, label: DecisionLabel): number {
  return finiteUnit(signals.decision.probabilities[label] ?? 0);
}

function relationshipIsPositive(relationship: Relationship): boolean {
  return relationship === 'person' || relationship === 'problem' || relationship === 'signal';
}

function compatibilityLens(modeOrLens: Mode | LensConfig): LensConfig {
  if (typeof modeOrLens !== 'string') return modeOrLens;
  const now = new Date(0).toISOString();
  return {
    id: 'legacy-policy-call',
    version: 1,
    name: 'Legacy policy call',
    goal: 'Evaluate the visible post against the selected decision mode.',
    target: ['A relevant person, problem, or signal'],
    evidence: ['Specific evidence in the post'],
    exclusions: [],
    desiredActions: ['Inspect the original post'],
    mode: modeOrLens,
    strictness: 'balanced',
    maxActions: 3,
    maxItems: 30,
    createdAt: now,
    updatedAt: now,
  };
}

function criterionSummary(lens: LensConfig): string {
  const target = lens.target.slice(0, 2).join('; ');
  const evidence = lens.evidence.slice(0, 2).join('; ');
  return `Target criteria: ${target}. Evidence criteria: ${evidence}.`;
}

function evidenceExcerpt(candidate: VisibleCandidate): string {
  const normalized = candidate.text.replace(/\s+/g, ' ').trim();
  return `Evidence excerpt: “${normalized.slice(0, 160)}${normalized.length > 160 ? '…' : ''}”`;
}

function makeReason(
  label: DecisionLabel,
  candidate: VisibleCandidate,
  signals: JevSignals,
  lens: LensConfig,
  profile: StrictnessProfile,
): string {
  const confidence = Math.round(signalConfidence(signals) * 100);
  const goal = Math.round(signals.matchesGoal.value * 100);
  const evidence = Math.round(signals.evidenceStrength.value * 100);
  const actionability = Math.round(signals.actionability.value * 100);
  const criteria = criterionSummary(lens);
  const excerpt = evidenceExcerpt(candidate);
  if (label === 'uncertain') {
    return `Uncertain: Jev confidence is ${confidence}%, below the ${Math.round(profile.uncertainty * 100)}% policy floor. ${criteria} ${excerpt}`;
  }
  if (label === 'pass' && signals.matchesExclusion.value >= profile.exclusion) {
    return `Passed: the exclusion signal was ${Math.round(signals.matchesExclusion.value * 100)}%, at or above the ${Math.round(profile.exclusion * 100)}% exclusion threshold. ${excerpt}`;
  }
  if (label === 'pass' && !relationshipIsPositive(signals.relationship.choice)) {
    return `Passed: Jev classified the relationship as ${signals.relationship.choice}, which is outside the selected lens. ${excerpt}`;
  }
  if (label === 'pass' && signals.targetMatch.value < profile.inspectTarget) {
    return `Passed: target match was ${Math.round(signals.targetMatch.value * 100)}%, below the ${Math.round(profile.inspectTarget * 100)}% threshold. ${excerpt}`;
  }
  if (label === 'act') {
    return `Strong goal match (${goal}%), explicit evidence (${evidence}%), and actionability (${actionability}%) passed the ${lens.strictness} thresholds. ${criteria} ${excerpt}`;
  }
  if (label === 'inspect') {
    return `Inspect: goal match (${goal}%) and evidence (${evidence}%) cleared the review thresholds, but the act boundary was not crossed. ${criteria} ${excerpt}`;
  }
  return `Passed: the available typed signals did not clear the ${lens.strictness} action or inspection boundary. ${excerpt}`;
}

/**
 * Compose the final label locally. Jev's decision Choice is evidence, not an
 * instruction: no provider answer can force an action past the selected policy.
 */
export function classifySignals(signals: JevSignals, strictness: LensStrictness = 'balanced'): DecisionLabel {
  const profile = profileFor(strictness);
  if (signals.matchesExclusion.value >= profile.exclusion) return 'pass';
  const confidence = signalConfidence(signals);
  if (confidence < profile.uncertainty) return 'uncertain';
  if (!relationshipIsPositive(signals.relationship.choice)) return 'pass';
  if (signals.targetMatch.value < profile.inspectTarget) return 'pass';

  const actProbability = signalProbability(signals, 'act');
  const inspectProbability = signalProbability(signals, 'inspect');
  const actReady =
    signals.matchesGoal.value >= profile.actGoal &&
    signals.evidenceStrength.value >= profile.actEvidence &&
    signals.actionability.value >= profile.actActionability &&
    signals.targetMatch.value >= profile.actTarget &&
    actProbability >= profile.actProbability &&
    signals.decision.choice === 'act';
  if (actReady) return 'act';

  const inspectReady =
    signals.matchesGoal.value >= profile.inspectGoal &&
    signals.evidenceStrength.value >= profile.inspectEvidence &&
    signals.targetMatch.value >= profile.inspectTarget &&
    Math.max(inspectProbability, actProbability) >= profile.inspectProbability &&
    (signals.decision.choice === 'inspect' || signals.decision.choice === 'act');
  if (inspectReady) return 'inspect';
  return 'pass';
}

export function decide(
  candidate: VisibleCandidate,
  signals: JevSignals,
  modeOrLens: Mode | LensConfig,
): Decision {
  const lens = compatibilityLens(modeOrLens);
  const profile = profileFor(lens.strictness);
  const label = classifySignals(signals, lens.strictness);
  const probability = signalProbability(signals, label);
  const confidence = signalConfidence(signals);
  const actionScore =
    signals.matchesGoal.value * 0.45 +
    signals.evidenceStrength.value * 0.3 +
    signals.actionability.value * 0.25;
  const boundary = label === 'act'
    ? `act ≥ ${Math.round(profile.actGoal * 100)} / ${Math.round(profile.actEvidence * 100)} / ${Math.round(profile.actActionability * 100)}`
    : label === 'inspect'
      ? `inspect ≥ ${Math.round(profile.inspectGoal * 100)} / ${Math.round(profile.inspectEvidence * 100)}`
      : label === 'uncertain'
        ? `confidence < ${Math.round(profile.uncertainty * 100)}%`
        : `pass below ${lens.strictness} thresholds`;
  return {
    candidateId: candidate.id,
    label,
    actionScore,
    probability,
    confidence,
    boundary,
    reason: makeReason(label, candidate, signals, lens, profile),
    signals,
  };
}

export function rankDecisions(
  decisions: readonly Decision[],
  candidates: readonly VisibleCandidate[],
): Decision[] {
  const viewportOrder = new Map(candidates.map((candidate) => [candidate.id, candidate.viewportIndex]));
  const labelOrder: Record<DecisionLabel, number> = {
    act: 0,
    inspect: 1,
    uncertain: 2,
    pass: 3,
  };
  return [...decisions].sort((left, right) => {
    const labelDelta = labelOrder[left.label] - labelOrder[right.label];
    if (labelDelta !== 0) return labelDelta;
    const probabilityDelta = right.probability - left.probability;
    if (probabilityDelta !== 0) return probabilityDelta;
    const scoreDelta = right.actionScore - left.actionScore;
    if (scoreDelta !== 0) return scoreDelta;
    return (viewportOrder.get(left.candidateId) ?? Number.MAX_SAFE_INTEGER) -
      (viewportOrder.get(right.candidateId) ?? Number.MAX_SAFE_INTEGER);
  });
}

export function selectVisibleDecisions(
  decisions: readonly Decision[],
  candidates: readonly VisibleCandidate[],
  maxActions: 1 | 2 | 3 = 3,
): Decision[] {
  return rankDecisions(decisions, candidates)
    .filter((decision) => decision.label === 'act' || decision.label === 'inspect')
    .slice(0, maxActions);
}

export function normalizeScore(
  score: number,
  maxLevel: number,
  confidence: number,
  probabilities: ProbabilityMap = {},
): import('./types').ScoreSignal {
  if (!Number.isFinite(score) || !Number.isFinite(confidence)) throw new Error('Score and confidence must be finite numbers.');
  if (maxLevel < 1 || !Number.isInteger(maxLevel)) throw new Error('Score criteria must contain at least two levels.');
  if (score < 0 || score > maxLevel || confidence < 0 || confidence > 1) throw new Error('Score or confidence is outside the provider range.');
  return { score, value: score / maxLevel, confidence, probabilities };
}

export function normalizeNoul(value: number): import('./types').NoulSignal {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Noul value is outside the provider range.');
  return { value };
}
