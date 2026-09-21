import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@base-ui/react/button';
import { Select } from '@base-ui/react/select';
import type { ExtensionMessage, ExtensionResponse } from '../../src/messaging/protocol';
import {
  FIELDS_LEAVING_BROWSER,
  type AnalysisPreview,
  type AnalysisResult,
  type BackgroundState,
} from '../../src/messaging/protocol';
import {
  MODE_LABELS,
  OUTCOME_LABELS,
  type Mode,
  type Outcome,
  type SessionReceipt,
} from '../../src/domain/types';
import { formatReceipt } from '../../src/domain/receipt';

type UiState =
  | 'loading'
  | 'needs_key'
  | 'ready'
  | 'extracting'
  | 'insufficient_candidates'
  | 'awaiting_consent'
  | 'evaluating'
  | 'results'
  | 'no_useful_action'
  | 'awaiting_outcome'
  | 'complete'
  | 'error';
type SuccessfulResponse = Extract<ExtensionResponse, { ok: true }>;

const DEFAULT_GOAL = 'Find people who can help with a concrete problem or opportunity.';

function isSuccessful<T extends SuccessfulResponse['type']>(
  response: ExtensionResponse,
  type: T,
): response is Extract<SuccessfulResponse, { type: T }> {
  return response.ok && response.type === type;
}

function responseError(response: ExtensionResponse): string {
  return response.ok ? 'The extension returned an unexpected response.' : response.error;
}

function responseCode(response: ExtensionResponse): string | undefined {
  return response.ok ? undefined : response.code;
}

export default function App() {
  const [uiState, setUiState] = useState<UiState>('loading');
  const [apiKey, setApiKey] = useState('');
  const [fingerprint, setFingerprint] = useState<string>();
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [mode, setMode] = useState<Mode>('find_people');
  const [preview, setPreview] = useState<AnalysisPreview>();
  const [result, setResult] = useState<AnalysisResult>();
  const [receipt, setReceipt] = useState<SessionReceipt>();
  const [receiptHistory, setReceiptHistory] = useState<SessionReceipt[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copyLabel, setCopyLabel] = useState('Copy receipt');

  const send = async (message: ExtensionMessage): Promise<ExtensionResponse> => {
    try {
      return await browser.runtime.sendMessage(message) as ExtensionResponse;
    } catch {
      return { ok: false, error: 'The extension background worker is unavailable.', code: 'runtime' };
    }
  };

  const applyState = (value: BackgroundState): void => {
    setFingerprint(value.keyFingerprint);
    setReceipt(value.receipt);
    setReceiptHistory(value.receiptHistory ?? []);
    if (value.state === 'needs_key') setUiState('needs_key');
    else if (value.state === 'awaiting_outcome') setUiState('awaiting_outcome');
    else if (value.state === 'complete') setUiState('complete');
    else setUiState('ready');
  };

  const refresh = async (): Promise<void> => {
    const response = await send({ type: 'get_state' });
    if (isSuccessful(response, 'state')) {
      applyState(response.value);
      return;
    }
    setError(responseError(response));
    setUiState('error');
  };

  useEffect(() => {
    void refresh();
  }, []);

  const canAnalyze = useMemo(
    () => goal.trim().length > 0 && (uiState === 'ready' || uiState === 'results' || uiState === 'no_useful_action'),
    [goal, uiState],
  );

  const saveKey = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError('');
    setNotice('');
    const value = apiKey.trim();
    if (value.length < 8 || /[\r\n]/.test(value)) {
      setError('Enter a valid TypeSafe AI API key without spaces or line breaks.');
      return;
    }
    const response = await send({ type: 'save_key', apiKey: value });
    setApiKey('');
    if (isSuccessful(response, 'key_saved')) {
      setFingerprint(response.fingerprint);
      setReceipt(undefined);
      setPreview(undefined);
      setResult(undefined);
      setUiState('ready');
      setNotice('Key saved for this browser session only.');
    } else {
      setError(responseError(response));
      setUiState('error');
    }
  };

  const prepare = async (): Promise<void> => {
    setError('');
    setNotice('');
    setPreview(undefined);
    setResult(undefined);
    setUiState('extracting');
    const response = await send({ type: 'prepare_analysis', goal, mode });
    if (isSuccessful(response, 'preview')) {
      setPreview(response.value);
      if (response.value.candidates.length < 8) {
        setError(`Only ${response.value.candidates.length} eligible posts are visible. Scroll X until at least 8 are in view, then preview again.`);
        setUiState('insufficient_candidates');
      } else {
        setUiState('awaiting_consent');
      }
      return;
    }
    setError(responseError(response));
    setUiState(responseCode(response) === 'missing_key' ? 'needs_key' : 'error');
  };

  const confirm = async (): Promise<void> => {
    if (!preview || preview.candidates.length < 8) return;
    setError('');
    setNotice('');
    setUiState('evaluating');
    const response = await send({
      type: 'confirm_analysis',
      goal,
      mode,
      candidates: preview.candidates,
    });
    if (isSuccessful(response, 'analysis')) {
      setResult(response.value);
      setReceipt(response.value.receipt);
      setUiState(response.value.noUsefulAction ? 'no_useful_action' : 'awaiting_outcome');
      return;
    }
    setError(responseError(response));
    setUiState(responseCode(response) === 'missing_key' ? 'needs_key' : 'error');
  };

  const forgetKey = async (): Promise<void> => {
    const response = await send({ type: 'forget_key' });
    if (isSuccessful(response, 'key_forgotten')) {
      setFingerprint(undefined);
      setReceipt(undefined);
      setPreview(undefined);
      setResult(undefined);
      setUiState('needs_key');
      setNotice('The API key was removed from the session.');
    } else setError(responseError(response));
  };

  const clearSession = async (): Promise<void> => {
    const response = await send({ type: 'clear_session' });
    if (isSuccessful(response, 'session_cleared')) {
      setApiKey('');
      setFingerprint(undefined);
      setPreview(undefined);
      setResult(undefined);
      setReceipt(undefined);
      setReceiptHistory([]);
      setNotice('Session cache and receipt history cleared.');
      setUiState('needs_key');
    } else setError(responseError(response));
  };

  const declareOutcome = async (outcome: Outcome): Promise<void> => {
    const response = await send({ type: 'declare_outcome', outcome });
    if (isSuccessful(response, 'outcome')) {
      setReceipt(response.receipt);
      setReceiptHistory(response.receiptHistory ?? []);
      setUiState('complete');
      setNotice('Outcome recorded in the session receipt.');
    } else setError(responseError(response));
  };

  const copyReceipt = async (): Promise<void> => {
    if (!receipt) return;
    try {
      await navigator.clipboard.writeText(formatReceipt(receipt));
      setCopyLabel('Copied');
      window.setTimeout(() => setCopyLabel('Copy receipt'), 1600);
    } catch {
      setError('Clipboard access was unavailable. Select the receipt text to copy it.');
    }
  };

  const olderReceipts = receipt?.phase === 'complete'
    ? receiptHistory.slice(0, -1)
    : receiptHistory;

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">PRIVATE BYOK WORKBENCH</p>
          <h1>Needle Lens</h1>
          <p className="lede">Turn the posts already visible in front of you into a finished session.</p>
        </div>
        <span className="status-dot" aria-label="Extension ready" />
      </header>

      {error && <div className="callout error" role="alert">{error}</div>}
      {notice && <div className="callout notice" role="status">{notice}</div>}

      <section className="panel key-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">01 / YOUR KEY</p>
            <h2>Bring your own TypeSafe key</h2>
          </div>
          {fingerprint && <span className="badge">session · {fingerprint}</span>}
        </div>
        <p className="muted">Stored in memory-only extension storage. It never enters the page, cache, receipt, or content script.</p>
        <form className="key-form" onSubmit={saveKey}>
          <label className="sr-only" htmlFor="api-key">TypeSafe AI API key</label>
          <input
            id="api-key"
            type="password"
            value={apiKey}
            onInput={(event) => setApiKey((event.currentTarget as HTMLInputElement).value)}
            placeholder="ts_…"
            autoComplete="off"
            spellCheck={false}
          />
          <Button className="button primary" type="submit">Save key</Button>
        </form>
        <div className="button-row compact">
          <Button className="button quiet" type="button" onClick={forgetKey} disabled={!fingerprint}>Forget key</Button>
          <Button className="button quiet danger" type="button" onClick={clearSession}>Clear session</Button>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">02 / SHAPE THE LENS</p>
            <h2>What should stand out?</h2>
          </div>
          <span className="step-number">8–30</span>
        </div>
        <label htmlFor="goal">Goal</label>
        <textarea id="goal" rows={3} value={goal} onInput={(event) => setGoal((event.currentTarget as HTMLTextAreaElement).value)} />
        <Select.Root<Mode>
          value={mode}
          items={(Object.keys(MODE_LABELS) as Mode[]).map((key) => ({ value: key, label: MODE_LABELS[key] }))}
          onValueChange={(value) => { if (value) setMode(value); }}
        >
          <Select.Label className="select-label">Mode</Select.Label>
          <Select.Trigger className="select-trigger" aria-label="Mode">
            <Select.Value />
            <Select.Icon className="select-icon" aria-hidden="true">⌄</Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner className="select-positioner" sideOffset={4}>
              <Select.Popup className="select-popup">
                <Select.List>
                  {(Object.keys(MODE_LABELS) as Mode[]).map((key) => (
                    <Select.Item className="select-item" value={key} key={key}>
                      <Select.ItemText>{MODE_LABELS[key]}</Select.ItemText>
                      <Select.ItemIndicator>✓</Select.ItemIndicator>
                    </Select.Item>
                  ))}
                </Select.List>
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
        <Button className="button primary wide" type="button" onClick={prepare} disabled={!canAnalyze || uiState === 'extracting' || uiState === 'evaluating'}>
          {uiState === 'extracting' ? 'Reading visible posts…' : uiState === 'evaluating' ? 'Evaluating visible posts…' : 'Preview visible posts'}
        </Button>
        <p className="microcopy">Needle Lens reads only the X posts currently visible or just beyond the viewport. It does not scroll, click, post, follow, or message.</p>
      </section>

      {preview && (uiState === 'awaiting_consent' || uiState === 'insufficient_candidates') && (
        <section className="panel consent-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">03 / CONFIRM THE HANDOFF</p>
              <h2>{preview.candidates.length} posts are ready</h2>
            </div>
            <span className="badge warm">one request</span>
          </div>
          <p className="muted">Nothing has left this browser yet. If you continue, the fields below go directly to {preview.provider}.</p>
          <div className="field-list">
            {FIELDS_LEAVING_BROWSER.map((field) => <span className="field-chip" key={field}>{field}</span>)}
          </div>
          <p className="microcopy">Provider: {preview.provider} · model: {preview.model} · cache hits: {preview.cacheHits} · new evaluations: {preview.providerEvaluated}</p>
          <div className="button-row">
            <Button className="button primary" type="button" onClick={confirm} disabled={preview.candidates.length < 8}>Send one decision request</Button>
            <Button className="button quiet" type="button" onClick={() => setPreview(undefined)}>Cancel</Button>
          </div>
        </section>
      )}

      {result && (uiState === 'results' || uiState === 'no_useful_action' || uiState === 'awaiting_outcome' || uiState === 'complete') && (
        <section className="panel results-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">04 / YOUR SHORTLIST</p>
              <h2>{result.noUsefulAction ? 'No safe action surfaced' : `${result.cards.length} useful lead${result.cards.length === 1 ? '' : 's'}`}</h2>
            </div>
            <span className="badge">max 3 shown</span>
          </div>
          {result.cards.length > 0 ? <div className="card-stack">
            {result.cards.map(({ candidate, decision }) => (
              <article className={`result-card ${decision.label}`} key={candidate.id}>
                <div className="result-card-top">
                  <span className={`decision-badge ${decision.label}`}>{decision.label.toUpperCase()}</span>
                  {candidate.author && <span className="author">{candidate.author}</span>}
                </div>
                <p>{candidate.text}</p>
                <p className="reason">{decision.reason}</p>
                {candidate.canonicalUrl && <a href={candidate.canonicalUrl} target="_blank" rel="noreferrer">Open on X ↗</a>}
              </article>
            ))}
          </div> : <p className="muted">No useful action found. Needle did not manufacture one.</p>}
        </section>
      )}

      {receipt && (uiState === 'results' || uiState === 'no_useful_action' || uiState === 'awaiting_outcome' || uiState === 'complete' || receipt.phase === 'complete') && (
        <section className="panel receipt-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">05 / CLOSE THE LOOP</p>
              <h2>{receipt.phase === 'complete' ? 'Session complete' : 'Record what happened'}</h2>
            </div>
            <span className="badge">{receipt.totalLatencyMs} ms</span>
          </div>
          {receipt.phase === 'awaiting_outcome' && <>
            <p className="muted">Choose the closest honest outcome. This is local session bookkeeping, not an automated action.</p>
            <div className="outcome-grid">
              {(Object.keys(OUTCOME_LABELS) as Outcome[]).map((outcome) => <Button className="button quiet" type="button" key={outcome} onClick={() => declareOutcome(outcome)}>{OUTCOME_LABELS[outcome]}</Button>)}
            </div>
          </>}
          <pre className="receipt">{formatReceipt(receipt)}</pre>
          <Button className="button quiet" type="button" onClick={copyReceipt}>{copyLabel}</Button>
          {olderReceipts.length > 0 && <details className="history">
            <summary>Earlier session receipts ({olderReceipts.length})</summary>
            <div className="history-list">
              {olderReceipts.slice().reverse().map((historyReceipt) => (
                <pre className="receipt history-receipt" key={`${historyReceipt.completedAt ?? historyReceipt.totalLatencyMs}-${historyReceipt.goal}`}>{formatReceipt(historyReceipt)}</pre>
              ))}
            </div>
          </details>}
        </section>
      )}

      <footer>
        <span>Local-first · one consented provider request</span>
        <span>{uiState === 'loading' ? 'Warming up…' : uiState.replaceAll('_', ' ')}</span>
      </footer>
    </main>
  );
}
