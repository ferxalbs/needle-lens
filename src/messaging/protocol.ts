import type {
  Decision,
  LensConfig,
  LensMode,
  LensStrictness,
  Mode,
  Outcome,
  SessionReceipt,
  VisibleCandidate,
} from '../domain/types';
import { MAX_CANDIDATE_TEXT, MAX_ITEMS, MIN_ITEMS, MODEL, PROVIDER } from '../domain/types';
import type { CredentialRetention, CredentialStatus } from '../security/credentials';
import type { ActiveTabErrorCode } from '../security/active-x-tab';
import { parseEligibleXUrl } from '../security/active-x-tab';
import type { AppSettings, ConsentRecord } from '../settings/storage';
import { isLensConfig } from '../domain/lens';
import { canonicalStatusUrl } from '../extraction/normalize';

export type ExtensionErrorCode =
  | ActiveTabErrorCode
  | 'missing_key'
  | 'empty_candidates'
  | 'authentication'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'contract'
  | 'provider'
  | 'no_receipt'
  | 'consent_required'
  | 'lens_required'
  | 'stale_session'
  | 'analysis_in_progress'
  | 'invalid_lens'
  | 'credential_persistence'
  | 'unauthorized_sender'
  | 'invalid_message'
  | 'runtime'
  | 'internal';

export type CacheRetention = 'off' | 'session' | '24h';
export type ExtractionErrorCode = ActiveTabErrorCode;

export type CandidateState =
  | { kind: 'empty' }
  | { kind: 'ready'; count: number }
  | { kind: 'failed'; code: ExtractionErrorCode };

export type ExtensionMessage =
  | { type: 'get_state' }
  | { type: 'get_settings' }
  | { type: 'save_key'; apiKey: string; retention: CredentialRetention }
  | { type: 'forget_key' }
  | { type: 'clear_session' }
  | { type: 'clear_decision_metadata' }
  | { type: 'clear_all_local_data' }
  | { type: 'grant_consent' }
  | { type: 'revoke_consent' }
  | { type: 'check_page' }
  | { type: 'prepare_analysis'; lensId: string }
  | {
      type: 'confirm_analysis';
      sessionId: string;
      candidates: VisibleCandidate[];
      tabId: number;
      tabUrl: string;
    }
  | { type: 'declare_outcome'; outcome: Outcome }
  | { type: 'save_lens'; lens: LensConfig }
  | { type: 'duplicate_lens'; lensId: string }
  | { type: 'delete_lens'; lensId: string }
  | { type: 'set_active_lens'; lensId: string }
  | { type: 'set_defaults'; strictness: LensStrictness; maxActions: 1 | 2 | 3; maxItems: number; cacheRetention: CacheRetention }
  | { type: 'export_lens'; lensId: string }
  | { type: 'import_lens'; lens: unknown }
  | { type: 'grant_x_access' }
  | { type: 'revoke_x_access' };

export type ResultCard = {
  candidate: VisibleCandidate;
  decision: Decision;
};

export type AnalysisPreview = {
  sessionId: string;
  candidates: VisibleCandidate[];
  candidateCount: number;
  candidateState: CandidateState;
  tabId: number;
  tabUrl: string;
  provider: typeof PROVIDER;
  model: typeof MODEL;
  activeLens: LensConfig;
  fieldsLeavingBrowser: readonly string[];
  cacheHits: number;
  providerEvaluated: number;
  consentRequired: boolean;
};

export type AnalysisResult = {
  cards: ResultCard[];
  receipt: SessionReceipt;
  noUsefulAction: boolean;
};

export type BackgroundState = {
  state: 'needs_lens' | 'needs_key' | 'ready' | 'awaiting_consent' | 'awaiting_outcome' | 'complete';
  activeLens?: LensConfig;
  credential: CredentialStatus;
  consent?: ConsentRecord;
  receipt?: SessionReceipt;
  receiptHistory?: SessionReceipt[];
};

export type SettingsSnapshot = {
  settings: AppSettings;
  credential: CredentialStatus;
  xAccessGranted: boolean;
  xOrigins: readonly string[];
  legal: {
    needlePrivacy: string;
    xTerms: string;
    xPrivacy: string;
    typeSafePrivacy: string;
    repository: string;
  };
};

export type ExtensionResponse =
  | { ok: true; type: 'state'; value: BackgroundState }
  | { ok: true; type: 'settings'; value: SettingsSnapshot }
  | { ok: true; type: 'page_checked'; value: { tabId: number; tabUrl: string } }
  | { ok: true; type: 'key_saved'; fingerprint: string; retention: CredentialRetention; expiresAt?: number; fallback: boolean }
  | { ok: true; type: 'key_forgotten' }
  | { ok: true; type: 'session_cleared' }
  | { ok: true; type: 'metadata_cleared' }
  | { ok: true; type: 'local_data_cleared' }
  | { ok: true; type: 'consent_granted' }
  | { ok: true; type: 'consent_revoked' }
  | { ok: true; type: 'preview'; value: AnalysisPreview }
  | { ok: true; type: 'analysis'; value: AnalysisResult }
  | { ok: true; type: 'outcome'; receipt: SessionReceipt; receiptHistory?: SessionReceipt[] }
  | { ok: true; type: 'lens_saved'; lens: LensConfig; settings: AppSettings }
  | { ok: true; type: 'lens_duplicated'; lens: LensConfig; settings: AppSettings }
  | { ok: true; type: 'lens_deleted'; settings: AppSettings }
  | { ok: true; type: 'active_lens_set'; settings: AppSettings }
  | { ok: true; type: 'defaults_saved'; settings: AppSettings }
  | { ok: true; type: 'lens_exported'; lensId: string; json: string }
  | { ok: true; type: 'lens_imported'; lens: LensConfig; settings: AppSettings }
  | { ok: true; type: 'x_access_granted'; granted: boolean }
  | { ok: true; type: 'x_access_revoked'; granted: boolean }
  | { ok: false; error: string; code?: ExtensionErrorCode };

export const FIELDS_LEAVING_BROWSER = [
  'Lens goal and criteria',
  'selected mode and strictness',
  'visible post text',
] as const;

export function isMode(value: unknown): value is Mode {
  return value === 'find_people' || value === 'find_problems' || value === 'find_signal';
}

export function isOutcome(value: unknown): value is Outcome {
  return value === 'contacted' || value === 'investigated' || value === 'saved_for_later' || value === 'discarded' || value === 'no_action';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && allowed.has(key));
}

export function isVisibleCandidate(value: unknown): value is VisibleCandidate {
  if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'source', 'author', 'text', 'canonicalUrl', 'viewportState', 'viewportIndex'])) return false;
  if (
    typeof value.id !== 'string' || value.id.length < 1 || value.id.length >= 200 ||
    value.source !== 'x-visible-dom' || typeof value.text !== 'string' || value.text.length < 1 || value.text.length > MAX_CANDIDATE_TEXT ||
    (value.author !== undefined && (typeof value.author !== 'string' || value.author.length > 200)) ||
    (value.viewportState !== 'visible' && value.viewportState !== 'near-viewport') ||
    typeof value.viewportIndex !== 'number' || !Number.isInteger(value.viewportIndex) || value.viewportIndex < 0
  ) return false;
  if (value.canonicalUrl !== undefined && (typeof value.canonicalUrl !== 'string' || canonicalStatusUrl(value.canonicalUrl) !== value.canonicalUrl)) return false;
  return true;
}

export function isVisibleCandidateList(value: unknown): value is VisibleCandidate[] {
  if (!Array.isArray(value) || value.length < MIN_ITEMS || value.length > MAX_ITEMS) return false;
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!isVisibleCandidate(candidate) || ids.has(candidate.id)) return false;
    ids.add(candidate.id);
  }
  return true;
}

function isStringId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 120 && /^[A-Za-z0-9._:-]+$/.test(value);
}

export function parseMessage(value: unknown): ExtensionMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;
  switch (value.type) {
    case 'get_state':
    case 'get_settings':
    case 'forget_key':
    case 'clear_session':
    case 'clear_decision_metadata':
    case 'clear_all_local_data':
    case 'grant_consent':
    case 'revoke_consent':
    case 'check_page':
    case 'grant_x_access':
    case 'revoke_x_access':
      return hasOnlyKeys(value, ['type']) ? { type: value.type } : undefined;
    case 'save_key':
      return hasOnlyKeys(value, ['type', 'apiKey', 'retention']) && typeof value.apiKey === 'string' && value.apiKey.length >= 8 && value.apiKey.length <= 500 && !/[\r\n]/.test(value.apiKey) &&
        (value.retention === 'session' || value.retention === 'seven_days')
        ? { type: 'save_key', apiKey: value.apiKey, retention: value.retention }
        : undefined;
    case 'prepare_analysis':
      return hasOnlyKeys(value, ['type', 'lensId']) && isStringId(value.lensId) ? { type: 'prepare_analysis', lensId: value.lensId } : undefined;
    case 'confirm_analysis':
      return hasOnlyKeys(value, ['type', 'sessionId', 'candidates', 'tabId', 'tabUrl']) && isStringId(value.sessionId) && isVisibleCandidateList(value.candidates) &&
        typeof value.tabId === 'number' && Number.isInteger(value.tabId) && value.tabId >= 0 &&
        typeof value.tabUrl === 'string' && value.tabUrl.length > 0 && value.tabUrl.length <= 4_000 && parseEligibleXUrl(value.tabUrl)?.href === value.tabUrl
        ? { type: 'confirm_analysis', sessionId: value.sessionId, candidates: value.candidates, tabId: value.tabId, tabUrl: value.tabUrl }
        : undefined;
    case 'declare_outcome':
      return hasOnlyKeys(value, ['type', 'outcome']) && isOutcome(value.outcome) ? { type: 'declare_outcome', outcome: value.outcome } : undefined;
    case 'save_lens':
      return hasOnlyKeys(value, ['type', 'lens']) && isLensConfig(value.lens) ? { type: 'save_lens', lens: value.lens } : undefined;
    case 'duplicate_lens':
    case 'delete_lens':
    case 'set_active_lens':
    case 'export_lens':
      return hasOnlyKeys(value, ['type', 'lensId']) && isStringId(value.lensId) ? { type: value.type, lensId: value.lensId } : undefined;
    case 'set_defaults':
      return hasOnlyKeys(value, ['type', 'strictness', 'maxActions', 'maxItems', 'cacheRetention']) &&
        (value.strictness === 'exploratory' || value.strictness === 'balanced' || value.strictness === 'strict') &&
        (value.maxActions === 1 || value.maxActions === 2 || value.maxActions === 3) &&
        typeof value.maxItems === 'number' && Number.isInteger(value.maxItems) && value.maxItems >= 1 && value.maxItems <= MAX_ITEMS &&
        (value.cacheRetention === 'off' || value.cacheRetention === 'session' || value.cacheRetention === '24h')
        ? { type: 'set_defaults', strictness: value.strictness, maxActions: value.maxActions, maxItems: value.maxItems, cacheRetention: value.cacheRetention }
        : undefined;
    case 'import_lens':
      return hasOnlyKeys(value, ['type', 'lens']) && isLensConfig(value.lens) ? { type: 'import_lens', lens: value.lens } : undefined;
    default:
      return undefined;
  }
}

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  return parseMessage(value) !== undefined;
}
