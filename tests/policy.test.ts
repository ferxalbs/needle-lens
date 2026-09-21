import { describe, expect, it } from 'vitest';
import {
  classifySignals,
  decide,
  normalizeNoul,
  normalizeScore,
  rankDecisions,
  selectVisibleDecisions,
} from '../src/domain/policy';
import type { JevSignals, VisibleCandidate } from '../src/domain/types';

function signals(overrides: Partial<JevSignals> = {}): JevSignals {
  return {
    matchesGoal: { value: 0.8, confidence: 0.9 },
    urgency: { value: 0.7, confidence: 0.9 },
    novelty: { value: 0.7, confidence: 0.9 },
    needIsReal: { value: 0.8 },
    userCanHelp: { value: 0.8 },
    hasConcreteAction: { value: 0.8 },
    containsEvidence: { value: 0.8 },
    isPromotional: { value: 0.1 },
    ...overrides,
  };
}

function candidate(index: number): VisibleCandidate {
  return {
    id: `status_${index}`,
    source: 'x-visible-dom',
    text: `post ${index}`,
    viewportState: 'visible',
    viewportIndex: index,
  };
}

describe('policy', () => {
  it('keeps low-confidence answers uncertain even when the score is high', () => {
    expect(classifySignals(signals({ matchesGoal: { value: 1, confidence: 0.54 } }))).toBe('uncertain');
  });

  it('requires a concrete action and credible evidence for act', () => {
    expect(classifySignals(signals())).toBe('act');
    expect(classifySignals(signals({ hasConcreteAction: { value: 0.64 } }))).toBe('inspect');
    expect(classifySignals(signals({ isPromotional: { value: 0.85 }, matchesGoal: { value: 0.69, confidence: 0.9 } }))).toBe('pass');
  });

  it('keeps the policy boundaries inclusive where specified', () => {
    expect(classifySignals(signals({ matchesGoal: { value: 0.55, confidence: 0.55 }, hasConcreteAction: { value: 0.65 }, needIsReal: { value: 0.65 } }))).toBe('inspect');
    expect(classifySignals(signals({ matchesGoal: { value: 0.75, confidence: 0.55 }, hasConcreteAction: { value: 0.65 }, needIsReal: { value: 0.65 }, isPromotional: { value: 0.69 } }))).toBe('act');
    expect(classifySignals(signals({ matchesGoal: { value: 0.7, confidence: 0.9 }, isPromotional: { value: 0.8 } }))).toBe('inspect');
  });

  it('normalizes provider ranges and rejects invalid values', () => {
    expect(normalizeScore(3, 3, 1)).toBe(1);
    expect(normalizeScore(1.5, 3, 0.5)).toBe(0.5);
    expect(normalizeNoul(0)).toBe(0);
    expect(normalizeNoul(1)).toBe(1);
    expect(() => normalizeScore(4, 3, 1)).toThrow();
    expect(() => normalizeNoul(-0.1)).toThrow();
  });

  it('ranks by policy label and returns no more than three visible decisions', () => {
    const candidates = Array.from({ length: 5 }, (_, index) => candidate(index));
    const decisions = candidates.map((item, index) => decide(item, signals({ matchesGoal: { value: 0.8 - index / 20, confidence: 0.9 } }), 'find_people'));
    const selected = selectVisibleDecisions(decisions, candidates);
    expect(selected).toHaveLength(3);
    expect(selected.every((decision) => decision.label === 'act' || decision.label === 'inspect')).toBe(true);
    expect(selected.map((decision) => decision.candidateId)).toEqual(['status_0', 'status_1', 'status_2']);
  });

  it('uses urgency and then viewport order to break ranking ties', () => {
    const candidates = [candidate(2), candidate(0), candidate(1)];
    const tied = candidates.map((item) => decide(item, signals({ matchesGoal: { value: 0.8, confidence: 0.9 }, urgency: { value: 0.7, confidence: 0.9 } }), 'find_people'));
    expect(rankDecisions(tied, candidates).map((decision) => decision.candidateId)).toEqual(['status_0', 'status_1', 'status_2']);
  });
});
