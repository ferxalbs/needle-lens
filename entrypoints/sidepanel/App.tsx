import { useCallback, useEffect, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  ExternalLinkIcon,
  LockKeyholeIcon,
  Settings01Icon,
  WandSparklesIcon,
} from '@hugeicons/core-free-icons';
import type { ExtensionMessage, ExtensionResponse, AnalysisPreview, AnalysisResult, BackgroundState, LiveSessionSnapshot } from '../../src/messaging/protocol';
import { FIELDS_LEAVING_BROWSER } from '../../src/messaging/protocol';
import { formatReceipt } from '../../src/domain/receipt';
import { OUTCOME_LABELS, type DecisionLabel, type Outcome } from '../../src/domain/types';
import { Alert, AlertDescription, AlertTitle } from './components/ui/alert';
import { Badge } from './components/ui/badge';
import { Button, buttonVariants } from './components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './components/ui/empty';
import { ScrollArea } from './components/ui/scroll-area';
import { Separator } from './components/ui/separator';
import { Spinner } from './components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group';
import { X_HOST_ORIGINS } from '../../src/security/x-access';

type UiState =
  | 'checking_access'
  | 'needs_x_access'
  | 'checking_page'
  | 'unsupported_page'
  | 'retryable_error'
  | 'needs_lens'
  | 'needs_key'
  | 'ready'
  | 'extracting'
  | 'empty_candidates'
  | 'awaiting_consent'
  | 'analyzing'
  | 'results'
  | 'no_useful_action'
  | 'awaiting_outcome'
  | 'completed';

type SuccessfulResponse = Extract<ExtensionResponse, { ok: true }>;
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

function isSuccessful<T extends SuccessfulResponse['type']>(response: ExtensionResponse, type: T): response is Extract<SuccessfulResponse, { type: T }> {
  return response.ok && response.type === type;
}

function decisionVariant(label: DecisionLabel): BadgeVariant {
  if (label === 'act') return 'default';
  if (label === 'inspect') return 'secondary';
  if (label === 'pass') return 'destructive';
  return 'outline';
}

function stateLabel(state: UiState): string {
  if (state === 'checking_access') return 'Checking X access…';
  if (state === 'checking_page') return 'Checking current tab…';
  return state.replaceAll('_', ' ');
}

function messageForCode(code: string | undefined): string {
  if (code === 'permission_required') return 'Needle Lens needs permission to read posts visible on x.com.';
  if (code === 'permission_check_failed') return 'Needle Lens could not verify X access. Try again.';
  if (code === 'permission_denied') return 'Access was not granted. Needle Lens cannot inspect posts until you allow x.com.';
  if (code === 'unsupported_page') return 'Open an HTTPS x.com tab, then check the current tab again.';
  if (code === 'tab_url_unavailable' || code === 'active_tab_unavailable') return 'Needle Lens could not verify the current tab.';
  if (code === 'injection_failed') return 'Needle Lens could not read visible posts. Reload X and retry.';
  if (code === 'active_tab_changed' || code === 'stale_session') return 'The active tab or preview changed. Preview the current visible posts again.';
  if (code === 'missing_key') return 'Add a TypeSafe AI key in Settings before analyzing.';
  if (code === 'consent_required') return 'Review the data-use notice before sending post text to TypeSafe.';
  if (code === 'lens_required') return 'Choose a saved Lens in Settings before analyzing.';
  if (code === 'empty_candidates') return 'No eligible posts are currently visible. This is recoverable; try a different X view.';
  return 'Needle Lens could not complete this step. Try again.';
}

function providerError(response: ExtensionResponse): string {
  return response.ok ? 'The extension returned an unexpected response.' : response.error;
}

export default function App() {
  const [uiState, setUiState] = useState<UiState>('checking_access');
  const [state, setState] = useState<BackgroundState>();
  const [preview, setPreview] = useState<AnalysisPreview>();
  const [result, setResult] = useState<AnalysisResult>();
  const [liveSession, setLiveSession] = useState<LiveSessionSnapshot>();
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copyLabel, setCopyLabel] = useState('Copy receipt');
  const permissionInFlight = useRef(false);
  const extractionInFlight = useRef(false);
  const analysisInFlight = useRef(false);

  const send = useCallback(async (message: ExtensionMessage): Promise<ExtensionResponse> => {
    try {
      return (await browser.runtime.sendMessage(message)) as ExtensionResponse;
    } catch {
      return { ok: false, error: 'The extension background worker is unavailable.', code: 'runtime' };
    }
  }, []);

  const applyState = useCallback((value: BackgroundState): void => {
    setState(value);
    if (value.state === 'awaiting_outcome') setUiState('awaiting_outcome');
    else if (value.state === 'complete') setUiState('completed');
    else if (value.state === 'needs_key') setUiState('needs_key');
    else if (value.state === 'needs_lens') setUiState('needs_lens');
    else setUiState((current) => current !== 'extracting' && current !== 'analyzing' ? 'ready' : current);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const response = await send({ type: 'get_state' });
    if (isSuccessful(response, 'state')) applyState(response.value);
    else {
      setError(providerError(response));
      setUiState('retryable_error');
    }
  }, [applyState, send]);

  useEffect(() => {
    void refresh();
    const livePort = browser.runtime.connect({ name: 'needle-live-panel' });
    const handleActivated = (): void => {
      if (extractionInFlight.current || analysisInFlight.current) return;
      setPreview(undefined);
      setResult(undefined);
      setPendingIds([]);
      setLiveSession((current) => current ? { ...current, state: 'complete', pendingCount: 0 } : current);
      setError('');
      setNotice('The active tab changed. Preview the new visible posts when ready.');
      setUiState('ready');
    };
    browser.tabs.onActivated.addListener(handleActivated);
    const handleContentMessage = (value: unknown): void => {
      if (typeof value !== 'object' || value === null) return;
      const message = value as Record<string, unknown>;
      if (message.type === 'needle_candidates_changed' && Array.isArray(message.candidateIds)) {
        const ids = message.candidateIds.filter((id): id is string => typeof id === 'string').slice(0, 30);
        setPendingIds(ids);
        setLiveSession((current) => current && current.state !== 'paused' && current.state !== 'complete'
          ? { ...current, state: ids.length > 0 ? 'new_candidates' : 'observing', pendingCount: ids.length }
          : current);
      }
      if (message.type === 'needle_session_invalidated') {
        setPendingIds([]);
        setLiveSession((current) => current ? { ...current, state: 'complete', pendingCount: 0 } : current);
        setNotice('The X route changed. The live session and its overlays were stopped.');
      }
    };
    browser.runtime.onMessage.addListener(handleContentMessage);
    return () => {
      browser.tabs.onActivated.removeListener(handleActivated);
      browser.runtime.onMessage.removeListener(handleContentMessage);
      livePort.disconnect();
    };
  }, [refresh, send]);

  const openSettings = (): void => {
    void browser.runtime.openOptionsPage();
  };

  const clearMessages = (): void => {
    setError('');
    setNotice('');
  };

  const grantXAccess = async (): Promise<void> => {
    if (permissionInFlight.current) return;
    permissionInFlight.current = true;
    clearMessages();
    setUiState('checking_access');
    try {
      const alreadyGranted = await browser.permissions.contains({ origins: [...X_HOST_ORIGINS] });
      const granted = alreadyGranted || await browser.permissions.request({ origins: [...X_HOST_ORIGINS] });
      if (!granted) {
        setError(messageForCode('permission_denied'));
        setUiState('needs_x_access');
        return;
      }
      setNotice('X access is granted for the exact x.com origins.');
      setUiState('ready');
    } catch {
      setError(messageForCode('permission_check_failed'));
      setUiState('retryable_error');
    } finally {
      permissionInFlight.current = false;
    }
  };

  const prepare = async (): Promise<void> => {
    if (!state?.activeLens || extractionInFlight.current) return;
    extractionInFlight.current = true;
    clearMessages();
    setPreview(undefined);
    setResult(undefined);
    setUiState('checking_page');
    try {
      const page = await send({ type: 'check_page' });
      if (!isSuccessful(page, 'page_checked')) {
        setError(messageForCode(page.ok ? undefined : page.code));
        setUiState(page.ok ? 'retryable_error' : page.code === 'unsupported_page' ? 'unsupported_page' : page.code === 'permission_denied' || page.code === 'permission_required' ? 'needs_x_access' : 'retryable_error');
        return;
      }
      setUiState('extracting');
      const response = await send({ type: 'prepare_analysis', lensId: state.activeLens.id });
      if (!isSuccessful(response, 'preview')) {
        setError(messageForCode(response.ok ? undefined : response.code));
        setUiState('retryable_error');
        return;
      }
      setPreview(response.value);
      if (response.value.candidateState.kind === 'empty') setUiState('empty_candidates');
      else if (response.value.consentRequired) setUiState('awaiting_consent');
      else setUiState('ready');
    } finally {
      extractionInFlight.current = false;
    }
  };

  const confirm = async (): Promise<void> => {
    if (!preview || preview.candidateState.kind !== 'ready' || analysisInFlight.current) return;
    analysisInFlight.current = true;
    clearMessages();
    setUiState('analyzing');
    try {
      if (preview.consentRequired) {
        const consent = await send({ type: 'grant_consent' });
        if (!isSuccessful(consent, 'consent_granted')) {
          setError(providerError(consent));
          setUiState('awaiting_consent');
          return;
        }
      }
      const response = await send({
        type: 'confirm_analysis',
        sessionId: preview.sessionId,
        candidates: preview.candidates,
        tabId: preview.tabId,
        tabUrl: preview.tabUrl,
      });
      if (!isSuccessful(response, 'analysis')) {
        setError(messageForCode(response.ok ? undefined : response.code) || providerError(response));
        setUiState(response.ok ? 'retryable_error' : response.code === 'missing_key' ? 'needs_key' : response.code === 'consent_required' ? 'awaiting_consent' : 'retryable_error');
        return;
      }
      setResult(response.value);
      setState((previous) => previous ? { ...previous, receipt: response.value.receipt, state: 'awaiting_outcome' } : previous);
      setUiState(response.value.noUsefulAction ? 'no_useful_action' : 'awaiting_outcome');
    } finally {
      analysisInFlight.current = false;
    }
  };

  const applyLiveResponse = (response: ExtensionResponse): void => {
    if (isSuccessful(response, 'live_session')) {
      setLiveSession(response.value);
      if (response.value.result) {
        const nextResult = response.value.result;
        setResult(nextResult);
        setState((previous) => previous ? { ...previous, receipt: nextResult.receipt, state: 'awaiting_outcome' } : previous);
      }
      setUiState(response.value.state === 'analyzing' ? 'analyzing' : response.value.result?.noUsefulAction ? 'no_useful_action' : 'results');
    } else {
      setError(messageForCode(response.ok ? undefined : response.code));
      setUiState('retryable_error');
    }
  };

  const startLens = async (): Promise<void> => {
    if (!state?.activeLens || analysisInFlight.current) return;
    analysisInFlight.current = true;
    clearMessages();
    setPendingIds([]);
    setResult(undefined);
    setUiState('analyzing');
    try {
      if (!state.consent) {
        const consent = await send({ type: 'grant_consent' });
        if (!isSuccessful(consent, 'consent_granted')) {
          setError(providerError(consent));
          setUiState('awaiting_consent');
          return;
        }
      }
      applyLiveResponse(await send({ type: 'start_live_session', lensId: state.activeLens.id }));
    } finally {
      analysisInFlight.current = false;
    }
  };

  const analyzeNewPosts = async (): Promise<void> => {
    if (pendingIds.length === 0 || analysisInFlight.current) return;
    analysisInFlight.current = true;
    setUiState('analyzing');
    try {
      applyLiveResponse(await send({ type: 'analyze_new_posts', candidateIds: pendingIds.slice(0, 8) }));
    } finally {
      analysisInFlight.current = false;
    }
  };

  const controlSession = async (type: 'pause_live_session' | 'resume_live_session' | 'finish_live_session'): Promise<void> => {
    const response = await send({ type });
    applyLiveResponse(response);
    if (type === 'finish_live_session') setPendingIds([]);
  };

  const declareOutcome = async (outcome: Outcome): Promise<void> => {
    const response = await send({ type: 'declare_outcome', outcome });
    if (isSuccessful(response, 'outcome')) {
      setState((previous) => previous ? { ...previous, state: 'complete', receipt: response.receipt, ...(response.receiptHistory ? { receiptHistory: response.receiptHistory } : {}) } : previous);
      setUiState('completed');
      setNotice('Outcome recorded locally in the session receipt.');
    } else setError(providerError(response));
  };

  const copyReceipt = async (): Promise<void> => {
    const receipt = result?.receipt ?? state?.receipt;
    if (!receipt) return;
    try {
      await navigator.clipboard.writeText(formatReceipt(receipt));
      setCopyLabel('Copied');
      window.setTimeout(() => setCopyLabel('Copy receipt'), 1600);
    } catch {
      setError('Clipboard access was unavailable. Select the receipt text to copy it.');
    }
  };

  const receipt = result?.receipt ?? state?.receipt;
  const loading = uiState === 'checking_access' || uiState === 'checking_page' || uiState === 'extracting' || uiState === 'analyzing';
  const canAnalyze = Boolean(state?.activeLens && state.credential.configured);

  return (
    <ScrollArea className="h-screen w-full">
      <main className="mx-auto flex min-h-full w-full max-w-xl flex-col gap-4 p-4 text-sm sm:p-5">
        <header className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <HugeiconsIcon icon={WandSparklesIcon} aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Needle Lens</h1>
              <p className="text-xs text-muted-foreground">Decision runtime · local-first BYOK</p>
            </div>
          </div>
          <Button variant="outline" size="sm" type="button" onClick={openSettings}>
            <HugeiconsIcon icon={Settings01Icon} data-icon="inline-start" aria-hidden="true" />
            Settings
          </Button>
        </header>

        <Alert className="border-amber-400/40 bg-amber-400/5">
          <AlertTitle>Experimental X tab adapter</AlertTitle>
          <AlertDescription>
            Needle Lens reads text already rendered in the active X tab and sends the selected text to TypeSafe AI for decision inference. Needle Lens is not affiliated with or endorsed by X. Automated extraction may be restricted by X&apos;s terms. No posting or account action is performed.
          </AlertDescription>
        </Alert>

        {error && <Alert variant="destructive"><HugeiconsIcon icon={AlertCircleIcon} aria-hidden="true" /><AlertTitle>Something needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {notice && <Alert role="status"><HugeiconsIcon icon={CheckmarkCircle02Icon} aria-hidden="true" /><AlertTitle>Session updated</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert>}

        <Card>
          <CardHeader>
            <CardTitle>Current Lens</CardTitle>
            <CardDescription>
              {state?.activeLens ? `${state.activeLens.name} · ${state.activeLens.strictness} · up to ${state.activeLens.maxItems} candidates` : 'Create a saved Lens in Settings.'}
            </CardDescription>
            <CardAction><Badge variant={state?.activeLens ? 'secondary' : 'outline'}>{state?.activeLens ? 'Selected' : 'Required'}</Badge></CardAction>
          </CardHeader>
          <CardContent>
            {state?.activeLens ? <div className="flex flex-col gap-2 text-xs leading-relaxed text-muted-foreground"><p><span className="font-medium text-foreground">Goal:</span> {state.activeLens.goal}</p><p><span className="font-medium text-foreground">Target:</span> {state.activeLens.target.join(' · ')}</p><p><span className="font-medium text-foreground">Evidence:</span> {state.activeLens.evidence.join(' · ')}</p></div> : <Empty><EmptyHeader><EmptyMedia variant="icon"><HugeiconsIcon icon={Settings01Icon} aria-hidden="true" /></EmptyMedia><EmptyTitle>Set up a Lens</EmptyTitle><EmptyDescription>Use Settings to define a goal, evidence, exclusions, decision policy, and desired actions.</EmptyDescription></EmptyHeader></Empty>}
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-2">
            {!liveSession || liveSession.state === 'complete' ? <Button type="button" onClick={() => void startLens()} disabled={!canAnalyze || loading}>{loading && <Spinner data-icon="inline-start" />}Start Lens</Button> : <div className="flex flex-wrap gap-2"><Button variant="outline" type="button" onClick={() => void controlSession(liveSession.state === 'paused' ? 'resume_live_session' : 'pause_live_session')} disabled={loading}>{liveSession.state === 'paused' ? 'Resume' : 'Pause'}</Button><Button variant="destructive" type="button" onClick={() => void controlSession('finish_live_session')} disabled={loading}>Finish session</Button></div>}
            {!state?.credential.configured && <Button variant="outline" type="button" onClick={openSettings}>Add a TypeSafe key in Settings</Button>}
          </CardFooter>
        </Card>

        {liveSession && liveSession.state !== 'complete' && <Card><CardHeader><CardTitle>Live session</CardTitle><CardDescription>{liveSession.reviewed} reviewed · {liveSession.surfaced} surfaced · up to {liveSession.lens.maxItems} total</CardDescription><CardAction><Badge variant="outline" className="capitalize">{liveSession.state.replaceAll('_', ' ')}</Badge></CardAction></CardHeader><CardContent><p className="text-sm font-medium">{pendingIds.length} new post{pendingIds.length === 1 ? '' : 's'} available</p><p className="mt-1 text-xs text-muted-foreground">Only canonical post IDs are held until you explicitly analyze this batch.</p></CardContent><CardFooter><Button type="button" onClick={() => void analyzeNewPosts()} disabled={pendingIds.length === 0 || loading}>Analyze new posts</Button></CardFooter></Card>}

        {!state?.activeLens && <Button type="button" onClick={openSettings}>Open Settings to create a Lens</Button>}
        {uiState === 'needs_x_access' && <Card><CardHeader><CardTitle>Grant exact X access</CardTitle><CardDescription>Only these origins are requested: {X_HOST_ORIGINS.join(' and ')}. Needle cannot post or control the account.</CardDescription></CardHeader><CardFooter><Button type="button" onClick={() => void grantXAccess()} disabled={loading}>Grant access to X</Button></CardFooter></Card>}

        {preview && (uiState === 'awaiting_consent' || uiState === 'ready' || uiState === 'empty_candidates' || uiState === 'analyzing') && <Card>
          <CardHeader><CardTitle>{preview.candidateState.kind === 'empty' ? 'No eligible posts found' : `${preview.candidateCount} eligible post${preview.candidateCount === 1 ? '' : 's'} ready`}</CardTitle><CardDescription>{preview.candidateState.kind === 'empty' ? 'This is a recoverable empty state. No provider request was made.' : 'Nothing has left this browser yet. Review the categories below before the first provider call.'}</CardDescription><CardAction><Badge variant="secondary">One request</Badge></CardAction></CardHeader>
          <CardContent className="flex flex-col gap-3">
            {preview.candidateState.kind === 'ready' && <><div className="flex flex-wrap gap-1.5">{FIELDS_LEAVING_BROWSER.map((field) => <Badge variant="outline" key={field}>{field}</Badge>)}</div><p className="text-xs leading-relaxed text-muted-foreground">Destination: {preview.provider} · model: {preview.model} · cached: {preview.cacheHits} · new evaluations: {preview.providerEvaluated}</p><p className="text-xs leading-relaxed text-muted-foreground">The provider receives visible post text only after you choose Accept and send. TypeSafe retention terms are not controlled by Needle Lens.</p></>}
          </CardContent>
          {preview.candidateState.kind === 'ready' && <CardFooter className="flex-wrap gap-2"><Button type="button" onClick={() => void confirm()} disabled={uiState === 'analyzing'}><HugeiconsIcon icon={LockKeyholeIcon} data-icon="inline-start" aria-hidden="true" />{preview.consentRequired ? 'Accept and send one request' : 'Send one decision request'}</Button><Button variant="outline" type="button" onClick={() => setPreview(undefined)}>Cancel</Button></CardFooter>}
        </Card>}
        {preview?.candidateState.kind === 'ready' && (uiState === 'awaiting_consent' || uiState === 'ready') && <p className="px-1 text-xs leading-relaxed text-muted-foreground">Visible post text may contain personal information. TypeSafe retention terms were not verified by Needle Lens. Review TypeSafe’s current <a className="underline" href="https://typesafe.ai/legal/privacy-policy" target="_blank" rel="noreferrer">privacy policy</a> before continuing. Accept or cancel below.</p>}
        {preview?.candidateState.kind === 'ready' && (uiState === 'awaiting_consent' || uiState === 'ready') && <details className="rounded-xl border bg-muted/20 px-3 py-2 text-xs"><summary className="cursor-pointer font-medium">Show the {preview.candidateCount} selected post{preview.candidateCount === 1 ? '' : 's'}</summary><ul className="mt-2 flex list-disc flex-col gap-2 pl-4">{preview.candidates.map((candidate) => <li key={candidate.id}>{candidate.text}</li>)}</ul></details>}

        {result && <Card><CardHeader><CardTitle>{result.noUsefulAction ? 'No useful action found' : `${result.cards.length} surfaced result${result.cards.length === 1 ? '' : 's'}`}</CardTitle><CardDescription>Needle composes these labels deterministically from the selected Lens, Jev probabilities, and confidence. Zero actions is valid.</CardDescription><CardAction><Badge variant="secondary">Max {result.receipt.stats.shown}</Badge></CardAction></CardHeader><CardContent className="flex flex-col gap-3">{result.cards.length > 0 ? result.cards.map(({ candidate, decision }) => <Card size="sm" key={candidate.id}><CardHeader className="gap-1.5"><div className="flex items-center gap-2"><Badge variant={decisionVariant(decision.label)}>{decision.label.toUpperCase()}</Badge>{candidate.author && <span className="min-w-0 truncate text-xs text-muted-foreground">{candidate.author}</span>}</div><CardDescription>{decision.reason}</CardDescription></CardHeader><CardContent className="flex flex-col gap-2"><p className="text-sm leading-relaxed">{candidate.text}</p><div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground"><Badge variant="outline">probability {Math.round(decision.probability * 100)}%</Badge><Badge variant="outline">confidence {Math.round(decision.confidence * 100)}%</Badge><Badge variant="outline">{decision.boundary}</Badge></div><details><summary className="cursor-pointer text-xs font-medium text-muted-foreground">Typed evidence</summary><div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground"><span>Relationship: {decision.signals.relationship.choice}</span><span>Goal: {Math.round(decision.signals.matchesGoal.value * 100)}%</span><span>Evidence: {Math.round(decision.signals.evidenceStrength.value * 100)}%</span><span>Actionability: {Math.round(decision.signals.actionability.value * 100)}%</span><span>Target: {Math.round(decision.signals.targetMatch.value * 100)}%</span><span>Need: {Math.round(decision.signals.hasConcreteNeed.value * 100)}%</span></div></details></CardContent>{candidate.canonicalUrl && <CardFooter className="justify-end pt-0"><a className={buttonVariants({ variant: 'link', size: 'sm' })} href={candidate.canonicalUrl} target="_blank" rel="noreferrer">Open on X <HugeiconsIcon icon={ExternalLinkIcon} data-icon="inline-end" aria-hidden="true" /></a></CardFooter>}</Card>) : <Empty><EmptyHeader><EmptyMedia variant="icon"><HugeiconsIcon icon={WandSparklesIcon} aria-hidden="true" /></EmptyMedia><EmptyTitle>No useful action found</EmptyTitle><EmptyDescription>Needle did not manufacture one. Refine the Lens or review a different visible X set.</EmptyDescription></EmptyHeader></Empty>}</CardContent></Card>}

        {receipt && <Card><CardHeader><CardTitle>{receipt.phase === 'complete' || liveSession?.state === 'complete' ? 'Session complete' : 'Record what happened'}</CardTitle><CardDescription>Outcome is local bookkeeping and is separate from the decision evidence.</CardDescription></CardHeader><CardContent className="flex flex-col gap-3">{receipt.phase === 'awaiting_outcome' && <ToggleGroup aria-label="Session outcome" variant="outline" spacing={1} value={[]} onValueChange={(values) => { const outcome = values[0] as Outcome | undefined; if (outcome) void declareOutcome(outcome); }} className="grid w-full grid-cols-2">{(Object.keys(OUTCOME_LABELS) as Outcome[]).map((outcome) => <ToggleGroupItem value={outcome} key={outcome}>{OUTCOME_LABELS[outcome]}</ToggleGroupItem>)}</ToggleGroup>}<Separator /><ScrollArea className="max-h-64 rounded-xl border bg-muted/20"><pre className="whitespace-pre-wrap p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">{formatReceipt(receipt)}</pre></ScrollArea></CardContent><CardFooter className="justify-end"><Button variant="outline" type="button" onClick={() => void copyReceipt()}>{copyLabel}</Button></CardFooter></Card>}

        <footer className="flex items-center justify-between gap-3 px-1 py-1 text-xs text-muted-foreground"><span>Local-first · no posting or account action</span><Badge variant="outline" className="capitalize">{stateLabel(uiState)}</Badge></footer>
      </main>
    </ScrollArea>
  );
}
