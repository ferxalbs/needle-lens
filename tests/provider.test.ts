import { describe, expect, it } from 'vitest';
import { buildJevRequest } from '../src/provider/contract';
import { evaluateWithJev, JevAdapterError } from '../src/provider/jev-adapter';
import type { VisibleCandidate } from '../src/domain/types';

const candidates: VisibleCandidate[] = Array.from({ length: 8 }, (_, index) => ({
  id: `status_${index}`,
  source: 'x-visible-dom',
  text: `post ${index}`,
  viewportState: 'visible',
  viewportIndex: index,
}));

function providerResponse() {
  const request = buildJevRequest(candidates, 'find leads', 'find_people');
  const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => [
    id,
    question.type === 'score'
      ? { type: 'score', score: 3, confidence: 0.9 }
      : { type: 'noul', noul: 0.8 },
  ]));
  return { model: 'jev-latest', answers, usage: { input_tokens: 123, output_tokens: 456 } };
}

describe('Jev adapter', () => {
  it('builds the maximum one-request batch with 240 stable item-scoped questions', () => {
    const maximum = Array.from({ length: 30 }, (_, index) => ({
      ...candidates[index % candidates.length]!,
      id: `status_max_${index}`,
      text: `maximum batch post ${index}`,
      viewportIndex: index,
    }));
    const request = buildJevRequest(maximum, 'find leads', 'find_people');
    const ids = Object.keys(request.questions);
    expect(ids).toHaveLength(240);
    expect(new Set(ids).size).toBe(240);
    expect(ids[0]).toBe('status_max_0__matchesGoal');
    expect(ids.at(-1)).toBe('status_max_29__isPromotional');
  });

  it('batches all questions into one native fetch with the user key', async () => {
    let calls = 0;
    const evaluation = await evaluateWithJev({
      apiKey: 'ts_test_key_123',
      candidates,
      goal: 'find leads',
      mode: 'find_people',
      endpoint: 'https://provider.invalid/v1/systemone',
      fetchImpl: async (_input, init) => {
        calls += 1;
        expect(init?.method).toBe('POST');
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer ts_test_key_123' });
        return new Response(JSON.stringify(providerResponse()), { status: 200 });
      },
    });
    expect(calls).toBe(1);
    expect(evaluation.signalsByCandidateId.size).toBe(8);
    expect(evaluation.signalsByCandidateId.get('status_0')?.matchesGoal.value).toBe(1);
    expect(evaluation.usage).toEqual({ inputTokens: 123, outputTokens: 456 });
  });

  it('rejects a response with an unknown answer id', async () => {
    await expect(evaluateWithJev({
      apiKey: 'ts_test_key_123', candidates, goal: 'find leads', mode: 'find_people',
      fetchImpl: async () => new Response(JSON.stringify({ ...providerResponse(), answers: { nope: { type: 'noul', noul: 0.5 } } }), { status: 200 }),
    })).rejects.toMatchObject({ kind: 'contract' });
  });

  it('rejects duplicate candidate ids before making a request', () => {
    expect(() => buildJevRequest([candidates[0]!, candidates[0]!], 'find leads', 'find_people'))
      .toThrow('Duplicate candidate id');
  });

  it('rejects malformed, wrong-type, and out-of-range provider answers', async () => {
    const cases: Array<{ name: string; answer: unknown }> = [
      { name: 'wrong type', answer: { type: 'noul', noul: 0.5 } },
      { name: 'score outside range', answer: { type: 'score', score: 4, confidence: 0.9 } },
      { name: 'noul outside range', answer: { type: 'noul', noul: 1.1 } },
      { name: 'non-finite score', answer: { type: 'score', score: Number.NaN, confidence: 0.9 } },
    ];

    for (const testCase of cases) {
      await expect(evaluateWithJev({
        apiKey: 'ts_test_key_123', candidates, goal: 'find leads', mode: 'find_people',
        fetchImpl: async () => {
          const request = buildJevRequest(candidates, 'find leads', 'find_people');
          const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => [
            id,
            id === 'status_0__matchesGoal'
              ? testCase.answer
              : question.type === 'score'
                ? { type: 'score', score: 3, confidence: 0.9 }
                : { type: 'noul', noul: 0.8 },
          ]));
          return new Response(JSON.stringify({ model: 'jev-latest', answers }), { status: 200 });
        },
      })).rejects.toMatchObject({ kind: 'contract' });
    }
  });

  it('maps authentication, rate-limit, timeout, malformed-json, and network failures without retrying', async () => {
    await expect(evaluateWithJev({
      apiKey: 'ts_test_key_123', candidates, goal: 'find leads', mode: 'find_people',
      fetchImpl: async () => new Response('', { status: 401 }),
    })).rejects.toBeInstanceOf(JevAdapterError);
    await expect(evaluateWithJev({
      apiKey: 'ts_test_key_123', candidates, goal: 'find leads', mode: 'find_people',
      fetchImpl: async () => new Response('', { status: 403 }),
    })).rejects.toMatchObject({ kind: 'authentication', status: 403 });
    await expect(evaluateWithJev({
      apiKey: 'ts_test_key_123', candidates, goal: 'find leads', mode: 'find_people',
      fetchImpl: async () => new Response('', { status: 429 }),
    })).rejects.toMatchObject({ kind: 'rate_limit', status: 429 });
    await expect(evaluateWithJev({
      apiKey: 'ts_test_key_123', candidates, goal: 'find leads', mode: 'find_people',
      fetchImpl: async () => new Response('not-json', { status: 200 }),
    })).rejects.toMatchObject({ kind: 'contract' });
    await expect(evaluateWithJev({
      apiKey: 'ts_test_key_123', candidates, goal: 'find leads', mode: 'find_people', timeoutMs: 5,
      fetchImpl: async () => new Promise<Response>((_, reject) => {
        setTimeout(() => reject(new Error('aborted')), 20);
      }),
    })).rejects.toMatchObject({ kind: 'timeout' });
    await expect(evaluateWithJev({
      apiKey: 'ts_test_key_123', candidates, goal: 'find leads', mode: 'find_people',
      fetchImpl: async () => { throw new Error('offline'); },
    })).rejects.toMatchObject({ kind: 'network' });
  });
});
