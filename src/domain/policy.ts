import type {
  Decision,
  DecisionLabel,
  JevSignals,
  Mode,
  VisibleCandidate,
} from './types';

const MATCH_CONFIDENCE_GATE = 0.55;

function thresholdReasons(signals: JevSignals, mode: Mode): string[] {
  const reasons: string[] = [];
  if (signals.matchesGoal.value >= 0.75) {
    reasons.push(mode === 'find_people' ? 'strong goal match' : 'strong relevance');
  } else if (signals.matchesGoal.value >= 0.55) {
    reasons.push('some goal alignment');
  }
  if (signals.hasConcreteAction.value >= 0.65) reasons.push('a concrete next step');
  if (signals.needIsReal.value >= 0.65) reasons.push('a credible need');
  if (signals.containsEvidence.value >= 0.65) reasons.push('specific evidence');
  if (signals.urgency.value >= 0.65) reasons.push('time sensitivity');
  if (signals.novelty.value >= 0.65) reasons.push('new signal');
  return reasons.slice(0, 3);
}

function makeReason(label: DecisionLabel, signals: JevSignals, mode: Mode): string {
  if (label === 'uncertain') {
    return 'Goal match confidence is too low to make a safe recommendation.';
  }
  if (label === 'pass' && signals.isPromotional.value >= 0.8) {
    return 'Promotional content without a strong goal match is not a useful action.';
  }
  const reasons = thresholdReasons(signals, mode);
  if (label === 'act') {
    return reasons.length > 0
      ? `Worth acting on: ${reasons.join(', ')}.`
      : 'Worth acting on based on the combined signals.';
  }
  if (label === 'inspect') {
    return reasons.length > 0
      ? `Worth a closer look: ${reasons.join(', ')}.`
      : 'Worth a closer look based on the goal match.';
  }
  return 'The available signals did not clear the action threshold.';
}

export function classifySignals(signals: JevSignals): DecisionLabel {
  if (signals.matchesGoal.confidence < MATCH_CONFIDENCE_GATE) return 'uncertain';

  if (signals.isPromotional.value >= 0.8 && signals.matchesGoal.value < 0.7) {
    return 'pass';
  }

  if (
    signals.matchesGoal.value >= 0.75 &&
    signals.hasConcreteAction.value >= 0.65 &&
    (signals.needIsReal.value >= 0.65 || signals.containsEvidence.value >= 0.65) &&
    signals.isPromotional.value < 0.7
  ) {
    return 'act';
  }

  if (signals.matchesGoal.value >= 0.55) return 'inspect';
  return 'pass';
}

export function decide(
  candidate: VisibleCandidate,
  signals: JevSignals,
  mode: Mode,
): Decision {
  const label = classifySignals(signals);
  return {
    candidateId: candidate.id,
    label,
    actionScore: signals.matchesGoal.value * (0.5 + 0.5 * signals.urgency.value),
    reason: makeReason(label, signals, mode),
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
    pass: 2,
    uncertain: 3,
  };

  return [...decisions].sort((left, right) => {
    const labelDelta = labelOrder[left.label] - labelOrder[right.label];
    if (labelDelta !== 0) return labelDelta;
    const scoreDelta = right.actionScore - left.actionScore;
    if (scoreDelta !== 0) return scoreDelta;
    const urgencyDelta = right.signals.urgency.value - left.signals.urgency.value;
    if (urgencyDelta !== 0) return urgencyDelta;
    return (viewportOrder.get(left.candidateId) ?? Number.MAX_SAFE_INTEGER) -
      (viewportOrder.get(right.candidateId) ?? Number.MAX_SAFE_INTEGER);
  });
}

export function selectVisibleDecisions(
  decisions: readonly Decision[],
  candidates: readonly VisibleCandidate[],
): Decision[] {
  return rankDecisions(decisions, candidates)
    .filter((decision) => decision.label === 'act' || decision.label === 'inspect')
    .slice(0, 3);
}

export function normalizeScore(score: number, maxLevel: number, confidence: number): number {
  if (!Number.isFinite(score) || !Number.isFinite(confidence)) {
    throw new Error('Score and confidence must be finite numbers.');
  }
  if (maxLevel < 1 || !Number.isInteger(maxLevel)) {
    throw new Error('Score criteria must contain at least two levels.');
  }
  if (score < 0 || score > maxLevel || confidence < 0 || confidence > 1) {
    throw new Error('Score or confidence is outside the provider range.');
  }
  return score / maxLevel;
}

export function normalizeNoul(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('Noul value is outside the provider range.');
  }
  return value;
}
