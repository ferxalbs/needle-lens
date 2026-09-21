import type { VisibleCandidate } from '../src/domain/types';
import { canonicalStatusUrl, normalizePostText } from '../src/extraction/normalize';
import { extractVisibleCandidates } from '../src/extraction/x-visible-posts';

type HighlightDecision = {
  candidateId: string;
  label: 'act' | 'inspect';
};

type ContentState = {
  candidates: VisibleCandidate[];
  setCandidates: (candidates: VisibleCandidate[]) => void;
  renderHighlights: (decisions: readonly HighlightDecision[]) => void;
};

const STATE_KEY = '__needleLensContentState';

function isHighlightDecision(value: unknown): value is HighlightDecision {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.candidateId === 'string' &&
    (record.label === 'act' || record.label === 'inspect');
}

function articleForCandidate(candidate: VisibleCandidate): HTMLElement | undefined {
  const articles = Array.from(document.querySelectorAll<HTMLElement>('article'));
  return articles.find((article) => {
    const text = normalizePostText(
      article.querySelector<HTMLElement>('[data-testid="tweetText"]')?.textContent ?? '',
    );
    if (text !== candidate.text) return false;
    if (!candidate.canonicalUrl) return true;
    return Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .some((anchor) => canonicalStatusUrl(anchor.href) === candidate.canonicalUrl);
  });
}

function makeContentState(): ContentState {
  let candidates: VisibleCandidate[] = [];
  let host: HTMLDivElement | undefined;
  let shadow: ShadowRoot | undefined;

  function renderHighlights(decisions: readonly HighlightDecision[]): void {
    if (!host) {
      host = document.createElement('div');
      host.id = 'needle-lens-highlights';
      host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
      document.documentElement.appendChild(host);
      shadow = host.attachShadow({ mode: 'closed' });
    }
    if (!shadow) return;
    while (shadow.firstChild) shadow.firstChild.remove();
    const style = document.createElement('style');
    style.textContent = `
      .needle-highlight { position: fixed; box-sizing: border-box; border: 2px solid; border-radius: 12px;
        padding: 3px 7px; font: 700 10px/1.1 system-ui, sans-serif; letter-spacing: .08em;
        color: #fff; text-shadow: 0 1px 2px #000; background: rgba(15, 23, 42, .78); }
      .act { border-color: #34d399; } .inspect { border-color: #fbbf24; }
    `;
    shadow.appendChild(style);
    for (const decision of decisions) {
      const candidate = candidates.find((item) => item.id === decision.candidateId);
      const article = candidate ? articleForCandidate(candidate) : undefined;
      if (!article) continue;
      const rect = article.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const badge = document.createElement('div');
      badge.className = `needle-highlight ${decision.label}`;
      badge.style.left = `${Math.max(4, rect.left + 6)}px`;
      badge.style.top = `${Math.max(4, rect.top + 6)}px`;
      badge.textContent = decision.label === 'act' ? 'ACT' : 'INSPECT';
      badge.setAttribute('aria-label', decision.label === 'act' ? 'Worth acting on' : 'Worth inspecting');
      shadow.appendChild(badge);
    }
  }

  return {
    get candidates() {
      return candidates;
    },
    setCandidates(next) {
      candidates = next;
    },
    renderHighlights,
  } as ContentState;
}

export default defineUnlistedScript({
  async main() {
    const scope = globalThis as typeof globalThis & Record<string, unknown>;
    let state = scope[STATE_KEY] as ContentState | undefined;
    if (!state) {
      state = makeContentState();
      scope[STATE_KEY] = state;
      browser.runtime.onMessage.addListener((message: unknown) => {
        if (typeof message !== 'object' || message === null) return;
        const record = message as Record<string, unknown>;
        if (record.type !== 'highlight_decisions' || !Array.isArray(record.decisions)) return;
        const decisions = record.decisions.filter(isHighlightDecision);
        state?.renderHighlights(decisions);
      });
    }
    const candidates = await extractVisibleCandidates(document);
    state.setCandidates(candidates);
    return candidates;
  },
});
