import type {
  Decision,
  Mode,
  Outcome,
  SessionReceipt,
  VisibleCandidate,
} from "../domain/types";
import { MAX_ITEMS, MIN_ITEMS, MODEL, PROVIDER } from "../domain/types";
import type { ActiveTabErrorCode } from "../security/active-x-tab";

export type ExtensionErrorCode =
  | ActiveTabErrorCode
  | "missing_key"
  | "insufficient_items"
  | "authentication"
  | "rate_limit"
  | "timeout"
  | "network"
  | "contract"
  | "provider"
  | "no_receipt"
  | "unauthorized_sender"
  | "invalid_message"
  | "runtime"
  | "internal";

export type ExtensionMessage =
  | { type: "get_state" }
  | { type: "save_key"; apiKey: string }
  | { type: "forget_key" }
  | { type: "clear_session" }
  | { type: "check_page" }
  | { type: "prepare_analysis"; goal: string; mode: Mode }
  | {
      type: "confirm_analysis";
      goal: string;
      mode: Mode;
      candidates: VisibleCandidate[];
      tabId: number;
      tabUrl: string;
    }
  | { type: "declare_outcome"; outcome: Outcome };

export type ResultCard = {
  candidate: VisibleCandidate;
  decision: Decision;
};

export type AnalysisPreview = {
  candidates: VisibleCandidate[];
  candidateCount: number;
  tabId: number;
  tabUrl: string;
  provider: typeof PROVIDER;
  model: typeof MODEL;
  fieldsLeavingBrowser: readonly string[];
  cacheHits: number;
  providerEvaluated: number;
};

export type AnalysisResult = {
  cards: ResultCard[];
  receipt: SessionReceipt;
  noUsefulAction: boolean;
};

export type BackgroundState = {
  state: "needs_key" | "ready" | "awaiting_outcome" | "complete";
  keyFingerprint?: string;
  receipt?: SessionReceipt;
  receiptHistory?: SessionReceipt[];
};

export type ExtensionResponse =
  | { ok: true; type: "state"; value: BackgroundState }
  | { ok: true; type: "page_checked"; value: { tabId: number; tabUrl: string } }
  | { ok: true; type: "key_saved"; fingerprint: string }
  | { ok: true; type: "key_forgotten" }
  | { ok: true; type: "session_cleared" }
  | { ok: true; type: "preview"; value: AnalysisPreview }
  | { ok: true; type: "analysis"; value: AnalysisResult }
  | {
      ok: true;
      type: "outcome";
      receipt: SessionReceipt;
      receiptHistory?: SessionReceipt[];
    }
  | { ok: false; error: string; code?: ExtensionErrorCode };

export const FIELDS_LEAVING_BROWSER = [
  "goal",
  "mode",
  "visible post text",
] as const;

export function isMode(value: unknown): value is Mode {
  return (
    value === "find_people" ||
    value === "find_problems" ||
    value === "find_signal"
  );
}

export function isOutcome(value: unknown): value is Outcome {
  return (
    value === "contacted" ||
    value === "investigated" ||
    value === "saved_for_later" ||
    value === "discarded" ||
    value === "no_action"
  );
}

export function isVisibleCandidate(value: unknown): value is VisibleCandidate {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    record.id.length < 200 &&
    record.source === "x-visible-dom" &&
    typeof record.text === "string" &&
    record.text.length > 0 &&
    record.text.length <= 20_000 &&
    (record.author === undefined || typeof record.author === "string") &&
    (record.canonicalUrl === undefined ||
      typeof record.canonicalUrl === "string") &&
    (record.viewportState === "visible" ||
      record.viewportState === "near-viewport") &&
    typeof record.viewportIndex === "number" &&
    Number.isInteger(record.viewportIndex)
  );
}

export function isVisibleCandidateList(
  value: unknown,
): value is VisibleCandidate[] {
  if (
    !Array.isArray(value) ||
    value.length < MIN_ITEMS ||
    value.length > MAX_ITEMS
  )
    return false;
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!isVisibleCandidate(candidate) || ids.has(candidate.id)) return false;
    ids.add(candidate.id);
  }
  return true;
}

export function parseMessage(value: unknown): ExtensionMessage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  switch (record.type) {
    case "get_state":
    case "forget_key":
    case "clear_session":
    case "check_page":
      return { type: record.type };
    case "save_key":
      return typeof record.apiKey === "string" &&
        record.apiKey.length >= 8 &&
        !/[\r\n]/.test(record.apiKey)
        ? { type: "save_key", apiKey: record.apiKey }
        : undefined;
    case "prepare_analysis":
      return typeof record.goal === "string" &&
        record.goal.trim().length > 0 &&
        isMode(record.mode)
        ? {
            type: "prepare_analysis",
            goal: record.goal.trim().slice(0, 500),
            mode: record.mode,
          }
        : undefined;
    case "confirm_analysis":
      return typeof record.goal === "string" &&
        record.goal.trim().length > 0 &&
        isMode(record.mode) &&
        isVisibleCandidateList(record.candidates) &&
        typeof record.tabId === "number" &&
        Number.isInteger(record.tabId) &&
        record.tabId >= 0 &&
        typeof record.tabUrl === "string" &&
        record.tabUrl.length > 0 &&
        record.tabUrl.length <= 4_000
        ? {
            type: "confirm_analysis",
            goal: record.goal.trim().slice(0, 500),
            mode: record.mode,
            candidates: record.candidates,
            tabId: record.tabId,
            tabUrl: record.tabUrl,
          }
        : undefined;
    case "declare_outcome":
      return isOutcome(record.outcome)
        ? { type: "declare_outcome", outcome: record.outcome }
        : undefined;
    default:
      return undefined;
  }
}

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  return parseMessage(value) !== undefined;
}
