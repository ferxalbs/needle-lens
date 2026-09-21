import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, chromium } from '@playwright/test';

const chromeExecutablePath = process.env.NEEDLE_CHROME_PATH
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browsers = process.env.CI && !existsSync(chromeExecutablePath)
  ? [{ name: 'CI Chromium', executablePath: chromium.executablePath() }]
  : [{ name: 'Google Chrome', executablePath: chromeExecutablePath }];

for (const target of browsers) {
  test(`${target.name} can load the built React/Base UI side panel`, async ({}, testInfo) => {
    test.skip(!existsSync(target.executablePath), `${target.name} is not installed at the local executable path.`);
    const extensionPath = join(process.cwd(), '.output/chrome-mv3');
    test.skip(!existsSync(extensionPath), 'Build the extension before running the browser smoke test.');
    const context = await chromium.launchPersistentContext(testInfo.outputPath(`${target.name.replaceAll(' ', '-')}-profile`), {
      executablePath: target.executablePath,
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const extensionId = new URL(worker.url()).host;
      const uiCapability = await worker.evaluate(async () => ({
        sidePanel: typeof browser.sidePanel,
        actionPopup: typeof browser.action?.getPopup === 'function'
          ? await browser.action.getPopup({})
          : '',
      }));
      expect(uiCapability.sidePanel).toBe('object');
      expect(uiCapability.actionPopup).toBe('');
      const providerProbe = await worker.evaluate(async () => {
        const response = await fetch('https://api.typesafe.ai/v1/systemone', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: 'Bearer invalid-key-for-mv3-probe',
            'Content-Type': 'application/json',
          },
          body: '{}',
        });
        return { status: response.status, body: (await response.text()).slice(0, 400) };
      });
      expect(providerProbe.status).toBe(401);
      expect(providerProbe.body).toMatch(/authentication_error|authenticate/i);
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      await expect(page.getByRole('heading', { name: 'Needle Lens' })).toBeVisible();
      await expect(page.getByText('Read visible posts on x.com')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Grant access to X' })).toBeVisible();
      await expect(page.getByText('Bring your own TypeSafe key')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test(`${target.name} clears the session key after a browser restart`, async ({}, testInfo) => {
    test.skip(!existsSync(target.executablePath), `${target.name} is not installed at the local executable path.`);
    const extensionPath = join(process.cwd(), '.output/chrome-mv3');
    test.skip(!existsSync(extensionPath), 'Build the extension before running the browser smoke test.');
    const profilePath = testInfo.outputPath(`${target.name.replaceAll(' ', '-')}-restart-profile`);
    const launch = () => chromium.launchPersistentContext(profilePath, {
      executablePath: target.executablePath,
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    let context = await launch();
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const extensionId = new URL(worker.url()).host;
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      await expect(page.getByRole('button', { name: 'Grant access to X' })).toBeVisible();
      await context.close();

      context = await launch();
      const restartedWorker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const restartedPage = await context.newPage();
      await restartedPage.goto(`chrome-extension://${new URL(restartedWorker.url()).host}/sidepanel.html`);
      await expect(restartedPage.getByRole('button', { name: 'Grant access to X' })).toBeVisible();
      await expect(restartedPage.getByText(/session ·/)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}
