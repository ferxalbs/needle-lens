import { describe, expect, it } from 'vitest';
import { appendReceiptHistory, completeReceipt, createReceipt, formatReceipt, MAX_RECEIPT_HISTORY } from '../src/domain/receipt';
import { parseMessage } from '../src/messaging/protocol';
import { redactRecord, redactString, redactUnknown } from '../src/security/redact';
import { isEligibleXUrl } from '../src/security/x-url';
import { getActiveXTab } from '../src/security/active-x-tab';
import { X_HOST_ORIGINS, ensureXAccess } from '../src/security/x-access';

const candidates = Array.from({ length: 8 }, (_, index) => ({
  id: `status_${index}`,
  source: 'x-visible-dom' as const,
  text: `visible post ${index}`,
  viewportState: 'visible' as const,
  viewportIndex: index,
}));

describe('message protocol and receipts', () => {
  it('accepts a bounded consent message and rejects malformed candidates', () => {
    const valid = parseMessage({ type: 'confirm_analysis', goal: 'find leads', mode: 'find_people', candidates, tabId: 7, tabUrl: 'https://x.com/home' });
    expect(valid?.type).toBe('confirm_analysis');
    expect(parseMessage({ type: 'confirm_analysis', goal: 'find leads', mode: 'find_people', candidates: candidates.slice(0, 7) })).toBeUndefined();
    expect(parseMessage({ type: 'confirm_analysis', goal: 'find leads', mode: 'find_people', candidates: [candidates[0]!, ...candidates.slice(0, 7)] })).toBeUndefined();
    expect(parseMessage({ type: 'save_key', apiKey: 'short' })).toBeUndefined();
    const withSecret = parseMessage({
      type: 'confirm_analysis',
      goal: 'find leads',
      mode: 'find_people',
      candidates,
      tabId: 7,
      tabUrl: 'https://x.com/home',
      apiKey: 'ts_secret_never_forwarded',
    });
    expect(JSON.stringify(withSecret)).not.toContain('ts_secret_never_forwarded');
  });

  it('moves the receipt from awaiting outcome to complete', () => {
    const receipt = createReceipt({
      goal: 'find leads',
      mode: 'find_people',
      stats: { reviewed: 8, cacheHits: 0, providerEvaluated: 8, worthActingOn: 1, shown: 1 },
      providerEvaluation: undefined,
      totalLatencyMs: 42,
    });
    const complete = completeReceipt(receipt, 'contacted');
    expect(receipt.phase).toBe('awaiting_outcome');
    expect(complete.phase).toBe('complete');
    expect(complete.outcome).toBe('contacted');
    expect(formatReceipt(complete)).toContain('Outcome: contacted');
  });

  it('redacts credentials from errors and records', () => {
    const secret = 'ts_secret_123';
    expect(redactString(`Authorization: Bearer ${secret}`, secret)).toBe('Authorization=[redacted]');
    expect(redactUnknown(new Error(`apiKey=${secret}`), secret)).toBe('apiKey=[redacted]');
    expect(redactRecord({ Authorization: `Bearer ${secret}`, message: `failed for ${secret}` }, secret))
      .toEqual({ Authorization: '[redacted]', message: 'failed for [redacted]' });
  });

  it('fails closed for non-X and non-HTTPS tabs', () => {
    expect(isEligibleXUrl('https://x.com/home')).toBe(true);
    expect(isEligibleXUrl('https://www.x.com/i/status/123')).toBe(true);
    expect(isEligibleXUrl('http://x.com/home')).toBe(false);
    expect(isEligibleXUrl('https://example.com')).toBe(false);
    expect(isEligibleXUrl(undefined)).toBe(false);
    expect(isEligibleXUrl('https://x.com.evil.example/')).toBe(false);
    expect(isEligibleXUrl('https://mobile.x.com/home')).toBe(false);
    expect(isEligibleXUrl('chrome://extensions')).toBe(false);
  });

  it('checks exact optional X permissions without prompting when already granted', async () => {
    const calls: string[] = [];
    const permissions = {
      contains: async ({ origins }: { origins: string[] }) => {
        calls.push(`contains:${origins.join(',')}`);
        return true;
      },
      request: async () => {
        calls.push('request');
        return true;
      },
    };
    await expect(ensureXAccess(permissions)).resolves.toEqual({ ok: true, requested: false });
    expect(calls).toEqual([`contains:${X_HOST_ORIGINS.join(',')}`]);
  });

  it('keeps denied and failed permission requests retryable', async () => {
    const denied = {
      contains: async () => false,
      request: async () => false,
    };
    await expect(ensureXAccess(denied)).resolves.toEqual({ ok: false, code: 'permission_denied' });
    const failed = {
      contains: async () => { throw new Error('permission api'); },
      request: async () => true,
    };
    await expect(ensureXAccess(failed)).resolves.toEqual({ ok: false, code: 'permission_check_failed' });
  });

  it('returns typed active-tab failures and accepts only exact HTTPS X hosts', async () => {
    const permissions = { contains: async () => true };
    const tabs = (url: string | undefined, id: number | undefined) => ({
      query: async () => [{ id, url }] as Browser.tabs.Tab[],
    });
    await expect(getActiveXTab(tabs('https://x.com/home', 11), permissions)).resolves.toMatchObject({ ok: true, value: { id: 11, url: 'https://x.com/home' } });
    await expect(getActiveXTab(tabs('http://x.com/home', 11), permissions)).resolves.toEqual({ ok: false, code: 'unsupported_page' });
    await expect(getActiveXTab(tabs('https://x.com.evil.example/', 11), permissions)).resolves.toEqual({ ok: false, code: 'unsupported_page' });
    await expect(getActiveXTab(tabs(undefined, 11), permissions)).resolves.toEqual({ ok: false, code: 'tab_url_unavailable' });
    await expect(getActiveXTab(tabs('chrome://extensions', 11), permissions)).resolves.toEqual({ ok: false, code: 'unsupported_page' });
    await expect(getActiveXTab(tabs('https://x.com/home', undefined), permissions)).resolves.toEqual({ ok: false, code: 'active_tab_unavailable' });
  });

  it('keeps only the bounded current-session receipt history', () => {
    const receipt = createReceipt({
      goal: 'find leads',
      mode: 'find_people',
      stats: { reviewed: 8, cacheHits: 0, providerEvaluated: 8, worthActingOn: 1, shown: 1 },
      providerEvaluation: undefined,
      totalLatencyMs: 42,
    });
    const history = appendReceiptHistory(
      Array.from({ length: MAX_RECEIPT_HISTORY + 2 }, () => receipt),
      receipt,
    );
    expect(history).toHaveLength(MAX_RECEIPT_HISTORY);
    expect(history.at(-1)).toBe(receipt);
  });
});
