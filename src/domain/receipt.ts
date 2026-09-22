import type {
  AnalysisStats,
  LensConfig,
  Outcome,
  ProviderEvaluation,
  SessionReceipt,
} from './types';
import { MODEL, PROVIDER } from './types';

export const MAX_RECEIPT_HISTORY = 50;

export function createReceipt(input: {
  lens: LensConfig;
  stats: AnalysisStats;
  providerEvaluation: ProviderEvaluation | undefined;
  totalLatencyMs: number;
}): SessionReceipt {
  const usage = input.providerEvaluation?.usage;
  return {
    version: 1,
    phase: 'awaiting_outcome',
    lensId: input.lens.id,
    lensName: input.lens.name,
    strictness: input.lens.strictness,
    goal: input.lens.goal,
    mode: input.lens.mode,
    provider: PROVIDER,
    model: input.providerEvaluation?.model ?? MODEL,
    stats: input.stats,
    providerLatencyMs: input.providerEvaluation?.latencyMs ?? 0,
    totalLatencyMs: input.totalLatencyMs,
    ...(usage?.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
    ...(usage?.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
    costStatus: 'unavailable',
  };
}

export function completeReceipt(receipt: SessionReceipt, outcome: Outcome): SessionReceipt {
  if (receipt.phase === 'complete') throw new Error('The session receipt is already complete.');
  return {
    ...receipt,
    phase: 'complete',
    outcome,
    completedAt: new Date().toISOString(),
  };
}

export function appendReceiptHistory(
  history: readonly SessionReceipt[],
  receipt: SessionReceipt,
): SessionReceipt[] {
  return [...history, receipt].slice(-MAX_RECEIPT_HISTORY);
}

export function mergeReceipts(previous: SessionReceipt, next: SessionReceipt): SessionReceipt {
  const add = (left: number | undefined, right: number | undefined): number | undefined =>
    left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
  const inputTokens = add(previous.inputTokens, next.inputTokens);
  const outputTokens = add(previous.outputTokens, next.outputTokens);
  return {
    ...next,
    stats: {
      reviewed: previous.stats.reviewed + next.stats.reviewed,
      cacheHits: previous.stats.cacheHits + next.stats.cacheHits,
      providerEvaluated: previous.stats.providerEvaluated + next.stats.providerEvaluated,
      act: previous.stats.act + next.stats.act,
      inspect: previous.stats.inspect + next.stats.inspect,
      passed: previous.stats.passed + next.stats.passed,
      uncertain: previous.stats.uncertain + next.stats.uncertain,
      shown: Math.min(3, previous.stats.shown + next.stats.shown),
      worthActingOn: previous.stats.worthActingOn + next.stats.worthActingOn,
    },
    providerLatencyMs: previous.providerLatencyMs + next.providerLatencyMs,
    totalLatencyMs: previous.totalLatencyMs + next.totalLatencyMs,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
  };
}

export function formatReceipt(receipt: SessionReceipt): string {
  const lines = [
    'NEEDLE LENS — SESSION RECEIPT',
    'Session complete',
    `Lens       ${receipt.lensName}`,
    `Reviewed   ${receipt.stats.reviewed}`,
    `Act        ${receipt.stats.act}`,
    `Inspect    ${receipt.stats.inspect}`,
    `Uncertain  ${receipt.stats.uncertain}`,
    `Passed     ${receipt.stats.passed}`,
    `Shown: ${receipt.stats.shown}`,
    `Jev model: ${receipt.model}`,
    `Jev time   ${receipt.providerLatencyMs} ms`,
    `Cost       ${receipt.costStatus === 'unavailable' ? 'unavailable' : receipt.costUsd === undefined ? receipt.costStatus : `$${receipt.costUsd.toFixed(6)}`}`,
    `Outcome    ${receipt.outcome ?? 'awaiting user'}`,
    `Strictness: ${receipt.strictness}`,
    `Total session latency: ${receipt.totalLatencyMs} ms`,
    `Input usage: ${receipt.inputTokens ?? 'not reported'}`,
    `Output usage: ${receipt.outputTokens ?? 'not reported'}`,
    ...(receipt.completedAt ? [`Completed: ${receipt.completedAt}`] : []),
  ];
  return lines.join('\n');
}
