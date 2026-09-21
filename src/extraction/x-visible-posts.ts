import { MAX_ITEMS, type VisibleCandidate } from '../domain/types';
import { sha256Hex } from '../security/hash';
import {
  canonicalStatusUrl,
  isNearViewport,
  isVisible,
  looksPromotional,
  normalizeAuthor,
  normalizePostText,
  statusIdFromUrl,
} from './normalize';

type CandidateWithPosition = {
  candidate: VisibleCandidate;
  top: number;
  sourceIndex: number;
};

function viewportHeightFor(root: Document): number {
  return root.defaultView?.innerHeight ?? 900;
}

function postUrl(article: Element): string | undefined {
  for (const anchor of Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const canonical = canonicalStatusUrl(anchor.href);
    if (canonical) return canonical;
  }
  return undefined;
}

export async function extractVisibleCandidates(
  root: Document = document,
): Promise<VisibleCandidate[]> {
  const viewportHeight = viewportHeightFor(root);
  const articles = Array.from(root.querySelectorAll<HTMLElement>('article'));
  const seen = new Set<string>();
  const candidates: CandidateWithPosition[] = [];

  for (const [sourceIndex, article] of articles.entries()) {
    if (looksPromotional(article)) continue;
    const rect = article.getBoundingClientRect();
    if (!isNearViewport(rect, viewportHeight)) continue;

    const textNode = article.querySelector<HTMLElement>('[data-testid="tweetText"]');
    const text = normalizePostText(textNode?.textContent ?? '');
    if (!text) continue;

    const canonicalUrl = postUrl(article);
    const statusId = canonicalUrl ? statusIdFromUrl(canonicalUrl) : undefined;
    const identity = statusId ? `status:${statusId}` : `text:${text}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    const id = statusId ? `status_${statusId}` : `hash_${(await sha256Hex(text)).slice(0, 24)}`;
    const author = normalizeAuthor(
      article.querySelector<HTMLElement>('[data-testid="User-Name"]')?.textContent ?? '',
    );
    candidates.push({
      candidate: {
        id,
        source: 'x-visible-dom',
        ...(author ? { author } : {}),
        text,
        ...(canonicalUrl ? { canonicalUrl } : {}),
        viewportState: isVisible(rect, viewportHeight) ? 'visible' : 'near-viewport',
        viewportIndex: sourceIndex,
      },
      top: rect.top,
      sourceIndex,
    });
  }

  return candidates
    .sort((left, right) => left.top - right.top || left.sourceIndex - right.sourceIndex)
    .slice(0, MAX_ITEMS)
    .map(({ candidate }, viewportIndex) => ({ ...candidate, viewportIndex }));
}
