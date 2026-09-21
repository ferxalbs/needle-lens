import type {
  AnalysisStats,
  Mode,
  Outcome,
  ProviderEvaluation,
  SessionReceipt,
} from './types';
import { PROVIDER } from './types';

export const MAX_RECEIPT_HISTORY = 50;

export function createReceipt(input: {
  goal: string;
  mode: Mode;
  stats: AnalysisStats;
  providerEvaluation: ProviderEvaluation | undefined;
  totalLatencyMs: number;
}): SessionReceipt {
  const usage = input.providerEvaluation?.usage;
  return {
    version: 1,
    phase: 'awaiting_outcome',
    goal: input.goal,
    mode: input.mode,
    provider: PROVIDER,
    model: input.providerEvaluation?.model ?? 'cached-session-results',
    stats: input.stats,
    providerLatencyMs: input.providerEvaluation?.latencyMs ?? 0,
    totalLatencyMs: input.totalLatencyMs,
    ...(usage?.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
    ...(usage?.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
    costStatus: 'unavailable',
  };
}

export function completeReceipt(receipt: SessionReceipt, outcome: Outcome): SessionReceipt {
  if (receipt.phase === 'complete') {
    throw new Error('The session receipt is already complete.');
  }
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

export function formatReceipt(receipt: SessionReceipt): string {
  const lines = [
    'NEEDLE LENS — SESSION RECEIPT',
    `Goal: ${receipt.goal}`,
    `Mode: ${receipt.mode}`,
    `Reviewed: ${receipt.stats.reviewed}`,
    `Cache hits: ${receipt.stats.cacheHits}`,
    `Evaluated by provider: ${receipt.stats.providerEvaluated}`,
    `Worth acting on: ${receipt.stats.worthActingOn}`,
    `Shown: ${receipt.stats.shown}`,
    `Outcome: ${receipt.outcome ?? 'AWAITING OUTCOME'}`,
    `Provider/model: ${receipt.provider} / ${receipt.model}`,
    `Provider latency: ${receipt.providerLatencyMs} ms`,
    `Total session latency: ${receipt.totalLatencyMs} ms`,
    `Input usage: ${receipt.inputTokens ?? 'not reported'}`,
    `Output usage: ${receipt.outputTokens ?? 'not reported'}`,
    `Cost status: ${receipt.costStatus}`,
    ...(receipt.costUsd === undefined ? [] : [`Cost: $${receipt.costUsd.toFixed(6)}`]),
    ...(receipt.completedAt ? [`Completed: ${receipt.completedAt}`] : []),
  ];
  return lines.join('\n');
}
