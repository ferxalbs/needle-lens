import type { Mode, VisibleCandidate } from '../domain/types';
import { CONTRACT_VERSION, MODEL } from '../domain/types';

export type QuestionField = keyof import('../domain/types').JevSignals;

export type WireQuestion =
  | {
      type: 'score';
      instructions: string;
      criteria: readonly string[];
    }
  | {
      type: 'noul';
      instructions: string;
      criteria?: { true: string; false: string };
    };

export type JevRequestBody = {
  model: string;
  state: {
    goal: string;
    mode: Mode;
    posts: Array<{ id: string; text: string }>;
  };
  questions: Record<string, WireQuestion>;
};

export const QUESTION_FIELDS: readonly QuestionField[] = [
  'matchesGoal',
  'urgency',
  'novelty',
  'needIsReal',
  'userCanHelp',
  'hasConcreteAction',
  'containsEvidence',
  'isPromotional',
];

const SCORE_CRITERIA = [
  '0: no signal',
  '1: weak signal',
  '2: clear signal',
  '3: strong signal',
] as const;

const NOUL_CRITERIA = {
  true: 'The statement is supported by the post.',
  false: 'The statement is not supported by the post.',
} as const;

function questionId(candidateId: string, field: QuestionField): string {
  return `${candidateId}__${field}`;
}

function instructionFor(field: QuestionField, candidateId: string): string {
  const subject = `the post with id "${candidateId}" in \`posts\``;
  switch (field) {
    case 'matchesGoal':
      return `Score how directly ${subject} matches the user's goal in \`goal\`. Use the rubric literally.`;
    case 'urgency':
      return `Score how time-sensitive the need in ${subject} is. Do not infer urgency from engagement metrics.`;
    case 'novelty':
      return `Score how new or non-obvious the useful signal in ${subject} appears for the user's goal.`;
    case 'needIsReal':
      return `Does ${subject} describe a concrete, credible need rather than a hypothetical topic?`;
    case 'userCanHelp':
      return `Does ${subject} contain a problem or request that a person could realistically help with?`;
    case 'hasConcreteAction':
      return `Does ${subject} make a concrete next action possible without automated engagement?`;
    case 'containsEvidence':
      return `Does ${subject} include specific evidence, detail, or an observable example?`;
    case 'isPromotional':
      return `Is ${subject} primarily promotional, an advertisement, or a sales pitch?`;
  }
}

export function buildJevRequest(
  candidates: readonly VisibleCandidate[],
  goal: string,
  mode: Mode,
  model: string = MODEL,
): JevRequestBody {
  const ids = new Set<string>();
  const posts = candidates.map((candidate) => {
    if (ids.has(candidate.id)) throw new Error(`Duplicate candidate id: ${candidate.id}`);
    ids.add(candidate.id);
    return { id: candidate.id, text: candidate.text };
  });

  const questions: Record<string, WireQuestion> = {};
  for (const candidate of candidates) {
    for (const field of QUESTION_FIELDS) {
      const id = questionId(candidate.id, field);
      if (field === 'matchesGoal' || field === 'urgency' || field === 'novelty') {
        questions[id] = {
          type: 'score',
          instructions: instructionFor(field, candidate.id),
          criteria: SCORE_CRITERIA,
        };
      } else {
        questions[id] = {
          type: 'noul',
          instructions: instructionFor(field, candidate.id),
          criteria: NOUL_CRITERIA,
        };
      }
    }
  }

  return {
    model,
    state: { goal: goal.trim(), mode, posts },
    questions,
  };
}

export function expectedQuestionId(candidateId: string, field: QuestionField): string {
  return questionId(candidateId, field);
}

export { CONTRACT_VERSION };
