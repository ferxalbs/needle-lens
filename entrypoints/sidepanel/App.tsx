import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  ExternalLinkIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  WandSparklesIcon,
} from '@hugeicons/core-free-icons';
import type { ExtensionMessage, ExtensionResponse } from '../../src/messaging/protocol';
import {
  FIELDS_LEAVING_BROWSER,
  type AnalysisPreview,
  type AnalysisResult,
  type BackgroundState,
} from '../../src/messaging/protocol';
import {
  MODE_LABELS,
  MIN_ITEMS,
  OUTCOME_LABELS,
  type DecisionLabel,
  type Mode,
  type Outcome,
  type SessionReceipt,
} from '../../src/domain/types';
import { formatReceipt } from '../../src/domain/receipt';
import { Alert, AlertDescription, AlertTitle } from './components/ui/alert';
import { Badge } from './components/ui/badge';
import { Button, buttonVariants } from './components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from './components/ui/empty';
import { Field, FieldDescription, FieldGroup, FieldLabel } from './components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from './components/ui/input-group';
import { ScrollArea } from './components/ui/scroll-area';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { Separator } from './components/ui/separator';
import { Spinner } from './components/ui/spinner';
import { Textarea } from './components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group';
import { X_HOST_ORIGINS } from '../../src/security/x-access';

type UiState =
  | 'checking_access'
  | 'needs_x_access'
  | 'checking_page'
  | 'unsupported_page'
  | 'retryable_error'
  | 'needs_key'
  | 'ready'
  | 'extracting'
  | 'insufficient_candidates'
  | 'awaiting_consent'
  | 'analyzing'
  | 'results'
  | 'no_useful_action'
  | 'awaiting_outcome'
  | 'completed';
type SuccessfulResponse = Extract<ExtensionResponse, { ok: true }>;
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

const DEFAULT_GOAL = 'Find people who can help with a concrete problem or opportunity.';
const MODE_ITEMS = (Object.keys(MODE_LABELS) as Mode[]).map((value) => ({
  value,
  label: MODE_LABELS[value],
}));

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

function decisionVariant(label: DecisionLabel): BadgeVariant {
  if (label === 'act') return 'default';
  if (label === 'pass') return 'destructive';
  if (label === 'inspect') return 'secondary';
  return 'outline';
}

function stateLabel(state: UiState): string {
  if (state === 'checking_access') return 'Checking X access…';
  if (state === 'checking_page') return 'Checking current tab…';
  return state.replaceAll('_', ' ');
}

export default function App() {
  const [uiState, setUiState] = useState<UiState>('checking_access');
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
  const [accessReady, setAccessReady] = useState(false);
  const keyAvailable = useRef(false);
  const permissionInFlight = useRef(false);
  const extractionInFlight = useRef(false);
  const analysisInFlight = useRef(false);
  const refreshRef = useRef<(() => Promise<void>) | undefined>(undefined);

  const send = async (message: ExtensionMessage): Promise<ExtensionResponse> => {
    try {
      return (await browser.runtime.sendMessage(message)) as ExtensionResponse;
    } catch {
      return { ok: false, error: 'The extension background worker is unavailable.', code: 'runtime' };
    }
  };

  const applyState = (value: BackgroundState): void => {
    keyAvailable.current = Boolean(value.keyFingerprint);
    setFingerprint(value.keyFingerprint);
    setReceipt(value.receipt);
    setReceiptHistory(value.receiptHistory ?? []);
    if (value.state === 'awaiting_outcome') setUiState('awaiting_outcome');
    else if (value.state === 'complete') setUiState('completed');
  };

  const clearRecoverableError = (): void => {
    setError('');
    setNotice('');
  };

  const messageForCode = (code: string | undefined): string => {
    if (code === 'permission_required') return 'Needle Lens needs permission to read the posts visible on x.com.';
    if (code === 'permission_check_failed') return 'Needle Lens could not verify permission. Try again.';
    if (code === 'permission_denied') return 'Access was not granted. Needle Lens cannot inspect posts until you allow access to x.com.';
    if (code === 'unsupported_page') return 'Open an x.com tab, then check the current tab again.';
    if (code === 'tab_url_unavailable' || code === 'active_tab_unavailable') return 'Needle Lens could not verify the current tab. Check the extension permission and try again.';
    if (code === 'injection_failed') return 'Needle Lens could not read visible posts on this page. Reload X and retry.';
    if (code === 'active_tab_changed') return 'The active tab changed. Check the current tab and preview the visible posts again.';
    return 'Needle Lens could not complete this step. Try again.';
  };

  const applyPreview = (value: AnalysisPreview): void => {
    setPreview(value);
    setResult(undefined);
    if (value.candidateCount < MIN_ITEMS) {
      setError(`Only ${value.candidateCount} eligible posts are visible. Scroll X until at least ${MIN_ITEMS} are in view, then preview again.`);
      setUiState('insufficient_candidates');
    } else if (keyAvailable.current) {
      setUiState('awaiting_consent');
    } else {
      setUiState('needs_key');
    }
  };

  const checkAndExtract = async (): Promise<void> => {
    if (extractionInFlight.current) return;
    extractionInFlight.current = true;
    clearRecoverableError();
    setPreview(undefined);
    setResult(undefined);
    setUiState('checking_page');
    try {
      const page = await send({ type: 'check_page' });
      if (!isSuccessful(page, 'page_checked')) {
        setAccessReady(false);
        const code = responseCode(page);
        setError(messageForCode(code));
        setUiState(
          code === 'permission_required' || code === 'permission_denied'
            ? 'needs_x_access'
            : code === 'unsupported_page'
              ? 'unsupported_page'
              : 'retryable_error',
        );
        return;
      }
      setAccessReady(true);
      setUiState('extracting');
      const response = await send({ type: 'prepare_analysis', goal, mode });
      if (isSuccessful(response, 'preview')) {
        applyPreview(response.value);
        return;
      }
      setError(messageForCode(responseCode(response)));
      setUiState('retryable_error');
    } finally {
      extractionInFlight.current = false;
    }
  };

  const refresh = async (): Promise<void> => {
    const response = await send({ type: 'get_state' });
    if (!isSuccessful(response, 'state')) {
      setError(responseError(response));
      setUiState('retryable_error');
      return;
    }
    applyState(response.value);
    await checkAndExtract();
  };

  refreshRef.current = refresh;

  useEffect(() => {
    void refreshRef.current?.();
  }, []);

  useEffect(() => {
    const handleActivated = (): void => {
      if (extractionInFlight.current || analysisInFlight.current) return;
      setPreview(undefined);
      setResult(undefined);
      setError('');
      setNotice('');
      setAccessReady(false);
      setUiState('retryable_error');
    };
    browser.tabs.onActivated.addListener(handleActivated);
    return () => browser.tabs.onActivated.removeListener(handleActivated);
  }, []);

  const canPreview = useMemo(
    () => accessReady && uiState !== 'checking_page' && uiState !== 'extracting' && uiState !== 'analyzing',
    [accessReady, uiState],
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
      keyAvailable.current = true;
      setFingerprint(response.fingerprint);
      setUiState(preview && preview.candidateCount >= MIN_ITEMS ? 'awaiting_consent' : 'needs_key');
      setNotice('Key saved for this browser session only.');
    } else {
      setError(responseError(response));
      setUiState('retryable_error');
    }
  };

  const prepare = async (): Promise<void> => {
    await checkAndExtract();
  };

  const confirm = async (): Promise<void> => {
    if (!preview || preview.candidateCount < MIN_ITEMS || analysisInFlight.current) return;
    analysisInFlight.current = true;
    clearRecoverableError();
    setUiState('analyzing');
    try {
      const response = await send({
        type: 'confirm_analysis',
        goal,
        mode,
        candidates: preview.candidates,
        tabId: preview.tabId,
        tabUrl: preview.tabUrl,
      });
      if (isSuccessful(response, 'analysis')) {
        setResult(response.value);
        setReceipt(response.value.receipt);
        setUiState(response.value.noUsefulAction ? 'no_useful_action' : 'awaiting_outcome');
        return;
      }
      setError(
        responseCode(response) === 'missing_key'
          ? 'Save a TypeSafe AI API key before analyzing.'
          : responseCode(response) === 'active_tab_changed'
            ? messageForCode('active_tab_changed')
            : responseError(response),
      );
      setUiState(responseCode(response) === 'missing_key' ? 'needs_key' : 'retryable_error');
    } finally {
      analysisInFlight.current = false;
    }
  };

  const forgetKey = async (): Promise<void> => {
    const response = await send({ type: 'forget_key' });
    if (isSuccessful(response, 'key_forgotten')) {
      keyAvailable.current = false;
      setFingerprint(undefined);
      setReceipt(undefined);
      setResult(undefined);
      setUiState(preview && preview.candidateCount >= MIN_ITEMS ? 'needs_key' : 'retryable_error');
      setNotice('The API key was removed from the session.');
    } else setError(responseError(response));
  };

  const clearSession = async (): Promise<void> => {
    const response = await send({ type: 'clear_session' });
    if (isSuccessful(response, 'session_cleared')) {
      keyAvailable.current = false;
      setApiKey('');
      setFingerprint(undefined);
      setPreview(undefined);
      setResult(undefined);
      setReceipt(undefined);
      setReceiptHistory([]);
      setNotice('Session cache and receipt history cleared.');
      setUiState('ready');
    } else setError(responseError(response));
  };

  const declareOutcome = async (outcome: Outcome): Promise<void> => {
    const response = await send({ type: 'declare_outcome', outcome });
    if (isSuccessful(response, 'outcome')) {
      setReceipt(response.receipt);
      setReceiptHistory(response.receiptHistory ?? []);
      setUiState('completed');
      setNotice('Outcome recorded in the session receipt.');
    } else setError(responseError(response));
  };

  const grantXAccess = async (): Promise<void> => {
    if (permissionInFlight.current) return;
    permissionInFlight.current = true;
    clearRecoverableError();
    setUiState('checking_access');
    try {
      let granted: boolean;
      try {
        const alreadyGranted = await browser.permissions.contains({ origins: [...X_HOST_ORIGINS] });
        granted = alreadyGranted || (await browser.permissions.request({ origins: [...X_HOST_ORIGINS] }));
      } catch {
        setError('Needle Lens could not verify permission. Try again.');
        setUiState('retryable_error');
        return;
      }
      if (!granted) {
        setError('Access was not granted. Needle Lens cannot inspect posts until you allow access to x.com.');
        setUiState('needs_x_access');
        return;
      }
      await checkAndExtract();
    } finally {
      permissionInFlight.current = false;
    }
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

  const olderReceipts = receipt?.phase === 'complete' ? receiptHistory.slice(0, -1) : receiptHistory;
  const loadingAnalysis =
    uiState === 'extracting' || uiState === 'analyzing' || uiState === 'checking_page' || uiState === 'checking_access';
  const showKeyStep = Boolean(preview && preview.candidateCount >= MIN_ITEMS);
  const accessAction = accessReady && uiState !== 'needs_x_access' && uiState !== 'retryable_error'
    ? checkAndExtract
    : grantXAccess;
  const accessActionLabel =
    uiState === 'needs_x_access'
      ? 'Grant access to X'
      : uiState === 'unsupported_page'
        ? 'Check current tab'
        : accessReady
          ? 'Retry extraction'
          : 'Try again';

  return (
    <ScrollArea className="h-screen w-full">
      <main className="mx-auto flex min-h-full w-full max-w-xl flex-col gap-4 p-4 text-sm sm:p-5">
        <header className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <HugeiconsIcon icon={WandSparklesIcon} aria-hidden="true" />
              </div>
              <div className="flex flex-col">
                <h1 className="text-xl font-semibold tracking-tight">Needle Lens</h1>
                <p className="text-xs text-muted-foreground">Private BYOK workbench</p>
              </div>
            </div>
            <Badge variant="secondary" className="gap-1.5">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} data-icon="inline-start" aria-hidden="true" />
              Ready
            </Badge>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Turn the posts already visible in front of you into a finished session.
          </p>
        </header>

        {error && (
          <Alert variant="destructive">
            <HugeiconsIcon icon={AlertCircleIcon} aria-hidden="true" />
            <AlertTitle>Something needs attention</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <Alert role="status">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} aria-hidden="true" />
            <AlertTitle>Session updated</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Read visible posts on x.com</CardTitle>
            <CardDescription>
              Needle Lens reads only posts already rendered in the active X tab. It never requests broad browsing history access.
            </CardDescription>
            <CardAction>
              <Badge variant={accessReady ? 'secondary' : 'outline'}>
                {accessReady ? 'Verified' : 'Required'}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardFooter>
            <Button
              type="button"
              className="w-full"
              onClick={() => void accessAction()}
              disabled={loadingAnalysis}
            >
              {loadingAnalysis && <Spinner data-icon="inline-start" />}
              {accessActionLabel}
            </Button>
          </CardFooter>
        </Card>

        {showKeyStep && (
          <Card>
            <CardHeader>
              <CardTitle>Bring your own TypeSafe key</CardTitle>
              <CardDescription>
                Stored in memory-only extension storage. It never enters the page, cache, receipt, or content script.
              </CardDescription>
              {fingerprint && (
                <CardAction>
                  <Badge variant="secondary" className="max-w-40 truncate">
                    session · {fingerprint}
                  </Badge>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              <form onSubmit={saveKey}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="api-key" className="sr-only">
                      TypeSafe AI API key
                    </FieldLabel>
                    <InputGroup className="h-9">
                      <InputGroupInput
                        id="api-key"
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.currentTarget.value)}
                        placeholder="ts_…"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <InputGroupAddon align="inline-end">
                        <Button type="submit" size="xs">
                          <HugeiconsIcon icon={KeyRoundIcon} data-icon="inline-start" aria-hidden="true" />
                          Save key
                        </Button>
                      </InputGroupAddon>
                    </InputGroup>
                  </Field>
                </FieldGroup>
              </form>
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" type="button" onClick={forgetKey} disabled={!fingerprint}>
                Forget key
              </Button>
              <Button variant="destructive" size="sm" type="button" onClick={clearSession}>
                Clear session
              </Button>
            </CardFooter>
          </Card>
        )}

        {accessReady && (
          <Card>
            <CardHeader>
              <CardTitle>What should stand out?</CardTitle>
              <CardDescription>
                Describe the outcome you want from the posts currently visible on X.
              </CardDescription>
              <CardAction>
                <Badge variant="secondary">8–30 posts</Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel htmlFor="goal">Goal</FieldLabel>
                  <Textarea
                    id="goal"
                    rows={3}
                    value={goal}
                    onChange={(event) => setGoal(event.currentTarget.value)}
                  />
                  <FieldDescription>
                    Be specific about the people, problems, or signals worth surfacing.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="mode">Mode</FieldLabel>
                  <Select<Mode>
                    value={mode}
                    items={MODE_ITEMS}
                    onValueChange={(value) => {
                      if (value) setMode(value);
                    }}
                  >
                    <SelectTrigger id="mode" aria-label="Mode" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {MODE_ITEMS.map((item) => (
                          <SelectItem value={item.value} key={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="flex-col items-stretch gap-2.5">
              <Button
                type="button"
                className="w-full"
                onClick={prepare}
                disabled={!canPreview || loadingAnalysis}
              >
                {loadingAnalysis && <Spinner data-icon="inline-start" />}
                {uiState === 'extracting'
                  ? 'Reading visible posts…'
                  : uiState === 'analyzing'
                    ? 'Evaluating visible posts…'
                    : 'Preview visible posts'}
              </Button>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Needle Lens reads only the X posts currently visible or just beyond the viewport. It does not scroll, click, post, follow, or message.
              </p>
            </CardFooter>
          </Card>
        )}

        {preview &&
          (uiState === 'awaiting_consent' ||
            uiState === 'insufficient_candidates' ||
            uiState === 'retryable_error' ||
            uiState === 'analyzing') && (
            <Card>
              <CardHeader>
                <CardTitle>{preview.candidateCount} posts are ready</CardTitle>
                <CardDescription>
                  Nothing has left this browser yet. If you continue, the fields below go directly to {preview.provider}.
                </CardDescription>
                <CardAction>
                  <Badge variant="secondary">One request</Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {FIELDS_LEAVING_BROWSER.map((field) => (
                    <Badge variant="outline" key={field}>
                      {field}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Provider: {preview.provider} · model: {preview.model} · cache hits: {preview.cacheHits} · new evaluations: {preview.providerEvaluated}
                </p>
              </CardContent>
              <CardFooter className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => void confirm()}
                  disabled={preview.candidateCount < MIN_ITEMS || uiState === 'analyzing'}
                >
                  <HugeiconsIcon icon={LockKeyholeIcon} data-icon="inline-start" aria-hidden="true" />
                  Send one decision request
                </Button>
                <Button variant="outline" type="button" onClick={() => setPreview(undefined)}>
                  Cancel
                </Button>
              </CardFooter>
            </Card>
          )}

        {result &&
          (uiState === 'results' ||
            uiState === 'no_useful_action' ||
            uiState === 'awaiting_outcome' ||
            uiState === 'completed') && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {result.noUsefulAction
                    ? 'No safe action surfaced'
                    : `${result.cards.length} useful lead${result.cards.length === 1 ? '' : 's'}`}
                </CardTitle>
                <CardDescription>
                  Decisions stay scoped to the visible posts. Needle never manufactures a lead.
                </CardDescription>
                <CardAction>
                  <Badge variant="secondary">Max 3 shown</Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {result.cards.length > 0 ? (
                  result.cards.map(({ candidate, decision }) => (
                    <Card size="sm" key={candidate.id}>
                      <CardHeader className="gap-1.5">
                        <div className="flex items-center gap-2">
                          <Badge variant={decisionVariant(decision.label)}>
                            {decision.label.toUpperCase()}
                          </Badge>
                          {candidate.author && (
                            <span className="min-w-0 truncate text-xs text-muted-foreground">
                              {candidate.author}
                            </span>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-2">
                        <p className="text-sm leading-relaxed">{candidate.text}</p>
                        <p className="text-xs leading-relaxed text-muted-foreground">{decision.reason}</p>
                      </CardContent>
                      {candidate.canonicalUrl && (
                        <CardFooter className="justify-end pt-0">
                          <a
                            className={buttonVariants({ variant: 'link', size: 'sm' })}
                            href={candidate.canonicalUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open on X
                            <HugeiconsIcon icon={ExternalLinkIcon} data-icon="inline-end" aria-hidden="true" />
                          </a>
                        </CardFooter>
                      )}
                    </Card>
                  ))
                ) : (
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <HugeiconsIcon icon={WandSparklesIcon} aria-hidden="true" />
                      </EmptyMedia>
                      <EmptyTitle>No useful action found</EmptyTitle>
                      <EmptyDescription>
                        Needle did not manufacture one. Try a sharper goal or a different mode.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
            </Card>
          )}

        {receipt &&
          (uiState === 'results' ||
            uiState === 'no_useful_action' ||
            uiState === 'awaiting_outcome' ||
            uiState === 'completed' ||
            receipt.phase === 'complete') && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {receipt.phase === 'complete' ? 'Session complete' : 'Record what happened'}
                </CardTitle>
                <CardDescription>
                  {receipt.phase === 'complete'
                    ? 'This receipt is complete and ready to keep.'
                    : 'Choose the closest honest outcome. This is local session bookkeeping, not an automated action.'}
                </CardDescription>
                <CardAction>
                  <Badge variant={receipt.phase === 'complete' ? 'secondary' : 'outline'}>
                    {receipt.totalLatencyMs} ms
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {receipt.phase === 'awaiting_outcome' && (
                  <FieldGroup>
                    <Field>
                      <FieldLabel>Outcome</FieldLabel>
                      <ToggleGroup
                        aria-label="Session outcome"
                        variant="outline"
                        spacing={1}
                        value={[]}
                        onValueChange={(values) => {
                          const outcome = values[0] as Outcome | undefined;
                          if (outcome) void declareOutcome(outcome);
                        }}
                        className="grid w-full grid-cols-2"
                      >
                        {(Object.keys(OUTCOME_LABELS) as Outcome[]).map((outcome) => (
                          <ToggleGroupItem value={outcome} key={outcome}>
                            {OUTCOME_LABELS[outcome]}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </Field>
                  </FieldGroup>
                )}
                <ScrollArea className="max-h-64 rounded-xl border bg-muted/20">
                  <pre className="p-3 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                    {formatReceipt(receipt)}
                  </pre>
                </ScrollArea>
                {olderReceipts.length > 0 && (
                  <>
                    <Separator />
                    <details className="group">
                      <summary className="cursor-pointer text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                        Earlier session receipts ({olderReceipts.length})
                      </summary>
                      <div className="mt-3 flex flex-col gap-3">
                        {olderReceipts
                          .slice()
                          .reverse()
                          .map((historyReceipt) => (
                            <ScrollArea
                              key={`${historyReceipt.completedAt ?? historyReceipt.totalLatencyMs}-${historyReceipt.goal}`}
                              className="max-h-48 rounded-xl border bg-muted/20"
                            >
                              <pre className="p-3 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                                {formatReceipt(historyReceipt)}
                              </pre>
                            </ScrollArea>
                          ))}
                      </div>
                    </details>
                  </>
                )}
              </CardContent>
              <CardFooter className="justify-end">
                <Button variant="outline" type="button" onClick={copyReceipt}>
                  {copyLabel}
                </Button>
              </CardFooter>
            </Card>
          )}

        <footer className="flex items-center justify-between gap-3 px-1 py-1 text-xs text-muted-foreground">
          <span>Local-first · one consented provider request</span>
          <Badge variant="outline" className="capitalize">
            {stateLabel(uiState)}
          </Badge>
        </footer>
      </main>
    </ScrollArea>
  );
}
