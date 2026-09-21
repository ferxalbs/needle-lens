import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, chromium } from '@playwright/test';
import type { VisibleCandidate } from '../../src/domain/types';
import { buildJevRequest } from '../../src/provider/contract';
import { normalizeAnswers } from '../../src/provider/jev-adapter';

const providerKey = process.env.NEEDLE_TYPESAFE_API_KEY;
const chromeExecutablePath = process.env.NEEDLE_CHROME_PATH
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browserTargets = [
  chromeExecutablePath,
  ...(process.env.CI ? [chromium.executablePath()] : []),
];
const executablePath = browserTargets.find(existsSync);

const candidates: VisibleCandidate[] = Array.from({ length: 30 }, (_, index) => ({
  id: `live_fixture_${index}`,
  source: 'x-visible-dom',
  text: `Synthetic live-provider fixture ${index}: a concrete request for help with a reproducible workflow.`,
  viewportState: 'visible',
  viewportIndex: index,
}));

test('one MV3 service-worker request validates a real 240-question Jev response', async ({}, testInfo) => {
  test.skip(!providerKey, 'Set NEEDLE_TYPESAFE_API_KEY to run the opt-in live provider check.');
  test.skip(!executablePath, 'Google Chrome is not installed at the expected path.');
  const extensionPath = join(process.cwd(), '.output/chrome-mv3');
  test.skip(!existsSync(extensionPath), 'Build the extension before running the live provider check.');
  const browserExecutable = executablePath!;

  const request = buildJevRequest(candidates, 'Find people who can help with a concrete workflow problem.', 'find_people');
  const context = await chromium.launchPersistentContext(testInfo.outputPath('live-provider-profile'), {
    executablePath: browserExecutable,
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const response = await worker.evaluate(async ({ apiKey, body }) => {
      const started = performance.now();
      const result = await fetch('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
      });
      return {
        status: result.status,
        body: await result.text(),
        latencyMs: Math.round(performance.now() - started),
      };
    }, { apiKey: providerKey!, body: JSON.stringify(request) });
    expect(response.status).toBe(200);
    const normalized = normalizeAnswers(JSON.parse(response.body) as unknown, candidates);
    expect(normalized.signalsByCandidateId.size).toBe(30);
    expect(response.latencyMs).toBeGreaterThanOrEqual(0);
  } finally {
    await context.close();
  }
});
