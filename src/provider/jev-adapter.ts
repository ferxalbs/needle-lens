import {
  normalizeNoul,
  normalizeScore,
} from '../domain/policy';
import type {
  JevSignals,
  Mode,
  ProviderEvaluation,
  VisibleCandidate,
} from '../domain/types';
import { PROVIDER_ENDPOINT } from '../domain/types';
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
    if (status === undefined) return;
    this.status = status;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function expectedFieldType(field: QuestionField): 'score' | 'noul' {
  return field === 'matchesGoal' || field === 'urgency' || field === 'novelty'
    ? 'score'
    : 'noul';
}

function parseSignal(
  answer: unknown,
  field: QuestionField,
): JevSignals[QuestionField] {
  if (!isRecord(answer) || answer.type !== expectedFieldType(field)) {
    throw new JevAdapterError('contract', `Provider answer type mismatch for ${field}.`);
  }

  if (field === 'matchesGoal' || field === 'urgency' || field === 'novelty') {
    try {
      const score = readFiniteNumber(answer, 'score');
      const confidence = readFiniteNumber(answer, 'confidence');
      return { value: normalizeScore(score, 3, confidence), confidence };
    } catch (error) {
      throw new JevAdapterError(
        'contract',
        error instanceof Error ? error.message : `Provider returned an invalid ${field} score.`,
      );
    }
  }

  try {
    return { value: normalizeNoul(readFiniteNumber(answer, 'noul')) };
  } catch (error) {
    throw new JevAdapterError(
      'contract',
      error instanceof Error ? error.message : `Provider returned an invalid ${field} value.`,
    );
  }
}

export function normalizeAnswers(
  raw: unknown,
  candidates: readonly VisibleCandidate[],
): { signalsByCandidateId: ReadonlyMap<string, JevSignals>; model: string; usage?: NonNullable<ProviderEvaluation['usage']> } {
  let response;
  try {
    response = parseRawJevResponse(raw);
  } catch (error) {
    throw new JevAdapterError(
      'contract',
      error instanceof Error ? error.message : 'The provider response was malformed.',
    );
  }

  const expected = new Map<string, { candidateId: string; field: QuestionField }>();
  for (const candidate of candidates) {
    for (const field of QUESTION_FIELDS) {
      expected.set(expectedQuestionId(candidate.id, field), {
        candidateId: candidate.id,
        field,
      });
    }
  }

  for (const key of Object.keys(response.answers)) {
    if (!expected.has(key)) {
      throw new JevAdapterError('contract', `Provider returned an unknown answer id: ${key}.`);
    }
  }

  const byCandidate = new Map<string, Partial<JevSignals>>();
  for (const [key, expectedAnswer] of expected) {
    const answer = response.answers[key];
    if (answer === undefined) {
      throw new JevAdapterError('contract', `Provider omitted answer id: ${key}.`);
    }
    const signals = byCandidate.get(expectedAnswer.candidateId) ?? {};
    signals[expectedAnswer.field] = parseSignal(answer, expectedAnswer.field) as never;
    byCandidate.set(expectedAnswer.candidateId, signals);
  }

  const signalsByCandidateId = new Map<string, JevSignals>();
  for (const candidate of candidates) {
    const signals = byCandidate.get(candidate.id);
    if (!signals || Object.keys(signals).length !== QUESTION_FIELDS.length) {
      throw new JevAdapterError('contract', `Provider returned incomplete answers for ${candidate.id}.`);
    }
    signalsByCandidateId.set(candidate.id, signals as JevSignals);
  }

  const usage = response.usage
    ? {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      }
    : undefined;
  const base = {
    signalsByCandidateId,
    model: response.model,
  };
  return usage ? { ...base, usage } : base;
}

export async function evaluateWithJev(input: {
  apiKey: string;
  candidates: readonly VisibleCandidate[];
  goal: string;
  mode: Mode;
  fetchImpl?: FetchLike;
  endpoint?: string;
  timeoutMs?: number;
}): Promise<ProviderEvaluation> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const endpoint = input.endpoint ?? PROVIDER_ENDPOINT;
  const timeoutMs = input.timeoutMs ?? 30_000;
  const request = buildJevRequest(input.candidates, input.goal, input.mode);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new JevAdapterError('timeout', 'The provider request timed out.');
    }
    throw new JevAdapterError(
      'network',
      error instanceof Error ? `The provider could not be reached: ${error.message}` : 'The provider could not be reached.',
    );
  }
  clearTimeout(timer);

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new JevAdapterError('authentication', 'The provider rejected the API key.', response.status);
    }
    if (response.status === 429) {
      throw new JevAdapterError('rate_limit', 'The provider rate limit was reached.', response.status);
    }
    throw new JevAdapterError('provider', `The provider returned HTTP ${response.status}.`, response.status);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await response.text()) as unknown;
  } catch {
    throw new JevAdapterError('contract', 'The provider returned invalid JSON.');
  }

  const normalized = normalizeAnswers(raw, input.candidates);
  return {
    ...normalized,
    latencyMs: Math.round(performance.now() - started),
  };
}
