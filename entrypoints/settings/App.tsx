import { useEffect, useMemo, useState, type ButtonHTMLAttributes, type ComponentProps, type HTMLAttributes, type InputHTMLAttributes, type LabelHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { AlertCircleIcon, CheckmarkCircle02Icon, KeyRoundIcon, Shield01Icon, TrashIcon as Trash01Icon } from '@hugeicons/core-free-icons';
import type { ExtensionMessage, ExtensionResponse, SettingsSnapshot } from '../../src/messaging/protocol';
import { createLensConfig, lensEditorSeed, updateLens, validateLensConfig, type LensConfig, type LensMode, type LensStrictness } from '../../src/domain/lens';
import type { CredentialRetention } from '../../src/security/credentials';
import { X_HOST_ORIGINS } from '../../src/security/x-access';

type Variant = 'default' | 'outline' | 'secondary' | 'destructive';
type Size = 'default' | 'sm';

function joinClasses(...classes: Array<string | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

function Button({ className, variant = 'default', size = 'default', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button className={joinClasses('inline-flex items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50', size === 'sm' ? 'h-7 text-xs' : 'h-9', variant === 'default' ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/80' : variant === 'secondary' ? 'border-secondary bg-secondary text-secondary-foreground' : variant === 'destructive' ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-border bg-background hover:bg-muted', className)} {...props} />;
}

function Card({ className, ...props }: ComponentProps<'div'>) { return <div className={joinClasses('flex flex-col gap-5 rounded-xl border bg-card p-5 text-sm shadow-sm', className)} {...props} />; }
function CardHeader({ className, ...props }: ComponentProps<'div'>) { return <div className={joinClasses('grid gap-1.5', className)} {...props} />; }
function CardContent({ className, ...props }: ComponentProps<'div'>) { return <div className={joinClasses('grid gap-3', className)} {...props} />; }
function CardFooter({ className, ...props }: ComponentProps<'div'>) { return <div className={joinClasses('flex items-center gap-2', className)} {...props} />; }
function CardTitle({ className, ...props }: ComponentProps<'div'>) { return <div className={joinClasses('font-medium', className)} {...props} />; }
function CardDescription({ className, ...props }: ComponentProps<'div'>) { return <div className={joinClasses('text-sm text-muted-foreground', className)} {...props} />; }
function FieldGroup({ className, ...props }: ComponentProps<'div'>) { return <div className={joinClasses('flex w-full flex-col gap-4', className)} {...props} />; }
function Field({ className, ...props }: ComponentProps<'div'>) { return <div className={joinClasses('flex w-full flex-col gap-2', className)} {...props} />; }
function FieldLabel({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) { return <label className={joinClasses('text-sm font-medium', className)} {...props} />; }
function FieldDescription({ className, ...props }: ComponentProps<'p'>) { return <p className={joinClasses('text-xs leading-relaxed text-muted-foreground', className)} {...props} />; }
function Alert({ className, variant, ...props }: HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'destructive' }) { return <div role="alert" className={joinClasses('grid gap-1 rounded-lg border p-3 text-sm', variant === 'destructive' ? 'border-destructive/40 text-destructive' : 'border-border', className)} {...props} />; }
function AlertTitle({ className, ...props }: ComponentProps<'div'>) { return <div className={joinClasses('font-medium', className)} {...props} />; }
function AlertDescription({ className, ...props }: ComponentProps<'div'>) { return <div className={joinClasses('text-sm text-muted-foreground', className)} {...props} />; }
function Badge({ className, variant = 'default', ...props }: ComponentProps<'span'> & { variant?: Variant }) { return <span className={joinClasses('inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-xs font-medium', variant === 'secondary' ? 'border-secondary bg-secondary text-secondary-foreground' : variant === 'outline' ? 'border-border' : 'border-primary bg-primary text-primary-foreground', className)} {...props} />; }
function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) { return <input className={joinClasses('h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40', className)} {...props} />; }
function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className={joinClasses('min-h-16 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40', className)} {...props} />; }
function Separator({ className, ...props }: HTMLAttributes<HTMLHRElement>) { return <hr className={joinClasses('w-full border-border', className)} {...props} />; }

type SuccessfulResponse = Extract<ExtensionResponse, { ok: true }>;

type Draft = Omit<LensConfig, 'id' | 'version' | 'createdAt' | 'updatedAt'> & Partial<Pick<LensConfig, 'id' | 'createdAt' | 'updatedAt'>>;

function isSuccessful<T extends SuccessfulResponse['type']>(response: ExtensionResponse, type: T): response is Extract<SuccessfulResponse, { type: T }> {
  return response.ok && response.type === type;
}

function lines(values: string[]): string {
  return values.join('\n');
}

function parseLines(value: string): string[] {
  return value.split('\n').map((entry) => entry.trim()).filter(Boolean);
}

function draftFromLens(lens: LensConfig): Draft {
  const { id, version, createdAt, updatedAt, ...draft } = lens;
  return { ...draft, id, createdAt, updatedAt };
}

function messageError(response: ExtensionResponse): string {
  return response.ok ? 'Needle Lens returned an unexpected response.' : response.error;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>();
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<Draft>(lensEditorSeed());
  const [apiKey, setApiKey] = useState('');
  const [retention, setRetention] = useState<CredentialRetention>('session');
  const [importText, setImportText] = useState('');
  const [exportText, setExportText] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (message: ExtensionMessage): Promise<ExtensionResponse> => {
    try {
      return (await browser.runtime.sendMessage(message)) as ExtensionResponse;
    } catch {
      return { ok: false, error: 'The extension background worker is unavailable.', code: 'runtime' };
    }
  };

  const refresh = async (): Promise<void> => {
    const response = await send({ type: 'get_settings' });
    if (!isSuccessful(response, 'settings')) {
      setError(messageError(response));
      return;
    }
    setSnapshot(response.value);
    setSelectedId((current) => response.value.settings.lenses.some((lens) => lens.id === current) ? current : response.value.settings.activeLensId);
    const active = response.value.settings.lenses.find((lens) => lens.id === response.value.settings.activeLensId) ?? response.value.settings.lenses[0];
    if (active) setDraft(draftFromLens(active));
    setRetention(response.value.credential.retention ?? 'session');
  };

  useEffect(() => { void refresh(); }, []);

  const selectedLens = useMemo(() => snapshot?.settings.lenses.find((lens) => lens.id === selectedId), [selectedId, snapshot]);
  const setDraftField = <K extends keyof Draft>(field: K, value: Draft[K]): void => setDraft((current) => ({ ...current, [field]: value }));
  const setListField = (field: 'target' | 'evidence' | 'exclusions' | 'desiredActions', value: string): void => setDraftField(field, parseLines(value));

  const withBusy = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError('');
    setNotice('');
    try { await operation(); } catch { setError('Needle Lens could not complete this settings change.'); } finally { setBusy(false); }
  };

  const selectLens = (id: string): void => {
    setSelectedId(id);
    const lens = snapshot?.settings.lenses.find((entry) => entry.id === id);
    if (lens) setDraft(draftFromLens(lens));
    void setActiveLens(id);
  };

  const saveLens = async (): Promise<void> => withBusy(async () => {
    const { id, createdAt, updatedAt, ...fields } = draft;
    const lens = id && selectedLens ? updateLens(selectedLens, fields) : createLensConfig(fields);
    const response = await send({ type: 'save_lens', lens });
    if (!isSuccessful(response, 'lens_saved')) { setError(messageError(response)); return; }
    setSnapshot((current) => current ? { ...current, settings: response.settings } : current);
    setSelectedId(lens.id);
    setDraft(draftFromLens(lens));
    setNotice('Lens saved locally.');
  });

  const createNewLens = (): void => {
    setSelectedId('');
    setDraft(lensEditorSeed());
    setNotice('Editing a new Lens. Save it when the criteria are complete.');
  };

  const duplicateLens = async (): Promise<void> => {
    if (!selectedLens) return;
    await withBusy(async () => {
      const response = await send({ type: 'duplicate_lens', lensId: selectedLens.id });
      if (!isSuccessful(response, 'lens_duplicated')) { setError(messageError(response)); return; }
      setSnapshot((current) => current ? { ...current, settings: response.settings } : current);
      setSelectedId(response.lens.id);
      setDraft(draftFromLens(response.lens));
      setNotice('Lens duplicated locally.');
    });
  };

  const deleteLens = async (): Promise<void> => {
    if (!selectedLens) return;
    await withBusy(async () => {
      const response = await send({ type: 'delete_lens', lensId: selectedLens.id });
      if (!isSuccessful(response, 'lens_deleted')) { setError(messageError(response)); return; }
      setSnapshot((current) => current ? { ...current, settings: response.settings } : current);
      const next = response.settings.lenses.find((lens) => lens.id === response.settings.activeLensId) ?? response.settings.lenses[0]!;
      setSelectedId(next.id);
      setDraft(draftFromLens(next));
      setNotice('Lens deleted locally.');
    });
  };

  const setActiveLens = async (id: string): Promise<void> => withBusy(async () => {
    const response = await send({ type: 'set_active_lens', lensId: id });
    if (!isSuccessful(response, 'active_lens_set')) { setError(messageError(response)); return; }
    setSnapshot((current) => current ? { ...current, settings: response.settings } : current);
    setNotice('Active Lens updated.');
  });

  const saveDefaults = async (): Promise<void> => withBusy(async () => {
    if (!snapshot) return;
    const response = await send({ type: 'set_defaults', strictness: snapshot.settings.defaults.strictness, maxActions: snapshot.settings.defaults.maxActions, maxItems: snapshot.settings.defaults.maxItems, cacheRetention: snapshot.settings.cacheRetention });
    if (!isSuccessful(response, 'defaults_saved')) { setError(messageError(response)); return; }
    setSnapshot((current) => current ? { ...current, settings: response.settings } : current);
    setNotice('Lens defaults saved locally.');
  });

  const saveKey = async (): Promise<void> => withBusy(async () => {
    const response = await send({ type: 'save_key', apiKey: apiKey.trim(), retention });
    if (!isSuccessful(response, 'key_saved')) { setError(messageError(response)); return; }
    setApiKey('');
    await refresh();
    setNotice(response.fallback ? 'The browser could not persist a CryptoKey, so the key is session-only.' : response.retention === 'seven_days' ? 'Key protected at rest and scheduled for deletion in seven days.' : 'Key saved for this browser session only.');
  });

  const forgetKey = async (): Promise<void> => withBusy(async () => {
    const response = await send({ type: 'forget_key' });
    if (!isSuccessful(response, 'key_forgotten')) { setError(messageError(response)); return; }
    await refresh();
    setNotice('The TypeSafe credential was deleted immediately.');
  });

  const revokeConsent = async (): Promise<void> => withBusy(async () => {
    const response = await send({ type: 'revoke_consent' });
    if (!isSuccessful(response, 'consent_revoked')) { setError(messageError(response)); return; }
    await refresh();
    setNotice('Consent was revoked. Needle Lens will ask again before the next provider call.');
  });

  const clearMetadata = async (): Promise<void> => withBusy(async () => {
    const response = await send({ type: 'clear_decision_metadata' });
    if (!isSuccessful(response, 'metadata_cleared')) { setError(messageError(response)); return; }
    setNotice('Cached decision metadata and session receipts were cleared.');
  });

  const clearAll = async (): Promise<void> => withBusy(async () => {
    const response = await send({ type: 'clear_all_local_data' });
    if (!isSuccessful(response, 'local_data_cleared')) { setError(messageError(response)); return; }
    await refresh();
    setNotice('All local Needle Lens data was cleared; safe defaults were restored on next use.');
  });

  const grantX = async (): Promise<void> => withBusy(async () => {
    try {
      const alreadyGranted = await browser.permissions.contains({ origins: [...X_HOST_ORIGINS] });
      const granted = alreadyGranted || await browser.permissions.request({ origins: [...X_HOST_ORIGINS] });
      if (!granted) { setError('X access was not granted.'); return; }
      await refresh();
      setNotice('X access granted for the exact listed origins.');
    } catch { setError('Needle Lens could not verify X access.'); }
  });

  const revokeX = async (): Promise<void> => withBusy(async () => {
    const removed = await browser.permissions.remove({ origins: [...X_HOST_ORIGINS] });
    await refresh();
    setNotice(removed ? 'X access revoked.' : 'X access was already not granted.');
  });

  const exportLens = async (): Promise<void> => withBusy(async () => {
    if (!selectedLens) return;
    const response = await send({ type: 'export_lens', lensId: selectedLens.id });
    if (!isSuccessful(response, 'lens_exported')) { setError(messageError(response)); return; }
    setExportText(response.json);
    setNotice('Lens JSON prepared below. It contains user-authored policy only, not X content.');
  });

  const importLens = async (): Promise<void> => withBusy(async () => {
    let parsed: unknown;
    try { parsed = JSON.parse(importText) as unknown; validateLensConfig(parsed); } catch { setError('The imported JSON is not a valid Lens configuration.'); return; }
    const response = await send({ type: 'import_lens', lens: parsed });
    if (!isSuccessful(response, 'lens_imported')) { setError(messageError(response)); return; }
    setSnapshot((current) => current ? { ...current, settings: response.settings } : current);
    setSelectedId(response.lens.id);
    setDraft(draftFromLens(response.lens));
    setImportText('');
    setNotice('Lens imported and validated locally.');
  });

  if (!snapshot) return <main className="mx-auto flex min-h-screen max-w-4xl items-center justify-center p-6"><span className="text-sm text-muted-foreground">Loading settings…</span></main>;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-5 p-5 text-sm sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4"><div><Badge variant="outline">Needle Lens Settings</Badge><h1 className="mt-2 text-3xl font-semibold tracking-tight">Privacy, provider, and Lens policy</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Keep user-authored decision policy local, control the BYOK lifecycle, and review exactly what the extension can read and send.</p></div><Badge variant="secondary">Local-first</Badge></header>
      {error && <Alert variant="destructive"><AlertTitle>Settings need attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <Alert role="status"><AlertTitle>Updated</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert>}

      <Alert className="border-amber-400/40 bg-amber-400/5"><AlertTitle>Policy boundary</AlertTitle><AlertDescription>Needle Lens reads text already rendered in the active X tab and sends the selected text to TypeSafe AI for decision inference. Needle Lens is not affiliated with or endorsed by X. Automated extraction may be restricted by X&apos;s terms. No posting or account action is performed.</AlertDescription></Alert>

      <section className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <Card><CardHeader><CardTitle>Saved Lenses</CardTitle><CardDescription>Create a specific policy instead of relying on a generic post filter. Every criterion is user-authored and validated before storage.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4"><div className="flex flex-wrap gap-2">{snapshot.settings.lenses.map((lens) => <Button key={lens.id} variant={lens.id === selectedId ? 'default' : 'outline'} size="sm" type="button" onClick={() => selectLens(lens.id)}>{lens.name}</Button>)}</div><div className="flex flex-wrap gap-2"><Button size="sm" type="button" onClick={createNewLens}>New Lens</Button><Button size="sm" variant="outline" type="button" onClick={() => void duplicateLens()} disabled={!selectedLens || busy}>Duplicate</Button><Button size="sm" variant="outline" type="button" onClick={() => void deleteLens()} disabled={!selectedLens || busy}><HugeiconsIcon icon={Trash01Icon} data-icon="inline-start" aria-hidden="true" />Delete</Button></div><Separator /><FieldGroup><Field><FieldLabel htmlFor="lens-name">Name</FieldLabel><Input id="lens-name" value={draft.name} maxLength={60} onChange={(event) => setDraftField('name', event.currentTarget.value)} /></Field><Field><FieldLabel htmlFor="lens-goal">Goal</FieldLabel><Textarea id="lens-goal" rows={3} value={draft.goal} maxLength={500} onChange={(event) => setDraftField('goal', event.currentTarget.value)} /><FieldDescription>10–500 characters. Do not leave the goal vague; Needle never invents missing criteria.</FieldDescription></Field><Field><FieldLabel htmlFor="lens-target">Target criteria</FieldLabel><Textarea id="lens-target" rows={3} value={lines(draft.target)} onChange={(event) => setListField('target', event.currentTarget.value)} /><FieldDescription>One atomic entry per line, 1–8 entries.</FieldDescription></Field><Field><FieldLabel htmlFor="lens-evidence">Evidence criteria</FieldLabel><Textarea id="lens-evidence" rows={3} value={lines(draft.evidence)} onChange={(event) => setListField('evidence', event.currentTarget.value)} /><FieldDescription>One atomic entry per line, 1–8 entries.</FieldDescription></Field><Field><FieldLabel htmlFor="lens-exclusions">Exclusions</FieldLabel><Textarea id="lens-exclusions" rows={2} value={lines(draft.exclusions)} onChange={(event) => setListField('exclusions', event.currentTarget.value)} /><FieldDescription>Optional, 0–8 entries.</FieldDescription></Field><Field><FieldLabel htmlFor="lens-actions">Desired actions</FieldLabel><Textarea id="lens-actions" rows={2} value={lines(draft.desiredActions)} onChange={(event) => setListField('desiredActions', event.currentTarget.value)} /><FieldDescription>One manual, user-led action per line, 1–5 entries.</FieldDescription></Field></FieldGroup></CardContent><CardFooter className="flex flex-wrap gap-2"><Button type="button" onClick={() => void saveLens()} disabled={busy}>Save Lens</Button><Button variant="outline" type="button" onClick={() => void exportLens()} disabled={!selectedLens || busy}>Prepare JSON export</Button></CardFooter></Card>

        <div className="flex flex-col gap-5"><Card><CardHeader><CardTitle>Decision policy</CardTitle><CardDescription>Thresholds are fixed by strictness profile and applied deterministically after Jev answers.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2"><Field><FieldLabel htmlFor="lens-mode">Mode</FieldLabel><select id="lens-mode" className="h-9 rounded-md border border-input bg-background px-3" value={draft.mode} onChange={(event) => setDraftField('mode', event.currentTarget.value as LensMode)}><option value="find_people">Find people</option><option value="find_problems">Find problems</option><option value="find_signal">Find signal</option></select></Field><Field><FieldLabel htmlFor="lens-strictness">Strictness</FieldLabel><select id="lens-strictness" className="h-9 rounded-md border border-input bg-background px-3" value={draft.strictness} onChange={(event) => setDraftField('strictness', event.currentTarget.value as LensStrictness)}><option value="exploratory">Exploratory</option><option value="balanced">Balanced</option><option value="strict">Strict</option></select></Field><Field><FieldLabel htmlFor="lens-actions-max">Maximum surfaced actions</FieldLabel><select id="lens-actions-max" className="h-9 rounded-md border border-input bg-background px-3" value={draft.maxActions} onChange={(event) => setDraftField('maxActions', Number(event.currentTarget.value) as 1 | 2 | 3)}><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></Field><Field><FieldLabel htmlFor="lens-items-max">Maximum candidates</FieldLabel><Input id="lens-items-max" type="number" min={1} max={30} value={draft.maxItems} onChange={(event) => setDraftField('maxItems', Number(event.currentTarget.value))} /></Field></CardContent></Card>

        <Card><CardHeader><CardTitle>Provider and credential retention</CardTitle><CardDescription>Provider: TypeSafe AI · model: jev-latest. The key is used only in the trusted extension service worker.</CardDescription></CardHeader><CardContent className="flex flex-col gap-3"><Field><FieldLabel htmlFor="api-key">Replace TypeSafe AI API key</FieldLabel><div className="flex gap-2"><Input id="api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.currentTarget.value)} placeholder="ts_…" autoComplete="off" spellCheck={false} /><Button type="button" onClick={() => void saveKey()} disabled={busy || apiKey.trim().length < 8}><HugeiconsIcon icon={KeyRoundIcon} data-icon="inline-start" aria-hidden="true" />Save</Button></div></Field><Field><FieldLabel htmlFor="retention">Credential retention</FieldLabel><select id="retention" className="h-9 rounded-md border border-input bg-background px-3" value={retention} onChange={(event) => setRetention(event.currentTarget.value as CredentialRetention)}><option value="session">Session only — recommended</option><option value="seven_days">Remember for seven days</option></select><FieldDescription>{retention === 'seven_days' ? 'Protected at rest in this browser profile and automatically deleted after seven days. This is not equivalent to an operating-system keychain.' : 'The key disappears when the browser session ends and is never written to persistent storage.'}</FieldDescription></Field><p className="text-xs text-muted-foreground">Status: {snapshot.credential.configured ? `${snapshot.credential.retention === 'seven_days' ? 'remembered for seven days' : 'session-only'}${snapshot.credential.expiresAt ? ` · expires ${new Date(snapshot.credential.expiresAt).toLocaleString()}` : ''}` : 'not configured'}{snapshot.credential.fingerprint ? ` · fingerprint ${snapshot.credential.fingerprint}` : ''}</p></CardContent><CardFooter><Button variant="outline" type="button" onClick={() => void forgetKey()} disabled={!snapshot.credential.configured || busy}>Forget key immediately</Button></CardFooter></Card></div>
      </section>

      {exportText && <Card><CardHeader><CardTitle>Lens JSON export</CardTitle><CardDescription>Copy this user-authored Lens configuration; it contains no post text.</CardDescription></CardHeader><CardContent><Textarea rows={10} value={exportText} readOnly /></CardContent></Card>}
      <Card><CardHeader><CardTitle>Import a Lens</CardTitle><CardDescription>Only the versioned Lens schema is accepted. Unknown object keys are rejected.</CardDescription></CardHeader><CardContent><Textarea rows={6} value={importText} onChange={(event) => setImportText(event.currentTarget.value)} placeholder="Paste one exported Lens JSON object" /></CardContent><CardFooter><Button type="button" onClick={() => void importLens()} disabled={busy || importText.trim().length === 0}>Validate and import</Button></CardFooter></Card>

      <section className="grid gap-5 lg:grid-cols-2"><Card><CardHeader><CardTitle>Lens defaults and cache</CardTitle><CardDescription>Defaults apply to new workflows; cache entries contain hashes and typed decision metadata, never complete posts.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-3"><Field><FieldLabel htmlFor="default-strictness">Default strictness</FieldLabel><select id="default-strictness" className="h-9 rounded-md border border-input bg-background px-3" value={snapshot.settings.defaults.strictness} onChange={(event) => setSnapshot((current) => current ? { ...current, settings: { ...current.settings, defaults: { ...current.settings.defaults, strictness: event.currentTarget.value as LensStrictness } } } : current)}><option value="exploratory">Exploratory</option><option value="balanced">Balanced</option><option value="strict">Strict</option></select></Field><Field><FieldLabel htmlFor="default-max-actions">Default actions</FieldLabel><Input id="default-max-actions" type="number" min={1} max={3} value={snapshot.settings.defaults.maxActions} onChange={(event) => setSnapshot((current) => current ? { ...current, settings: { ...current.settings, defaults: { ...current.settings.defaults, maxActions: Number(event.currentTarget.value) as 1 | 2 | 3 } } } : current)} /></Field><Field><FieldLabel htmlFor="default-max-items">Default candidates</FieldLabel><Input id="default-max-items" type="number" min={1} max={30} value={snapshot.settings.defaults.maxItems} onChange={(event) => setSnapshot((current) => current ? { ...current, settings: { ...current.settings, defaults: { ...current.settings.defaults, maxItems: Number(event.currentTarget.value) } } } : current)} /></Field><Field className="sm:col-span-3"><FieldLabel htmlFor="cache-retention">Decision metadata retention</FieldLabel><select id="cache-retention" className="h-9 rounded-md border border-input bg-background px-3" value={snapshot.settings.cacheRetention} onChange={(event) => setSnapshot((current) => current ? { ...current, settings: { ...current.settings, cacheRetention: event.currentTarget.value as 'off' | 'session' | '24h' } } : current)}><option value="off">Off</option><option value="session">Current session</option><option value="24h">24 hours maximum</option></select></Field></CardContent><CardFooter className="flex flex-wrap gap-2"><Button type="button" onClick={() => void saveDefaults()} disabled={busy}>Save defaults</Button><Button variant="outline" type="button" onClick={() => void clearMetadata()} disabled={busy}>Clear cached decision metadata</Button></CardFooter></Card>

      <Card><CardHeader><CardTitle>Privacy and consent</CardTitle><CardDescription>Before the first provider call, Needle shows the data categories, destination, purpose, and retention limitation. Consent is revocable.</CardDescription></CardHeader><CardContent className="flex flex-col gap-2 text-xs leading-relaxed text-muted-foreground"><p>Consent status: <span className="font-medium text-foreground">{snapshot.settings.consent ? `granted ${new Date(snapshot.settings.consent.grantedAt).toLocaleString()}` : 'not granted'}</span></p><p>Sent to TypeSafe only after consent: Lens goal/criteria, selected mode/strictness, and text already rendered in the active X tab.</p><p>Stored locally: user-authored Lenses, settings, consent record, encrypted credential envelope when opted in, hashes for bounded deduplication, and structured decision metadata with the selected TTL.</p><p>Never stored: complete post bodies, biographies, media, private posts, direct messages, cookies, or X authentication information. Needle does not control TypeSafe retention; TypeSafe retention terms were not verified by Needle Lens.</p></CardContent><CardFooter className="flex flex-wrap gap-2"><Button variant="outline" type="button" onClick={() => void revokeConsent()} disabled={!snapshot.settings.consent || busy}>Revoke consent</Button><Button variant="destructive" type="button" onClick={() => void clearAll()} disabled={busy}>Clear all local Needle data</Button></CardFooter></Card></section>

      <section className="grid gap-5 lg:grid-cols-2"><Card><CardHeader><CardTitle>X access</CardTitle><CardDescription>Current state: {snapshot.xAccessGranted ? 'granted' : 'not granted'}. Exact origins requested: {snapshot.xOrigins.join(', ')}.</CardDescription></CardHeader><CardContent><p className="text-xs leading-relaxed text-muted-foreground">Needle cannot post, reply, follow, like, repost, bookmark, message, navigate, scroll, or control the X account. Extraction is user-initiated, active-tab-only, rendered-content-only, read-only, ephemeral, and bounded to 30 candidates.</p></CardContent><CardFooter className="flex flex-wrap gap-2"><Button type="button" onClick={() => void grantX()} disabled={busy}>Grant X access</Button><Button variant="outline" type="button" onClick={() => void revokeX()} disabled={busy}>Revoke X access</Button></CardFooter></Card><Card><CardHeader><CardTitle>Legal and project links</CardTitle><CardDescription>Needle Lens is not affiliated with X.</CardDescription></CardHeader><CardContent className="flex flex-col gap-2 text-sm"><a className="underline" href={snapshot.legal.needlePrivacy} target="_blank" rel="noreferrer">Needle Privacy Policy</a><a className="underline" href={snapshot.legal.xTerms} target="_blank" rel="noreferrer">X Terms</a><a className="underline" href={snapshot.legal.xPrivacy} target="_blank" rel="noreferrer">X Privacy Policy</a><a className="underline" href={snapshot.legal.typeSafePrivacy} target="_blank" rel="noreferrer">TypeSafe Privacy Policy</a><a className="underline" href={snapshot.legal.repository} target="_blank" rel="noreferrer">Open-source repository</a></CardContent></Card></section>

      <footer className="pb-4 text-xs text-muted-foreground">No backend, account system, analytics, telemetry, X API integration, or model training is added by Needle Lens. Static verification is the responsibility of the build workflow; runtime/provider testing remains with the user.</footer>
    </main>
  );
}
