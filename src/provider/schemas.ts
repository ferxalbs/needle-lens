import * as v from 'valibot';

export const rawJevResponseSchema = v.object({
  model: v.string(),
  answers: v.record(v.string(), v.unknown()),
  usage: v.optional(
    v.object({
      input_tokens: v.number(),
      output_tokens: v.number(),
    }),
  ),
});

export type RawJevResponse = v.InferOutput<typeof rawJevResponseSchema>;

export function parseRawJevResponse(value: unknown): RawJevResponse {
  const result = v.safeParse(rawJevResponseSchema, value);
  if (!result.success) throw new Error('The provider response did not match the documented schema.');
  return result.output;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readFiniteNumber(
  record: Record<string, unknown>,
  key: string,
): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Provider field ${key} must be a finite number.`);
  }
  return value;
}
