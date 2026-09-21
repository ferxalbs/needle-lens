import { choice, noul, score, type Question } from '@typesafe-ai/sdk';
import type { LensConfig } from '../domain/lens';
import { CONTRACT_VERSION, MODEL, type DecisionLabel, type JevSignals, type Relationship, type VisibleCandidate } from '../domain/types';

export type QuestionField = keyof JevSignals;

export const QUESTION_FIELDS: readonly QuestionField[] = [
  'decision',
  'relationship',
  'matchesGoal',
  'evidenceStrength',
  'actionability',
  'targetMatch',
  'hasConcreteNeed',
  'matchesExclusion',
];

export const SCORE_CRITERIA = [
  'No meaningful match',
  'Weak or speculative match',
  'Partial match with limited evidence',
  'Strong match supported by explicit evidence',
  'Direct and highly actionable match',
] as const;

const DECISION_CRITERIA: Record<DecisionLabel, string> = {
  act: 'The post clears the selected policy for a concrete, user-led next action.',
  inspect: 'The post is relevant enough for a closer human review, but not enough to recommend action.',
  pass: 'The post does not clear the selected policy or matches an exclusion.',
  uncertain: 'The typed evidence is too ambiguous to support either action or inspection.',
};

const RELATIONSHIP_CRITERIA: Record<Relationship, string> = {
  person: 'A person or team is identifiable as the relevant target.',
  problem: 'The post describes a concrete problem, need, or request.',
  signal: 'The post contains a useful trend or signal without a direct request.',
  promotion: 'The post is primarily an advertisement, promotion, or sales pitch.',
  noise: 'The post does not materially relate to the Lens.',
};

const NOUL_CRITERIA = {
  true: 'The statement is directly supported by the visible post text and the Lens criteria.',
  false: 'The visible post text does not support the statement; do not infer missing facts.',
} as const;

export type JevState = {
  lens: Pick<LensConfig, 'goal' | 'target' | 'evidence' | 'exclusions' | 'desiredActions' | 'mode' | 'strictness'>;
  posts: Array<{ id: string; text: string }>;
};

export type JevRequestBody = {
  model: string;
  state: JevState;
  questions: Record<string, Question>;
};

function questionId(candidateId: string, field: QuestionField): string {
  return `${candidateId}__${field}`;
}

function targetDescription(lens: LensConfig): string {
  return lens.target.join('; ');
}

function evidenceDescription(lens: LensConfig): string {
  return lens.evidence.join('; ');
}

function exclusionDescription(lens: LensConfig): string {
  return lens.exclusions.length > 0 ? lens.exclusions.join('; ') : 'No explicit exclusions.';
}

function instructionsFor(field: QuestionField, candidateId: string, lens: LensConfig): string {
  const subject = `the post with id "${candidateId}" in \`posts\``;
  switch (field) {
    case 'decision':
      return `Choose the single typed policy label for ${subject}. Use only the four options; do not generate an explanation.`;
    case 'relationship':
      return `Choose the single relationship type for ${subject}. Use only the five options; do not infer facts absent from the post.`;
    case 'matchesGoal':
      return `Score how directly ${subject} matches the Lens goal: "${lens.goal}". Use the ordered levels literally.`;
    case 'evidenceStrength':
      return `Score how well ${subject} supports a useful decision using these evidence criteria: ${evidenceDescription(lens)}. Use the ordered levels literally.`;
    case 'actionability':
      return `Score how actionable a user-led next step would be for ${subject}, considering these desired actions: ${lens.desiredActions.join('; ')}. Do not perform or suggest automated engagement.`;
    case 'targetMatch':
      return `Does ${subject} match at least one Lens target? Targets: ${targetDescription(lens)}.`;
    case 'hasConcreteNeed':
      return `Does ${subject} contain a concrete need, problem, or request rather than a hypothetical or generic statement?`;
    case 'matchesExclusion':
      return `Does ${subject} match any Lens exclusion? Exclusions: ${exclusionDescription(lens)}.`;
  }
}

function questionFor(field: QuestionField, candidateId: string, lens: LensConfig): Question {
  const instructions = instructionsFor(field, candidateId, lens);
  if (field === 'decision') return choice(instructions, DECISION_CRITERIA);
  if (field === 'relationship') return choice(instructions, RELATIONSHIP_CRITERIA);
  if (field === 'matchesGoal' || field === 'evidenceStrength' || field === 'actionability') {
    return score(instructions, SCORE_CRITERIA);
  }
  return noul(instructions, NOUL_CRITERIA);
}

export function buildJevRequest(
  candidates: readonly VisibleCandidate[],
  lens: LensConfig,
  model: string = MODEL,
): JevRequestBody {
  const ids = new Set<string>();
  const posts = candidates.map((candidate) => {
    if (ids.has(candidate.id)) throw new Error(`Duplicate candidate id: ${candidate.id}`);
    ids.add(candidate.id);
    return { id: candidate.id, text: candidate.text };
  });
  const questions: Record<string, Question> = {};
  for (const candidate of candidates) {
    for (const field of QUESTION_FIELDS) questions[questionId(candidate.id, field)] = questionFor(field, candidate.id, lens);
  }
  return {
    model,
    state: {
      lens: {
        goal: lens.goal,
        target: [...lens.target],
        evidence: [...lens.evidence],
        exclusions: [...lens.exclusions],
        desiredActions: [...lens.desiredActions],
        mode: lens.mode,
        strictness: lens.strictness,
      },
      posts,
    },
    questions,
  };
}

export function expectedQuestionId(candidateId: string, field: QuestionField): string {
  return questionId(candidateId, field);
}

export { CONTRACT_VERSION };
