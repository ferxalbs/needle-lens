import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  AuthenticationError,
  RateLimitError,
  TypeSafeClient,
  type Fetch,
  type TypeSafeClientConfig,
} from '@typesafe-ai/sdk';
import {
  normalizeNoul,
  normalizeScore,
} from '../domain/policy';
import type {
  ChoiceSignal,
  JevSignals,
  LensConfig,
  ProviderEvaluation,
  Relationship,
  DecisionLabel,
  ScoreSignal,
  VisibleCandidate,
} from '../domain/types';
import { MODEL, type Mode } from '../domain/types';
import {
  buildJevRequest,
  expectedQuestionId,
  QUESTION_FIELDS,
  type QuestionField,
} from './contract';
import {
  isRecord,
  parseRawJevResponse,
  readFiniteNumber,
  readProbabilityMap,
  readUnitNumber,
} from './schemas';

export type JevFailureKind =
  | 'authentication'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'contract'
  | 'provider';

export class JevAdapterError extends Error {
  readonly kind: JevFailureKind;
  readonly status?: number;

  constructor(kind: JevFailureKind, message: string, status?: number) {
    super(message);
    this.name = 'JevAdapterError';
    this.kind = kind;
    if (status !== undefined) this.status = status;
  }
}

export type FetchLike = Fetch;

function expectedFieldType(field: QuestionField): 'choice' | 'score' | 'noul' {
  if (field === 'decision' || field === 'relationship') return 'choice';
  if (field === 'matchesGoal' || field === 'evidenceStrength' || field === 'actionability') return 'score';
  return 'noul';
}

function choiceValue(field: QuestionField, value: unknown): string[] {
  if (field === 'decision') return ['act', 'inspect', 'pass', 'uncertain'];
  if (field === 'relationship') return ['person', 'problem', 'signal', 'promotion', 'noise'];
  return [String(value)];
}

function requireProbabilityKeys(probabilities: Readonly<Record<string, number>>, expected: readonly string[]): void {
  const actual = Object.keys(probabilities).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new JevAdapterError('contract', 'Provider probability keys did not match the typed question.');
  }
}

function parseChoice<T extends string>(answer: Record<string, unknown>, field: QuestionField): ChoiceSignal<T> {
  if (answer.type !== 'choice' || typeof answer.choice !== 'string') throw new JevAdapterError('contract', `Provider answer type mismatch for ${field}.`);
  const allowed = choiceValue(field, answer.choice);
  if (!allowed.includes(answer.choice)) throw new JevAdapterError('contract', `Provider returned an invalid choice for ${field}.`);
  let probabilities: Readonly<Record<string, number>>;
  try {
    probabilities = readProbabilityMap(answer.probabilities);
  } catch (error) {
    throw new JevAdapterError('contract', error instanceof Error ? error.message : 'Provider probabilities were invalid.');
  }
  try {
    requireProbabilityKeys(probabilities, choiceValue(field, answer.choice));
    return {
      choice: answer.choice as T,
      probabilities,
      confidence: readUnitNumber(answer, 'confidence'),
    };
  } catch (error) {
    throw new JevAdapterError('contract', error instanceof Error ? error.message : 'Provider confidence was invalid.');
  }
}

function parseScore(answer: Record<string, unknown>, field: QuestionField): ScoreSignal {
  if (answer.type !== 'score') throw new JevAdapterError('contract', `Provider answer type mismatch for ${field}.`);
  try {
    const probabilities = readProbabilityMap(answer.probabilities);
    requireProbabilityKeys(probabilities, ['0', '1', '2', '3', '4']);
    return normalizeScore(
      readFiniteNumber(answer, 'score'),
      4,
      readUnitNumber(answer, 'confidence'),
      probabilities,
    );
  } catch (error) {
    throw new JevAdapterError('contract', error instanceof Error ? error.message : `Provider returned an invalid ${field} score.`);
  }
}

function parseNoul(answer: Record<string, unknown>, field: QuestionField) {
  if (answer.type !== 'noul') throw new JevAdapterError('contract', `Provider answer type mismatch for ${field}.`);
  try {
    return normalizeNoul(readUnitNumber(answer, 'noul'));
  } catch (error) {
    throw new JevAdapterError('contract', error instanceof Error ? error.message : `Provider returned an invalid ${field} value.`);
  }
}

function parseSignal(answer: unknown, field: QuestionField): JevSignals[QuestionField] {
  if (!isRecord(answer) || answer.type !== expectedFieldType(field)) {
    throw new JevAdapterError('contract', `Provider answer type mismatch for ${field}.`);
  }
  if (field === 'decision') return parseChoice<DecisionLabel>(answer, field) as JevSignals[QuestionField];
  if (field === 'relationship') return parseChoice<Relationship>(answer, field) as JevSignals[QuestionField];
  if (field === 'matchesGoal' || field === 'evidenceStrength' || field === 'actionability') return parseScore(answer, field);
  return parseNoul(answer, field);
}

export function normalizeAnswers(
  raw: unknown,
  candidates: readonly VisibleCandidate[],
): { signalsByCandidateId: ReadonlyMap<string, JevSignals>; model: string; usage?: NonNullable<ProviderEvaluation['usage']> } {
  let response;
  try {
    response = parseRawJevResponse(raw);
  } catch (error) {
    throw new JevAdapterError('contract', error instanceof Error ? error.message : 'The provider response was malformed.');
  }
  const expected = new Map<string, { candidateId: string; field: QuestionField }>();
  for (const candidate of candidates) {
    for (const field of QUESTION_FIELDS) expected.set(expectedQuestionId(candidate.id, field), { candidateId: candidate.id, field });
  }
  for (const key of Object.keys(response.answers)) {
    if (!expected.has(key)) throw new JevAdapterError('contract', 'Provider returned an unknown answer id.');
  }
  const byCandidate = new Map<string, Partial<JevSignals>>();
  for (const [key, expectedAnswer] of expected) {
    const answer = response.answers[key];
    if (answer === undefined) throw new JevAdapterError('contract', 'Provider omitted a required answer.');
    const signals = byCandidate.get(expectedAnswer.candidateId) ?? {};
    signals[expectedAnswer.field] = parseSignal(answer, expectedAnswer.field) as never;
    byCandidate.set(expectedAnswer.candidateId, signals);
  }
  const signalsByCandidateId = new Map<string, JevSignals>();
  for (const candidate of candidates) {
    const signals = byCandidate.get(candidate.id);
    if (!signals || Object.keys(signals).length !== QUESTION_FIELDS.length) throw new JevAdapterError('contract', 'Provider returned incomplete answers.');
    signalsByCandidateId.set(candidate.id, signals as JevSignals);
  }
  const usage = response.usage
    ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
    : undefined;
  return usage ? { signalsByCandidateId, model: response.model, usage } : { signalsByCandidateId, model: response.model };
}

function baseUrlFor(endpoint?: string): string | undefined {
  if (!endpoint) return undefined;
  try {
    return new URL(endpoint).origin;
  } catch {
    throw new JevAdapterError('contract', 'The provider endpoint was invalid.');
  }
}

function mapSdkError(error: unknown): JevAdapterError {
  if (error instanceof AuthenticationError) return new JevAdapterError('authentication', 'The provider rejected the API key.', error.status);
  if (error instanceof RateLimitError) return new JevAdapterError('rate_limit', 'The provider rate limit was reached.', error.status);
  if (error instanceof APITimeoutError) return new JevAdapterError('timeout', 'The provider request timed out.');
  if (error instanceof APIConnectionError) return new JevAdapterError('network', 'The provider could not be reached.');
  if (error instanceof APIError) return new JevAdapterError('provider', 'The provider could not complete the request.', error.status);
  return new JevAdapterError('provider', 'The provider request failed.');
}

export async function evaluateWithJev(input: {
  apiKey: string;
  candidates: readonly VisibleCandidate[];
  lens: LensConfig;
  mode?: Mode;
  fetchImpl?: FetchLike;
  endpoint?: string;
  timeoutMs?: number;
}): Promise<ProviderEvaluation> {
  if (!input.apiKey || input.apiKey.length < 8) throw new JevAdapterError('authentication', 'The provider API key was missing.');
  const request = buildJevRequest(input.candidates, input.lens, MODEL);
  const started = performance.now();
  try {
    const baseUrl = baseUrlFor(input.endpoint);
    const clientConfig: TypeSafeClientConfig = {
      apiKey: input.apiKey,
      defaultModel: MODEL,
      logLevel: 'off',
      retry: { maxRetries: 0 },
    };
    if (baseUrl) clientConfig.baseURL = baseUrl;
    if (input.fetchImpl) clientConfig.fetch = input.fetchImpl;
    const client = new TypeSafeClient(clientConfig);
    const response = await client.systemOne({
      model: request.model,
      state: request.state,
      questions: request.questions,
    }, {
      timeout: input.timeoutMs ?? 30_000,
      retry: { maxRetries: 0 },
    });
    const normalized = normalizeAnswers(response, input.candidates);
    return { ...normalized, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    if (error instanceof JevAdapterError) throw error;
    throw mapSdkError(error);
  }
}
