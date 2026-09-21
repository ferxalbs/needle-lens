import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { extractVisibleCandidates } from '../src/extraction/x-visible-posts';

describe('X visible DOM extraction', () => {
  it('keeps eligible near-viewport posts, removes ads and deduplicates status ids', async () => {
    const html = await readFile(fileURLToPath(new URL('./fixtures/home.html', import.meta.url)), 'utf8');
    const window = new Window({ url: 'https://x.com/home' });
    window.document.body.innerHTML = html;
    Object.defineProperty(window, 'innerHeight', { value: 600 });
    const articles = Array.from(window.document.querySelectorAll('article')) as unknown as HTMLElement[];
    articles.forEach((article, index) => {
      Object.defineProperty(article, 'getBoundingClientRect', {
        value: () => ({ top: index * 70, bottom: index * 70 + 60, left: 0, right: 400, width: 400, height: 60 }),
      });
    });
    const candidates = await extractVisibleCandidates(window.document as unknown as Document);
    expect(candidates).toHaveLength(8);
    expect(candidates.some((candidate) => candidate.text.includes('promoted'))).toBe(false);
    expect(new Set(candidates.map((candidate) => candidate.id)).size).toBe(candidates.length);
    expect(candidates[0]?.canonicalUrl).toBe('https://x.com/alice/status/100');
  });

  it('extracts the 30-item synthetic maximum without a long synchronous scan', async () => {
    const window = new Window({ url: 'https://x.com/home' });
    const articles = Array.from({ length: 30 }, (_, index) => {
      const article = window.document.createElement('article');
      article.innerHTML = `<div data-testid="User-Name">user${index}</div><div data-testid="tweetText">Synthetic post ${index} with a concrete detail.</div><a href="https://x.com/user${index}/status/${index + 1000}">post</a>`;
      Object.defineProperty(article, 'getBoundingClientRect', {
        value: () => ({ top: index * 20, bottom: index * 20 + 18, left: 0, right: 400, width: 400, height: 18 }),
      });
      window.document.body.appendChild(article);
      return article;
    });
    expect(articles).toHaveLength(30);

    const started = performance.now();
    const candidates = await extractVisibleCandidates(window.document as unknown as Document);
    const elapsed = performance.now() - started;

    expect(candidates).toHaveLength(30);
    expect(elapsed).toBeLessThan(50);
  });
});
