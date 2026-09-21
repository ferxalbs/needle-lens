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
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function readFiniteNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Provider field ${key} must be a finite number.`);
  return value;
}

export function readUnitNumber(record: Record<string, unknown>, key: string): number {
  const value = readFiniteNumber(record, key);
  if (value < 0 || value > 1) throw new Error(`Provider field ${key} is outside the 0–1 range.`);
  return value;
}

export function readProbabilityMap(value: unknown): Readonly<Record<string, number>> {
  if (!isRecord(value)) throw new Error('Provider probabilities were not an object.');
  const entries = Object.entries(value);
  if (entries.length < 2) throw new Error('Provider probabilities were incomplete.');
  let total = 0;
  const probabilities: Record<string, number> = {};
  for (const [key, probability] of entries) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key)) throw new Error('Provider probability key was invalid.');
    if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new Error('Provider probabilities were outside the 0–1 range.');
    }
    probabilities[key] = probability;
    total += probability;
  }
  if (Math.abs(total - 1) > 0.03) throw new Error('Provider probabilities did not sum to one.');
  return probabilities;
}
