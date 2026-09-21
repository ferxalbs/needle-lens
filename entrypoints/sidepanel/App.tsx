import { useEffect, useMemo, useState } from 'react';
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
import { Input } from './components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { Separator } from './components/ui/separator';
import { Spinner } from './components/ui/spinner';
import { Textarea } from './components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group';

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
  if (state === 'loading') return 'Warming up…';
  return state.replaceAll('_', ' ');
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
  const loadingAnalysis = uiState === 'extracting' || uiState === 'evaluating';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-4 px-4 py-5 text-sm sm:px-5">
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <HugeiconsIcon icon={WandSparklesIcon} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex flex-col gap-2">
            <Badge variant="outline">Private BYOK workbench</Badge>
            <h1 className="text-2xl font-semibold tracking-tight">Needle Lens</h1>
            <p className="max-w-sm text-sm leading-5 text-muted-foreground">
              Turn the posts already visible in front of you into a finished session.
            </p>
          </div>
        </div>
        <Badge variant="secondary" className="shrink-0">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} data-icon="inline-start" aria-hidden="true" />
          Ready
        </Badge>
      </header>

      {error && (
        <Alert variant="destructive">
          <HugeiconsIcon icon={AlertCircleIcon} aria-hidden="true" />
          <AlertTitle>Something needs attention</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert role="status" className="border-primary/30 bg-primary/5">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} aria-hidden="true" />
          <AlertTitle>Session updated</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="border-b">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Badge variant="outline">01 / Your key</Badge>
              <CardTitle>Bring your own TypeSafe key</CardTitle>
            </div>
            {fingerprint && (
              <Badge variant="secondary" className="max-w-44 truncate">session · {fingerprint}</Badge>
            )}
          </div>
          <CardDescription>
            Stored in memory-only extension storage. It never enters the page, cache, receipt, or content script.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={saveKey}>
            <FieldGroup className="gap-3">
              <Field>
                <FieldLabel htmlFor="api-key" className="sr-only">TypeSafe AI API key</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="api-key"
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.currentTarget.value)}
                    placeholder="ts_…"
                    autoComplete="off"
                    spellCheck={false}
                    className="h-9"
                  />
                  <Button type="submit" size="lg" className="shrink-0">
                    <HugeiconsIcon icon={KeyRoundIcon} data-icon="inline-start" aria-hidden="true" />
                    Save key
                  </Button>
                </div>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button variant="outline" size="sm" type="button" onClick={forgetKey} disabled={!fingerprint}>
            Forget key
          </Button>
          <Button variant="destructive" size="sm" type="button" onClick={clearSession}>
            Clear session
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Badge variant="outline">02 / Shape the lens</Badge>
              <CardTitle>What should stand out?</CardTitle>
            </div>
            <Badge variant="secondary">8–30 posts</Badge>
          </div>
          <CardDescription>Describe the outcome you want from the posts currently visible on X.</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="goal">Goal</FieldLabel>
              <Textarea
                id="goal"
                rows={3}
                value={goal}
                onChange={(event) => setGoal(event.currentTarget.value)}
              />
              <FieldDescription>Be specific about the people, problems, or signals worth surfacing.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="mode">Mode</FieldLabel>
              <Select<Mode>
                value={mode}
                items={MODE_ITEMS}
                onValueChange={(value) => { if (value) setMode(value); }}
              >
                <SelectTrigger id="mode" aria-label="Mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {MODE_ITEMS.map((item) => (
                      <SelectItem value={item.value} key={item.value}>{item.label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3">
          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={prepare}
            disabled={!canAnalyze || loadingAnalysis}
          >
            {loadingAnalysis && <Spinner data-icon="inline-start" />}
            {uiState === 'extracting' ? 'Reading visible posts…' : uiState === 'evaluating' ? 'Evaluating visible posts…' : 'Preview visible posts'}
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">
            Needle Lens reads only the X posts currently visible or just beyond the viewport. It does not scroll, click, post, follow, or message.
          </p>
        </CardFooter>
      </Card>

      {preview && (uiState === 'awaiting_consent' || uiState === 'insufficient_candidates') && (
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <Badge variant="outline">03 / Confirm the handoff</Badge>
                <CardTitle>{preview.candidates.length} posts are ready</CardTitle>
              </div>
              <Badge variant="secondary">One request</Badge>
            </div>
            <CardDescription>
              Nothing has left this browser yet. If you continue, the fields below go directly to {preview.provider}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-4">
            <div className="flex flex-wrap gap-2">
              {FIELDS_LEAVING_BROWSER.map((field) => <Badge variant="secondary" key={field}>{field}</Badge>)}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Provider: {preview.provider} · model: {preview.model} · cache hits: {preview.cacheHits} · new evaluations: {preview.providerEvaluated}
            </p>
          </CardContent>
          <CardFooter className="flex-wrap gap-2">
            <Button type="button" size="lg" onClick={confirm} disabled={preview.candidates.length < 8}>
              <HugeiconsIcon icon={LockKeyholeIcon} data-icon="inline-start" aria-hidden="true" />
              Send one decision request
            </Button>
            <Button variant="outline" type="button" onClick={() => setPreview(undefined)}>Cancel</Button>
          </CardFooter>
        </Card>
      )}

      {result && (uiState === 'results' || uiState === 'no_useful_action' || uiState === 'awaiting_outcome' || uiState === 'complete') && (
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <Badge variant="outline">04 / Your shortlist</Badge>
                <CardTitle>{result.noUsefulAction ? 'No safe action surfaced' : `${result.cards.length} useful lead${result.cards.length === 1 ? '' : 's'}`}</CardTitle>
              </div>
              <Badge variant="secondary">Max 3 shown</Badge>
            </div>
            <CardDescription>Decisions stay scoped to the visible posts. Needle never manufactures a lead.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-4">
            {result.cards.length > 0 ? result.cards.map(({ candidate, decision }) => (
              <Card size="sm" className="bg-background/60" key={candidate.id}>
                <CardHeader className="gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={decisionVariant(decision.label)}>{decision.label.toUpperCase()}</Badge>
                    {candidate.author && <span className="min-w-0 truncate text-xs text-muted-foreground">{candidate.author}</span>}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 pb-3">
                  <p className="text-sm leading-5">{candidate.text}</p>
                  <p className="text-xs leading-5 text-muted-foreground">{decision.reason}</p>
                </CardContent>
                {candidate.canonicalUrl && (
                  <CardFooter className="justify-end border-t-0 bg-transparent pt-0">
                    <a className={buttonVariants({ variant: 'link', size: 'sm' })} href={candidate.canonicalUrl} target="_blank" rel="noreferrer">
                      Open on X
                      <HugeiconsIcon icon={ExternalLinkIcon} data-icon="inline-end" aria-hidden="true" />
                    </a>
                  </CardFooter>
                )}
              </Card>
            )) : (
              <Empty className="border-border bg-background/40">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><HugeiconsIcon icon={WandSparklesIcon} aria-hidden="true" /></EmptyMedia>
                  <EmptyTitle>No useful action found</EmptyTitle>
                  <EmptyDescription>Needle did not manufacture one. Try a sharper goal or a different mode.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>
      )}

      {receipt && (uiState === 'results' || uiState === 'no_useful_action' || uiState === 'awaiting_outcome' || uiState === 'complete' || receipt.phase === 'complete') && (
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <Badge variant="outline">05 / Close the loop</Badge>
                <CardTitle>{receipt.phase === 'complete' ? 'Session complete' : 'Record what happened'}</CardTitle>
              </div>
              <Badge variant={receipt.phase === 'complete' ? 'secondary' : 'outline'}>{receipt.totalLatencyMs} ms</Badge>
            </div>
            <CardDescription>
              {receipt.phase === 'complete' ? 'This receipt is complete and ready to keep.' : 'Choose the closest honest outcome. This is local session bookkeeping, not an automated action.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-4">
            {receipt.phase === 'awaiting_outcome' && (
              <FieldGroup className="gap-3">
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
                      <ToggleGroupItem value={outcome} key={outcome}>{OUTCOME_LABELS[outcome]}</ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>
              </FieldGroup>
            )}
            <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/20 p-3 font-mono text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap">{formatReceipt(receipt)}</pre>
            {olderReceipts.length > 0 && (
              <>
                <Separator />
                <details className="group">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                    Earlier session receipts ({olderReceipts.length})
                  </summary>
                  <div className="mt-3 flex flex-col gap-3">
                    {olderReceipts.slice().reverse().map((historyReceipt) => (
                      <pre className="overflow-auto rounded-lg border bg-muted/20 p-3 font-mono text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap" key={`${historyReceipt.completedAt ?? historyReceipt.totalLatencyMs}-${historyReceipt.goal}`}>
                        {formatReceipt(historyReceipt)}
                      </pre>
                    ))}
                  </div>
                </details>
              </>
            )}
          </CardContent>
          <CardFooter className="justify-end">
            <Button variant="outline" type="button" onClick={copyReceipt}>{copyLabel}</Button>
          </CardFooter>
        </Card>
      )}

      <footer className="flex items-center justify-between gap-3 px-1 pb-1 text-[11px] text-muted-foreground">
        <span>Local-first · one consented provider request</span>
        <Badge variant="outline" className="capitalize">{stateLabel(uiState)}</Badge>
      </footer>
    </main>
  );
}
