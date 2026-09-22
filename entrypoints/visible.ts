import type { Decision, VisibleCandidate } from '../src/domain/types';
import { canonicalStatusUrl, statusIdFromUrl } from '../src/extraction/normalize';
import { extractVisibleCandidates } from '../src/extraction/x-visible-posts';

type OverlayDecision = Pick<Decision, 'candidateId' | 'label' | 'probability' | 'confidence' | 'boundary' | 'reason'> & { canonicalUrl?: string };
type ContentCommand =
  | { type: 'needle_start_observer'; analyzedIds: string[] }
  | { type: 'needle_pause_observer' }
  | { type: 'needle_finish_session' }
  | { type: 'needle_extract_candidates'; candidateIds: string[] }
  | { type: 'needle_render_overlays'; decisions: OverlayDecision[] };

const STATE_KEY = '__needleLensLiveState';
const MAX_PENDING = 30;
const DEBOUNCE_MS = 400;

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function profileUrl(canonicalUrl: string | undefined): string | undefined {
  if (!canonicalUrl) return undefined;
  const parsed = new URL(canonicalUrl);
  const handle = parsed.pathname.split('/')[1];
  return handle ? `https://x.com/${encodeURIComponent(handle)}` : undefined;
}

function canonicalId(article: Element): string | undefined {
  for (const anchor of Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const canonical = canonicalStatusUrl(anchor.href);
    const statusId = canonical ? statusIdFromUrl(canonical) : undefined;
    if (statusId) return `status_${statusId}`;
  }
  return undefined;
}

function articleForId(id: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>('main article')).find((article) => canonicalId(article) === id);
}

function makeState() {
  let observer: MutationObserver | undefined;
  let debounce: number | undefined;
  let route = location.href;
  const analyzed = new Set<string>();
  const pending = new Set<string>();
  const overlays = new Map<string, HTMLElement>();

  function emit(): void {
    void browser.runtime.sendMessage({ type: 'needle_candidates_changed', candidateIds: [...pending] }).catch(() => undefined);
  }

  function removeOverlay(id: string): void {
    overlays.get(id)?.remove();
    overlays.delete(id);
  }

  function prune(): void {
    for (const [id, host] of overlays) if (!host.isConnected || !articleForId(id)) removeOverlay(id);
    for (const id of [...pending]) if (!articleForId(id)) pending.delete(id);
  }

  function collect(added: readonly Node[], removed: readonly Node[]): void {
    if (location.href !== route) {
      stop(true);
      void browser.runtime.sendMessage({ type: 'needle_session_invalidated', reason: 'route_change' }).catch(() => undefined);
      return;
    }
    for (const node of removed) {
      if (!(node instanceof Element)) continue;
      for (const article of [node, ...node.querySelectorAll('article')]) {
        const id = canonicalId(article);
        if (id) removeOverlay(id);
      }
    }
    for (const node of added) {
      if (!(node instanceof Element)) continue;
      for (const article of [node, ...node.querySelectorAll('article')]) {
        const id = canonicalId(article);
        if (id && !analyzed.has(id) && pending.size < MAX_PENDING) pending.add(id);
      }
    }
    prune();
    emit();
  }

  function stop(clear: boolean): void {
    observer?.disconnect();
    observer = undefined;
    if (debounce !== undefined) window.clearTimeout(debounce);
    debounce = undefined;
    pending.clear();
    if (clear) {
      analyzed.clear();
      for (const id of [...overlays.keys()]) removeOverlay(id);
    }
    emit();
  }

  function start(ids: readonly string[]): void {
    stop(false);
    ids.forEach((id) => analyzed.add(id));
    route = location.href;
    const timeline = document.querySelector<HTMLElement>('main');
    if (!timeline) return;
    observer = new MutationObserver((records) => {
      const added = records.flatMap((record) => [...record.addedNodes]);
      const removed = records.flatMap((record) => [...record.removedNodes]);
      if (debounce !== undefined) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => collect(added, removed), DEBOUNCE_MS);
    });
    observer.observe(timeline, { childList: true, subtree: true });
  }

  async function extract(ids: readonly string[]): Promise<VisibleCandidate[]> {
    const selected = new Set(ids.slice(0, 8));
    const candidates = (await extractVisibleCandidates(document)).filter((candidate) => selected.has(candidate.id));
    candidates.forEach((candidate) => {
      analyzed.add(candidate.id);
      pending.delete(candidate.id);
    });
    emit();
    return candidates;
  }

  function render(decisions: readonly OverlayDecision[]): void {
    for (const decision of decisions) {
      removeOverlay(decision.candidateId);
      if (decision.label === 'pass') continue;
      const article = articleForId(decision.candidateId);
      if (!article) continue;
      const host = document.createElement('span');
      host.dataset.needleLensOverlay = decision.candidateId;
      host.style.cssText = 'display:block;margin:8px 12px 4px;position:relative;z-index:1;';
      const shadow = host.attachShadow({ mode: 'closed' });
      const confidence = Math.round(Math.max(decision.probability, decision.confidence) * 100);
      const label = decision.label.toUpperCase();
      const heading = decision.label === 'act' ? 'Strong goal match' : decision.label === 'inspect' ? 'Worth inspecting' : 'Uncertain';
      const openProfile = profileUrl(decision.canonicalUrl);
      shadow.innerHTML = `<style>:host{all:initial}details{font:12px/1.35 system-ui,sans-serif;color:#e7e9ea;max-width:360px}summary{display:inline-flex;gap:6px;align-items:center;cursor:pointer;border:1px solid #536471;border-radius:999px;padding:4px 9px;background:#16181c;font-weight:700;list-style:none}summary::-webkit-details-marker{display:none}.body{margin-top:6px;border:1px solid #536471;border-radius:10px;padding:9px;background:#16181c}p{margin:0 0 7px}a,button{color:#8ecdf8;background:none;border:0;padding:0;margin-right:12px;cursor:pointer;text-decoration:underline;font:inherit}</style><details><summary>${label} · ${confidence}%</summary><div class="body"><p><strong>${heading}</strong></p><p>${escapeHtml(decision.reason)}</p><p>${escapeHtml(decision.boundary)}</p>${openProfile ? `<a href="${openProfile}" target="_blank" rel="noreferrer">Open profile</a>` : ''}<button type="button">Dismiss</button></div></details>`;
      shadow.querySelector('button')?.addEventListener('click', () => removeOverlay(decision.candidateId));
      article.appendChild(host);
      overlays.set(decision.candidateId, host);
    }
  }

  return { start, stop, extract, render };
}

export default defineUnlistedScript({
  async main() {
    const scope = globalThis as typeof globalThis & Record<string, unknown>;
    let state = scope[STATE_KEY] as ReturnType<typeof makeState> | undefined;
    if (!state) {
      state = makeState();
      scope[STATE_KEY] = state;
      browser.runtime.onMessage.addListener((value: unknown) => {
        const command = value as ContentCommand;
        if (command.type === 'needle_start_observer') state?.start(command.analyzedIds);
        else if (command.type === 'needle_pause_observer') state?.stop(false);
        else if (command.type === 'needle_finish_session') state?.stop(true);
        else if (command.type === 'needle_render_overlays') state?.render(command.decisions);
        else if (command.type === 'needle_extract_candidates') return state?.extract(command.candidateIds);
      });
    }
    return extractVisibleCandidates(document);
  },
});
