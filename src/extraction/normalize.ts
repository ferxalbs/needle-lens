export function normalizePostText(value: string): string {
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeAuthor(value: string): string | undefined {
  const parts = value
    .split(/\n+/)
    .map((part) => normalizePostText(part))
    .filter(Boolean);
  return parts[0] || undefined;
}

export function statusIdFromUrl(value: string): string | undefined {
  const match = value.match(/\/status\/(\d+)/i);
  return match?.[1];
}

export function canonicalStatusUrl(value: string): string | undefined {
  try {
    const url = new URL(value, 'https://x.com');
    if (url.protocol !== 'https:' || !['x.com', 'www.x.com'].includes(url.hostname)) {
      return undefined;
    }
    const statusId = statusIdFromUrl(url.pathname);
    if (!statusId) return undefined;
    return `https://x.com${url.pathname.split('/status/')[0]}/status/${statusId}`;
  } catch {
    return undefined;
  }
}

export function looksPromotional(article: Element): boolean {
  if (article.matches('[data-testid*="promot"], [aria-label*="Promoted" i]') ||
    article.querySelector('[data-testid*="promot"], [aria-label*="Promoted" i]')) {
    return true;
  }
  const labelText = normalizePostText(article.textContent ?? '').slice(0, 240);
  return /(^|\s)(promoted|sponsored|ad)(?=[\s:,.]|$)/i.test(labelText);
}

export function isNearViewport(rect: DOMRect, viewportHeight: number): boolean {
  return rect.width > 0 && rect.height > 0 && rect.bottom >= -200 && rect.top <= viewportHeight + 200;
}

export function isVisible(rect: DOMRect, viewportHeight: number): boolean {
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < viewportHeight;
}
