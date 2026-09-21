import { MAX_ITEMS } from './types';

export type LensMode = 'find_people' | 'find_problems' | 'find_signal';
export type LensStrictness = 'exploratory' | 'balanced' | 'strict';

export interface LensConfig {
  id: string;
  version: 1;
  name: string;
  goal: string;
  target: string[];
  evidence: string[];
  exclusions: string[];
  desiredActions: string[];
  mode: LensMode;
  strictness: LensStrictness;
  maxActions: 1 | 2 | 3;
  maxItems: number;
  createdAt: string;
  updatedAt: string;
}

const LENS_KEYS = ['id', 'version', 'name', 'goal', 'target', 'evidence', 'exclusions', 'desiredActions', 'mode', 'strictness', 'maxActions', 'maxItems', 'createdAt', 'updatedAt'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyLensKeys(value: Record<string, unknown>): boolean {
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && LENS_KEYS.includes(key as (typeof LENS_KEYS)[number]));
}

function stringInRange(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
}

function atomicList(value: unknown, min: number, max: number, field: string): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${field} must contain ${min === max ? min : `${min}–${max}`} entries.`);
  const entries = value.map((entry) => {
    if (!stringInRange(entry, 1, 200)) throw new Error(`${field} entries must be 1–200 characters.`);
    const normalized = entry.trim().replace(/\s+/g, ' ');
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(normalized)) throw new Error(`${field} entries contain unsupported control characters.`);
    return normalized;
  });
  if (new Set(entries).size !== entries.length) throw new Error(`${field} entries must be unique.`);
  return entries;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`Invalid ${field}.`);
  return value as T;
}

function idValue(value: unknown): string {
  if (!stringInRange(value, 1, 120) || !/^[A-Za-z0-9._:-]+$/.test(value.trim())) throw new Error('Lens id is invalid.');
  return value.trim();
}

function dateValue(value: unknown, field: string): string {
  if (!stringInRange(value, 1, 80) || Number.isNaN(Date.parse(value.trim()))) throw new Error(`${field} is invalid.`);
  return new Date(value.trim()).toISOString();
}

export function validateLensConfig(value: unknown): LensConfig {
  if (!isRecord(value) || !hasOnlyLensKeys(value)) throw new Error('Lens JSON contains unsupported fields.');
  if (value.version !== 1) throw new Error('Lens version is unsupported.');
  if (!stringInRange(value.name, 1, 60)) throw new Error('Lens name must be 1–60 characters.');
  if (!stringInRange(value.goal, 10, 500)) throw new Error('Lens goal must be 10–500 characters.');
  if (typeof value.maxItems !== 'number' || !Number.isInteger(value.maxItems) || value.maxItems < 1 || value.maxItems > MAX_ITEMS) throw new Error(`Lens maxItems must be an integer from 1–${MAX_ITEMS}.`);
  if (value.maxActions !== 1 && value.maxActions !== 2 && value.maxActions !== 3) throw new Error('Lens maxActions must be 1, 2, or 3.');
  return {
    id: idValue(value.id), version: 1, name: value.name.trim(), goal: value.goal.trim().replace(/\s+/g, ' '),
    target: atomicList(value.target, 1, 8, 'target'), evidence: atomicList(value.evidence, 1, 8, 'evidence'), exclusions: atomicList(value.exclusions, 0, 8, 'exclusions'), desiredActions: atomicList(value.desiredActions, 1, 5, 'desiredActions'),
    mode: enumValue(value.mode, ['find_people', 'find_problems', 'find_signal'], 'mode'), strictness: enumValue(value.strictness, ['exploratory', 'balanced', 'strict'], 'strictness'), maxActions: value.maxActions, maxItems: value.maxItems,
    createdAt: dateValue(value.createdAt, 'createdAt'), updatedAt: dateValue(value.updatedAt, 'updatedAt'),
  };
}

export function isLensConfig(value: unknown): value is LensConfig { try { validateLensConfig(value); return true; } catch { return false; } }

function makeId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${random ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
}

export function createLensConfig(input: Omit<LensConfig, 'id' | 'version' | 'createdAt' | 'updatedAt'> & Partial<Pick<LensConfig, 'id' | 'createdAt' | 'updatedAt'>>): LensConfig {
  const now = new Date().toISOString();
  return validateLensConfig({ ...input, id: input.id ?? makeId('lens'), version: 1, createdAt: input.createdAt ?? now, updatedAt: input.updatedAt ?? now });
}

export function duplicateLens(lens: LensConfig): LensConfig {
  const now = new Date().toISOString();
  return validateLensConfig({ ...lens, id: makeId('lens-copy'), name: `${lens.name} copy`.slice(0, 60), createdAt: now, updatedAt: now });
}

export function updateLens(lens: LensConfig, patch: Partial<Omit<LensConfig, 'id' | 'version' | 'createdAt' | 'updatedAt'>>): LensConfig {
  return validateLensConfig({ ...lens, ...patch, updatedAt: new Date().toISOString() });
}

export function restoreSafeDefaults(): LensConfig[] {
  const now = new Date().toISOString();
  return [validateLensConfig({
    id: 'lens-example-jev-infrastructure', version: 1, name: 'Example — Jev infrastructure prospects',
    goal: 'Find infrastructure teams describing a concrete problem where a Jev-powered decision workflow could help.',
    target: ['Infrastructure or platform engineering team', 'Person describing an operational decision problem'],
    evidence: ['Explicit implementation problem', 'Concrete system, workflow, or operational detail'],
    exclusions: ['Generic promotion or advertisement', 'No concrete problem or request'],
    desiredActions: ['Inspect the original post', 'Open the linked X status for context', 'Contact the person manually if appropriate'],
    mode: 'find_problems', strictness: 'balanced', maxActions: 3, maxItems: 30, createdAt: now, updatedAt: now,
  })];
}

export function lensForDecision(lens: LensConfig): Pick<LensConfig, 'goal' | 'target' | 'evidence' | 'exclusions' | 'desiredActions' | 'mode' | 'strictness'> {
  return { goal: lens.goal, target: [...lens.target], evidence: [...lens.evidence], exclusions: [...lens.exclusions], desiredActions: [...lens.desiredActions], mode: lens.mode, strictness: lens.strictness };
}

export function lensEditorSeed(mode: LensMode = 'find_signal'): Omit<LensConfig, 'id' | 'version' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'New Lens',
    goal: 'Find a specific, useful decision signal in visible posts.',
    target: ['A relevant person, problem, or signal'],
    evidence: ['Specific evidence in the post'],
    exclusions: [],
    desiredActions: ['Inspect the original post'],
    mode,
    strictness: 'balanced',
    maxActions: 3,
    maxItems: 30,
  };
}
