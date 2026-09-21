import { DecisionCache } from "../src/cache/decision-cache";
import { appendReceiptHistory, completeReceipt } from "../src/domain/receipt";
import {
  MODEL,
  PROVIDER,
  MAX_ITEMS,
  type Mode,
  type Outcome,
  type SessionReceipt,
  type VisibleCandidate,
} from "../src/domain/types";
import {
  FIELDS_LEAVING_BROWSER,
  isVisibleCandidate,
  parseMessage,
  type AnalysisPreview,
  type AnalysisResult,
  type ExtensionErrorCode,
  type ExtensionResponse,
} from "../src/messaging/protocol";
import { JevAdapterError } from "../src/provider/jev-adapter";
import { redactString } from "../src/security/redact";
import { sha256Hex } from "../src/security/hash";
import {
  getActiveXTab,
  type ActiveTabErrorCode,
} from "../src/security/active-x-tab";
import { analyzeCandidates, getCacheState } from "../src/runtime/analyze";

const API_KEY_STORAGE_KEY = "needleLensApiKey";
const KEY_FINGERPRINT_STORAGE_KEY = "needleLensKeyFingerprint";
const RECEIPT_STORAGE_KEY = "needleLensReceipt";
const RECEIPT_HISTORY_STORAGE_KEY = "needleLensReceiptHistory";

type SessionStorage = {
  get(keys: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string): Promise<void>;
  clear(): Promise<void>;
};

function isCandidateList(value: unknown): value is VisibleCandidate[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ITEMS)
    return false;
  const ids = new Set<string>();
  return value.every((candidate) => {
    if (!isVisibleCandidate(candidate) || ids.has(candidate.id)) return false;
    ids.add(candidate.id);
    return true;
  });
}

function safeError(
  error: unknown,
  secret?: string,
): { error: string; code: ExtensionErrorCode } {
  if (error instanceof JevAdapterError) {
    const messages = {
      authentication: 'TypeSafe rejected the API key. Save a new key and retry.',
      rate_limit: 'TypeSafe is temporarily rate-limited. Retry in a moment.',
      timeout: 'TypeSafe did not respond in time. Retry the analysis.',
      network: 'Needle Lens could not reach TypeSafe. Check the connection and retry.',
      contract: 'TypeSafe returned an unexpected response. Retry the analysis.',
      provider: 'TypeSafe could not complete the request. Retry the analysis.',
    } satisfies Record<typeof error.kind, string>;
    return { error: messages[error.kind], code: error.kind };
  }
  return {
    error: redactString('Needle Lens could not complete this request. Try again.', secret),
    code: 'internal',
  };
}

const ACTIVE_TAB_MESSAGES: Record<ActiveTabErrorCode, string> = {
  permission_required:
    "Needle Lens needs permission to read the posts visible on x.com.",
  permission_check_failed:
    'Needle Lens could not verify permission. Try again.',
  permission_denied:
    "Access was not granted. Needle Lens cannot inspect posts until you allow access to x.com.",
  active_tab_unavailable:
    "Needle Lens could not verify the current tab. Check the extension permission and try again.",
  tab_url_unavailable:
    "Needle Lens could not verify the current tab. Check the extension permission and try again.",
  unsupported_page: "Open an x.com tab, then check the current tab again.",
  injection_failed:
    "Needle Lens could not read visible posts on this page. Reload X and retry.",
  active_tab_changed:
    "The active tab changed. Check the current tab and preview the visible posts again.",
};

function activeTabFailure(code: ActiveTabErrorCode): ExtensionResponse {
  return { ok: false, error: ACTIVE_TAB_MESSAGES[code], code };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredReceipt(value: unknown): value is SessionReceipt {
  if (
    !isRecord(value) ||
    (value.phase !== "awaiting_outcome" && value.phase !== "complete")
  )
    return false;
  if (
    typeof value.goal !== "string" ||
    !["find_people", "find_problems", "find_signal"].includes(
      String(value.mode),
    )
  )
    return false;
  if (typeof value.provider !== "string" || typeof value.model !== "string")
    return false;
  if (
    typeof value.providerLatencyMs !== "number" ||
    typeof value.totalLatencyMs !== "number"
  )
    return false;
  const stats = value.stats;
  if (!isRecord(stats)) return false;
  return [
    "reviewed",
    "cacheHits",
    "providerEvaluated",
    "worthActingOn",
    "shown",
  ].every((field) => typeof stats[field] === "number");
}

export default defineBackground(() => {
  const storage = browser.storage.session as unknown as SessionStorage;
  const cache = new DecisionCache(storage);

  void browser.storage.session
    .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
    .catch(() => undefined);
  void browser.sidePanel
    ?.setPanelBehavior?.({ openPanelOnActionClick: true })
    ?.catch(() => undefined);
  if (!browser.sidePanel) {
    void browser.action
      ?.setPopup?.({ popup: "sidepanel.html" })
      ?.catch(() => undefined);
  }

  async function storedKey(): Promise<string | undefined> {
    const values = await storage.get(API_KEY_STORAGE_KEY);
    const key = values[API_KEY_STORAGE_KEY];
    return typeof key === "string" && key.length >= 8 ? key : undefined;
  }

  async function storedReceipt(): Promise<SessionReceipt | undefined> {
    const values = await storage.get(RECEIPT_STORAGE_KEY);
    return isStoredReceipt(values[RECEIPT_STORAGE_KEY])
      ? values[RECEIPT_STORAGE_KEY]
      : undefined;
  }

  async function storedReceiptHistory(): Promise<SessionReceipt[]> {
    const values = await storage.get(RECEIPT_HISTORY_STORAGE_KEY);
    const history = values[RECEIPT_HISTORY_STORAGE_KEY];
    return Array.isArray(history) ? history.filter(isStoredReceipt) : [];
  }

  async function stateResponse(): Promise<ExtensionResponse> {
    const [key, receipt, history, values] = await Promise.all([
      storedKey(),
      storedReceipt(),
      storedReceiptHistory(),
      storage.get(KEY_FINGERPRINT_STORAGE_KEY),
    ]);
    const historyState = history.length > 0 ? { receiptHistory: history } : {};
    if (!key)
      return {
        ok: true,
        type: "state",
        value: { state: "needs_key", ...historyState },
      };
    const fingerprint =
      typeof values[KEY_FINGERPRINT_STORAGE_KEY] === "string"
        ? values[KEY_FINGERPRINT_STORAGE_KEY]
        : undefined;
    if (receipt) {
      return {
        ok: true,
        type: "state",
        value: {
          state: receipt.phase,
          ...(fingerprint ? { keyFingerprint: fingerprint } : {}),
          receipt,
          ...historyState,
        },
      };
    }
    return {
      ok: true,
      type: "state",
      value: {
        state: "ready",
        ...(fingerprint ? { keyFingerprint: fingerprint } : {}),
        ...historyState,
      },
    };
  }

  async function activeXTab() {
    return getActiveXTab(browser.tabs, browser.permissions);
  }

  async function extractFromTab(
    tabId: number,
  ): Promise<
    | { ok: true; candidates: VisibleCandidate[] }
    | { ok: false; code: "injection_failed" }
  > {
    try {
      const injected = await browser.scripting.executeScript({
        target: { tabId },
        files: ["/visible.js"],
      });
      const result = injected[0]?.result;
      return isCandidateList(result)
        ? { ok: true, candidates: result }
        : { ok: false, code: "injection_failed" };
    } catch {
      return { ok: false, code: "injection_failed" };
    }
  }

  async function prepareAnalysis(
    goal: string,
    mode: Mode,
  ): Promise<ExtensionResponse> {
    const active = await activeXTab();
    if (!active.ok) return activeTabFailure(active.code);
    const extracted = await extractFromTab(active.value.id);
    if (!extracted.ok) return activeTabFailure(extracted.code);
    const { hits, misses } = await getCacheState(
      cache,
      extracted.candidates,
      goal,
      mode,
    );
    const value: AnalysisPreview = {
      candidates: extracted.candidates,
      candidateCount: extracted.candidates.length,
      tabId: active.value.id,
      tabUrl: active.value.url,
      provider: PROVIDER,
      model: MODEL,
      fieldsLeavingBrowser: FIELDS_LEAVING_BROWSER,
      cacheHits: hits.size,
      providerEvaluated: misses.length,
    };
    return { ok: true, type: "preview", value };
  }

  async function checkPage(): Promise<ExtensionResponse> {
    const active = await activeXTab();
    if (!active.ok) return activeTabFailure(active.code);
    return {
      ok: true,
      type: "page_checked",
      value: { tabId: active.value.id, tabUrl: active.value.url },
    };
  }

  async function confirmAnalysis(
    goal: string,
    mode: Mode,
    candidates: readonly VisibleCandidate[],
    tabId: number,
    tabUrl: string,
  ): Promise<ExtensionResponse> {
    const apiKey = await storedKey();
    if (!apiKey)
      return {
        ok: false,
        error: "Save a TypeSafe AI API key before analyzing.",
        code: "missing_key",
      };
    if (!isCandidateList(candidates) || candidates.length < 8) {
      return {
        ok: false,
        error: "At least 8 visible posts are required for a safe batch.",
        code: "insufficient_items",
      };
    }
    const active = await activeXTab();
    if (!active.ok) return activeTabFailure(active.code);
    if (active.value.id !== tabId || active.value.url !== tabUrl) {
      return activeTabFailure("active_tab_changed");
    }
    const analysis = await analyzeCandidates({
      apiKey,
      candidates,
      goal,
      mode,
      cache,
    });
    await Promise.all([
      storage.set({ [RECEIPT_STORAGE_KEY]: analysis.receipt }),
      sendHighlights(active.value.id, analysis.decisions),
    ]);
    const result: AnalysisResult = {
      cards: analysis.cards,
      receipt: analysis.receipt,
      noUsefulAction: analysis.noUsefulAction,
    };
    return { ok: true, type: "analysis", value: result };
  }

  async function sendHighlights(
    tabId: number,
    decisions: readonly { candidateId: string; label: string }[],
  ): Promise<void> {
    try {
      await browser.tabs.sendMessage(tabId, {
        type: "highlight_decisions",
        decisions: decisions.map((decision) => ({
          candidateId: decision.candidateId,
          label: decision.label === "act" ? "act" : "inspect",
        })),
      });
    } catch {
      // Highlighting is an enhancement; the side panel result remains authoritative.
    }
  }

  async function handleOutcome(outcome: Outcome): Promise<ExtensionResponse> {
    const receipt = await storedReceipt();
    if (!receipt)
      return {
        ok: false,
        error: "Run an analysis before recording an outcome.",
        code: "no_receipt",
      };
    const completed = completeReceipt(receipt, outcome);
    const receiptHistory = appendReceiptHistory(
      await storedReceiptHistory(),
      completed,
    );
    await storage.set({
      [RECEIPT_STORAGE_KEY]: completed,
      [RECEIPT_HISTORY_STORAGE_KEY]: receiptHistory,
    });
    return { ok: true, type: "outcome", receipt: completed, receiptHistory };
  }

  async function handleMessage(
    value: unknown,
    sender: Browser.runtime.MessageSender,
  ): Promise<ExtensionResponse> {
    const extensionUrl = browser.runtime.getURL("");
    if (
      sender.id !== browser.runtime.id ||
      (sender.url && !sender.url.startsWith(extensionUrl))
    ) {
      return {
        ok: false,
        error: "Only the Needle Lens side panel may send this request.",
        code: "unauthorized_sender",
      };
    }
    const message = parseMessage(value);
    if (!message)
      return {
        ok: false,
        error: "The request format was invalid.",
        code: "invalid_message",
      };
    try {
      switch (message.type) {
        case "get_state":
          return await stateResponse();
        case "save_key": {
          const fingerprint = (await sha256Hex(message.apiKey)).slice(0, 12);
          await storage.set({
            [API_KEY_STORAGE_KEY]: message.apiKey,
            [KEY_FINGERPRINT_STORAGE_KEY]: fingerprint,
          });
          return { ok: true, type: "key_saved", fingerprint };
        }
        case "forget_key":
          await storage.remove(API_KEY_STORAGE_KEY);
          await storage.remove(KEY_FINGERPRINT_STORAGE_KEY);
          return { ok: true, type: "key_forgotten" };
        case "clear_session":
          await cache.clear();
          await storage.clear();
          return { ok: true, type: "session_cleared" };
        case "check_page":
          return await checkPage();
        case "prepare_analysis":
          return await prepareAnalysis(message.goal, message.mode);
        case "confirm_analysis":
          return await confirmAnalysis(
            message.goal,
            message.mode,
            message.candidates,
            message.tabId,
            message.tabUrl,
          );
        case "declare_outcome":
          return await handleOutcome(message.outcome);
      }
    } catch (error) {
      if (error instanceof JevAdapterError && error.kind === "authentication") {
        await storage.remove(API_KEY_STORAGE_KEY);
        await storage.remove(KEY_FINGERPRINT_STORAGE_KEY);
      }
      const failure = safeError(
        error,
        await storedKey().catch(() => undefined),
      );
      return { ok: false, ...failure };
    }
  }

  browser.runtime.onMessage.addListener((value, sender, sendResponse) => {
    void handleMessage(value, sender)
      .then(sendResponse)
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: 'Needle Lens could not complete this request. Try again.',
          code: "internal",
        } satisfies ExtensionResponse);
      });
    return true;
  });
});
