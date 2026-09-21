import { DecisionCache, type CacheRetention } from '../src/cache/decision-cache';
import { appendReceiptHistory, completeReceipt } from '../src/domain/receipt';
import { MAX_ITEMS, MODEL, PROVIDER, type LensConfig, type Outcome, type SessionReceipt, type VisibleCandidate } from '../src/domain/types';
import { defaultLensFor, SettingsStore } from '../src/settings/storage';
import { CredentialStore, SESSION_API_KEY, SESSION_CREDENTIAL_RETENTION, SESSION_KEY_FINGERPRINT, type StorageAreaLike } from '../src/security/credentials';
import { JevAdapterError } from '../src/provider/jev-adapter';
import {
  FIELDS_LEAVING_BROWSER,
  isVisibleCandidate,
  parseMessage,
  type AnalysisPreview,
  type AnalysisResult,
  type ExtensionErrorCode,
  type ExtensionResponse,
  type SettingsSnapshot,
} from '../src/messaging/protocol';
import { ensureXAccess, X_HOST_ORIGINS } from '../src/security/x-access';
import { getActiveXTab, type ActiveTabErrorCode } from '../src/security/active-x-tab';
import { analyzeCandidates, getCacheState } from '../src/runtime/analyze';

const RECEIPT_STORAGE_KEY = 'needleLensReceipt';
const RECEIPT_HISTORY_STORAGE_KEY = 'needleLensReceiptHistory';
const LEGAL_LINKS = {
  needlePrivacy: 'https://github.com/ferxalbs/needle-lens/blob/main/docs/privacy.md',
  xTerms: 'https://x.com/en/tos',
  xPrivacy: 'https://x.com/en/privacy',
  typeSafePrivacy: 'https://typesafe.ai/legal/privacy-policy',
  repository: 'https://github.com/ferxalbs/needle-lens',
} as const;

type SessionStorage = StorageAreaLike & {
  clear(): Promise<void>;
  setAccessLevel?: (details: { accessLevel: 'TRUSTED_CONTEXTS' | 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }) => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCandidateList(value: unknown): value is VisibleCandidate[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return false;
  const ids = new Set<string>();
  return value.every((candidate) => {
    if (!isVisibleCandidate(candidate) || ids.has(candidate.id)) return false;
    ids.add(candidate.id);
    return true;
  });
}

function isStoredReceipt(value: unknown): value is SessionReceipt {
  if (!isRecord(value) || value.version !== 1 || (value.phase !== 'awaiting_outcome' && value.phase !== 'complete')) return false;
  if (typeof value.lensId !== 'string' || typeof value.lensName !== 'string' || typeof value.goal !== 'string') return false;
  if (value.mode !== 'find_people' && value.mode !== 'find_problems' && value.mode !== 'find_signal') return false;
  if (value.strictness !== 'exploratory' && value.strictness !== 'balanced' && value.strictness !== 'strict') return false;
  if (value.provider !== PROVIDER || typeof value.model !== 'string') return false;
  if (typeof value.providerLatencyMs !== 'number' || typeof value.totalLatencyMs !== 'number') return false;
  const stats = value.stats;
  if (!isRecord(stats)) return false;
  return ['reviewed', 'cacheHits', 'providerEvaluated', 'act', 'inspect', 'passed', 'uncertain', 'shown', 'worthActingOn']
    .every((field) => typeof stats[field] === 'number' && Number.isFinite(stats[field]));
}

function safeError(error: unknown): { error: string; code: ExtensionErrorCode } {
  if (error instanceof JevAdapterError) {
    const messages: Record<JevAdapterError['kind'], string> = {
      authentication: 'TypeSafe rejected the API key. Replace it in Settings and retry.',
      rate_limit: 'TypeSafe is temporarily rate-limited. Retry in a moment.',
      timeout: 'TypeSafe did not respond in time. Retry the analysis.',
      network: 'Needle Lens could not reach TypeSafe. Check the connection and retry.',
      contract: 'TypeSafe returned an unexpected typed response. Retry the analysis.',
      provider: 'TypeSafe could not complete the request. Retry the analysis.',
    };
    return { error: messages[error.kind], code: error.kind };
  }
  return { error: 'Needle Lens could not complete this request. Try again.', code: 'internal' };
}

const ACTIVE_TAB_MESSAGES: Record<ActiveTabErrorCode, string> = {
  permission_required: 'Needle Lens needs permission to read the posts visible on x.com.',
  permission_check_failed: 'Needle Lens could not verify permission. Try again.',
  permission_denied: 'Access was not granted. Needle Lens cannot inspect posts until you allow access to x.com.',
  active_tab_unavailable: 'Needle Lens could not verify the current tab. Check the extension permission and try again.',
  tab_url_unavailable: 'Needle Lens could not verify the current tab. Check the extension permission and try again.',
  unsupported_page: 'Open an x.com tab, then check the current tab again.',
  injection_failed: 'Needle Lens could not read visible posts on this page. Reload X and retry.',
  active_tab_changed: 'The active tab changed. Check the current tab and preview the visible posts again.',
};

function activeTabFailure(code: ActiveTabErrorCode): ExtensionResponse {
  return { ok: false, error: ACTIVE_TAB_MESSAGES[code], code };
}

function candidateState(candidates: readonly VisibleCandidate[]): AnalysisPreview['candidateState'] {
  return candidates.length === 0 ? { kind: 'empty' } : { kind: 'ready', count: candidates.length };
}

function sameCandidates(left: readonly VisibleCandidate[], right: readonly VisibleCandidate[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((candidate, index) => {
    const other = right[index];
    return other?.id === candidate.id && other.text === candidate.text && other.canonicalUrl === candidate.canonicalUrl &&
      other.viewportState === candidate.viewportState && other.viewportIndex === candidate.viewportIndex;
  });
}

export default defineBackground(() => {
  const session = browser.storage.session as unknown as SessionStorage;
  const local = browser.storage.local as unknown as StorageAreaLike;
  const settingsStore = new SettingsStore(local);
  const credentials = new CredentialStore(session, local);
  let cache: DecisionCache | undefined;
  let cacheRetention: CacheRetention | undefined;
  let activePreview: { sessionId: string; lens: LensConfig; candidates: VisibleCandidate[]; tabId: number; tabUrl: string } | undefined;
  let analysisInFlight = false;

  void session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => undefined);
  void browser.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => undefined);
  if (!browser.sidePanel) void browser.action?.setPopup?.({ popup: 'sidepanel.html' }).catch(() => undefined);
  void credentials.purgeExpired().catch(() => undefined);

  async function currentCache(settings?: Awaited<ReturnType<SettingsStore['get']>>): Promise<DecisionCache> {
    const resolved = settings ?? await settingsStore.get();
    if (!cache || cacheRetention !== resolved.cacheRetention) {
      cacheRetention = resolved.cacheRetention;
      cache = new DecisionCache(session, { retention: resolved.cacheRetention });
    }
    return cache;
  }

  async function storedReceipt(): Promise<SessionReceipt | undefined> {
    const values = await session.get(RECEIPT_STORAGE_KEY);
    return isStoredReceipt(values[RECEIPT_STORAGE_KEY]) ? values[RECEIPT_STORAGE_KEY] : undefined;
  }

  async function storedReceiptHistory(): Promise<SessionReceipt[]> {
    const values = await session.get(RECEIPT_HISTORY_STORAGE_KEY);
    const history = values[RECEIPT_HISTORY_STORAGE_KEY];
    return Array.isArray(history) ? history.filter(isStoredReceipt) : [];
  }

  async function stateResponse(): Promise<ExtensionResponse> {
    await credentials.purgeExpired();
    const [settings, credential, receipt, history] = await Promise.all([
      settingsStore.get(),
      credentials.status(),
      storedReceipt(),
      storedReceiptHistory(),
    ]);
    const activeLens = defaultLensFor(settings);
    const historyState = history.length > 0 ? { receiptHistory: history } : {};
    const base = { credential, ...(settings.consent ? { consent: settings.consent } : {}), activeLens, ...historyState };
    if (receipt) return { ok: true, type: 'state', value: { ...base, state: receipt.phase === 'complete' ? 'complete' : 'awaiting_outcome', receipt } };
    if (!credential.configured) return { ok: true, type: 'state', value: { ...base, state: 'needs_key' } };
    return { ok: true, type: 'state', value: { ...base, state: 'ready' } };
  }

  async function settingsSnapshot(): Promise<SettingsSnapshot> {
    await credentials.purgeExpired();
    const [settings, credential] = await Promise.all([settingsStore.get(), credentials.status()]);
    let xAccessGranted = false;
    try {
      xAccessGranted = await browser.permissions.contains({ origins: [...X_HOST_ORIGINS] });
    } catch {
      xAccessGranted = false;
    }
    return {
      settings,
      credential,
      xAccessGranted,
      xOrigins: X_HOST_ORIGINS,
      legal: LEGAL_LINKS,
    };
  }

  async function activeXTab() {
    return getActiveXTab(browser.tabs, browser.permissions);
  }

  async function extractFromTab(tabId: number): Promise<{ ok: true; candidates: VisibleCandidate[] } | { ok: false; code: 'injection_failed' }> {
    try {
      const injected = await browser.scripting.executeScript({ target: { tabId }, files: ['/visible.js'] });
      const result = injected[0]?.result;
      return isCandidateList(result) ? { ok: true, candidates: result } : { ok: false, code: 'injection_failed' };
    } catch {
      return { ok: false, code: 'injection_failed' };
    }
  }

  async function prepareAnalysis(lensId: string): Promise<ExtensionResponse> {
    const settings = await settingsStore.get();
    const lens = settings.lenses.find((entry) => entry.id === lensId);
    if (!lens) return { ok: false, error: 'Choose or create a Lens in Settings before analyzing.', code: 'lens_required' };
    const active = await activeXTab();
    if (!active.ok) return activeTabFailure(active.code);
    const extracted = await extractFromTab(active.value.id);
    if (!extracted.ok) return activeTabFailure(extracted.code);
    const candidates = extracted.candidates.slice(0, lens.maxItems);
    const sessionId = globalThis.crypto.randomUUID();
    const nextCache = await currentCache(settings);
    const { hits, misses } = candidates.length > 0
      ? await getCacheState(nextCache, candidates, lens)
      : { hits: new Map(), misses: [] };
    activePreview = { sessionId, lens, candidates, tabId: active.value.id, tabUrl: active.value.url };
    return {
      ok: true,
      type: 'preview',
      value: {
        sessionId,
        candidates,
        candidateCount: candidates.length,
        candidateState: candidateState(candidates),
        tabId: active.value.id,
        tabUrl: active.value.url,
        provider: PROVIDER,
        model: MODEL,
        activeLens: lens,
        fieldsLeavingBrowser: FIELDS_LEAVING_BROWSER,
        cacheHits: hits.size,
        providerEvaluated: misses.length,
        consentRequired: settings.consent === undefined,
      },
    };
  }

  async function checkPage(): Promise<ExtensionResponse> {
    const active = await activeXTab();
    if (!active.ok) return activeTabFailure(active.code);
    return { ok: true, type: 'page_checked', value: { tabId: active.value.id, tabUrl: active.value.url } };
  }

  async function confirmAnalysis(
    sessionId: string,
    candidates: readonly VisibleCandidate[],
    tabId: number,
    tabUrl: string,
  ): Promise<ExtensionResponse> {
    if (analysisInFlight) return { ok: false, error: 'An analysis is already running. Wait for it to finish.', code: 'analysis_in_progress' };
    const preview = activePreview;
    if (!preview || preview.sessionId !== sessionId || !sameCandidates(preview.candidates, candidates)) {
      return { ok: false, error: 'This preview is stale. Preview the current visible posts again.', code: 'stale_session' };
    }
    if (candidates.length < 1) return { ok: false, error: 'No eligible visible posts were found. Check the current X tab and retry.', code: 'empty_candidates' };
    analysisInFlight = true;
    try {
      const settings = await settingsStore.get();
      if (!settings.consent) return { ok: false, error: 'Review and accept the data-use notice before sending post text to TypeSafe.', code: 'consent_required' };
      const active = await activeXTab();
      if (!active.ok) return activeTabFailure(active.code);
      if (active.value.id !== tabId || active.value.url !== tabUrl) return activeTabFailure('active_tab_changed');
      const loaded = await credentials.load();
      if (!loaded) return { ok: false, error: 'Save a TypeSafe AI API key in Settings before analyzing.', code: 'missing_key' };
      const analysis = await analyzeCandidates({
        apiKey: loaded.apiKey,
        candidates,
        lens: preview.lens,
        cache: await currentCache(settings),
      });
      await session.set({ [RECEIPT_STORAGE_KEY]: analysis.receipt });
      await sendHighlights(active.value.id, analysis.cards.map(({ decision }) => decision));
      const result: AnalysisResult = { cards: analysis.cards, receipt: analysis.receipt, noUsefulAction: analysis.noUsefulAction };
      activePreview = undefined;
      return { ok: true, type: 'analysis', value: result };
    } catch (error) {
      if (error instanceof JevAdapterError && error.kind === 'authentication') await credentials.forget();
      throw error;
    } finally {
      analysisInFlight = false;
    }
  }

  async function sendHighlights(tabId: number, decisions: readonly { candidateId: string; label: string }[]): Promise<void> {
    try {
      await browser.tabs.sendMessage(tabId, {
        type: 'highlight_decisions',
        decisions: decisions.filter((decision) => decision.label === 'act' || decision.label === 'inspect').map((decision) => ({ candidateId: decision.candidateId, label: decision.label })),
      });
    } catch {
      // Highlighting is an enhancement; the side panel result remains authoritative.
    }
  }

  async function handleOutcome(outcome: Outcome): Promise<ExtensionResponse> {
    const receipt = await storedReceipt();
    if (!receipt) return { ok: false, error: 'Run an analysis before recording an outcome.', code: 'no_receipt' };
    const completed = completeReceipt(receipt, outcome);
    const receiptHistory = appendReceiptHistory(await storedReceiptHistory(), completed);
    await session.set({ [RECEIPT_STORAGE_KEY]: completed, [RECEIPT_HISTORY_STORAGE_KEY]: receiptHistory });
    return { ok: true, type: 'outcome', receipt: completed, receiptHistory };
  }

  async function handleXAccess(grant: boolean): Promise<ExtensionResponse> {
    if (grant) {
      const result = await ensureXAccess(browser.permissions);
      if (!result.ok) return activeTabFailure(result.code);
      return { ok: true, type: 'x_access_granted', granted: true };
    }
    try {
      const removed = await browser.permissions.remove({ origins: [...X_HOST_ORIGINS] });
      return { ok: true, type: 'x_access_revoked', granted: !removed };
    } catch {
      return { ok: false, error: 'Needle Lens could not revoke X access. Try again.', code: 'permission_check_failed' };
    }
  }

  async function handleMessage(value: unknown, sender: Browser.runtime.MessageSender): Promise<ExtensionResponse> {
    const extensionUrl = browser.runtime.getURL('');
    if (sender.id !== browser.runtime.id || !sender.url?.startsWith(extensionUrl)) {
      return { ok: false, error: 'Only a Needle Lens extension page may send this request.', code: 'unauthorized_sender' };
    }
    const message = parseMessage(value);
    if (!message) return { ok: false, error: 'The request format was invalid.', code: 'invalid_message' };
    try {
      switch (message.type) {
        case 'get_state': return stateResponse();
        case 'get_settings': return { ok: true, type: 'settings', value: await settingsSnapshot() };
        case 'save_key': {
          const saved = await credentials.save(message.apiKey, message.retention);
          return { ok: true, type: 'key_saved', fingerprint: saved.fingerprint, retention: saved.retention, ...(saved.expiresAt ? { expiresAt: saved.expiresAt } : {}), fallback: saved.fallback };
        }
        case 'forget_key': await credentials.forget(); return { ok: true, type: 'key_forgotten' };
        case 'clear_session': {
          await (await currentCache()).clear();
          await session.remove([SESSION_API_KEY, SESSION_KEY_FINGERPRINT, SESSION_CREDENTIAL_RETENTION, RECEIPT_STORAGE_KEY, RECEIPT_HISTORY_STORAGE_KEY]);
          activePreview = undefined;
          return { ok: true, type: 'session_cleared' };
        }
        case 'clear_decision_metadata': {
          await (await currentCache()).clear();
          await session.remove([RECEIPT_STORAGE_KEY, RECEIPT_HISTORY_STORAGE_KEY]);
          return { ok: true, type: 'metadata_cleared' };
        }
        case 'clear_all_local_data':
          await (await currentCache()).clear();
          await credentials.forget();
          await session.remove([RECEIPT_STORAGE_KEY, RECEIPT_HISTORY_STORAGE_KEY]);
          await settingsStore.clearAll();
          activePreview = undefined;
          return { ok: true, type: 'local_data_cleared' };
        case 'grant_consent': await settingsStore.grantConsent(); return { ok: true, type: 'consent_granted' };
        case 'revoke_consent': await settingsStore.revokeConsent(); return { ok: true, type: 'consent_revoked' };
        case 'check_page': return checkPage();
        case 'prepare_analysis': return prepareAnalysis(message.lensId);
        case 'confirm_analysis': return confirmAnalysis(message.sessionId, message.candidates, message.tabId, message.tabUrl);
        case 'declare_outcome': return handleOutcome(message.outcome);
        case 'save_lens': return { ok: true, type: 'lens_saved', lens: message.lens, settings: await settingsStore.saveLens(message.lens) };
        case 'duplicate_lens': {
          const lens = await settingsStore.duplicateLens(message.lensId);
          return { ok: true, type: 'lens_duplicated', lens, settings: await settingsStore.get() };
        }
        case 'delete_lens': return { ok: true, type: 'lens_deleted', settings: await settingsStore.deleteLens(message.lensId) };
        case 'set_active_lens': return { ok: true, type: 'active_lens_set', settings: await settingsStore.setActiveLens(message.lensId) };
        case 'set_defaults': return { ok: true, type: 'defaults_saved', settings: await settingsStore.setDefaults({ strictness: message.strictness, maxActions: message.maxActions, maxItems: message.maxItems, cacheRetention: message.cacheRetention }) };
        case 'export_lens': return { ok: true, type: 'lens_exported', lensId: message.lensId, json: await settingsStore.exportLens(message.lensId) };
        case 'import_lens': {
          const lens = await settingsStore.importLens(message.lens);
          return { ok: true, type: 'lens_imported', lens, settings: await settingsStore.get() };
        }
        case 'grant_x_access': return handleXAccess(true);
        case 'revoke_x_access': return handleXAccess(false);
      }
    } catch (error) {
      const failure = safeError(error);
      if (error instanceof Error && error.message.includes('Lens')) return { ok: false, error: 'The Lens configuration was invalid. Review its required fields.', code: 'invalid_lens' };
      return { ok: false, ...failure };
    }
  }

  browser.runtime.onMessage.addListener((value, sender, sendResponse) => {
    void handleMessage(value, sender).then(sendResponse).catch(() => {
      sendResponse({ ok: false, error: 'Needle Lens could not complete this request. Try again.', code: 'internal' } satisfies ExtensionResponse);
    });
    return true;
  });
});
