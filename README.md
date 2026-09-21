# Needle Lens

Needle Lens is a small, local-first Chromium MV3 side-panel extension. It turns the public X posts already rendered in the active tab into a short, goal-directed session. The extension uses a personal TypeSafe AI key (BYOK), sends one consented Jev request for uncached posts, applies a deterministic local policy, and records a session receipt.

Needle Lens does not crawl X, scroll, click, post, follow, message, read DMs, or run in the background while the panel is closed. It is deliberately a judgment aid for the information already in front of the user.

## Stack

- WXT + Manifest V3
- React 19 with `@wxt-dev/module-react`
- `@base-ui/react` 1.8 for accessible headless Button and Select primitives, styled with local CSS tokens
- TypeScript 7, Bun, plain CSS design tokens
- Valibot provider-boundary validation
- Vitest unit/integration tests and Playwright Google Chrome smoke tests

## Development

```sh
bun install
bun run lint
bun run compile
bun run test
bun run build
bun run check:manifest
bun run test:e2e
```

`bun run verify` runs compile, unit tests, production build, and manifest checks. `bun run dev` starts WXT's development build.

The Chrome-specific smoke harness targets the installed Google Chrome executable at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Set `NEEDLE_CHROME_PATH` when Chrome is installed elsewhere. GitHub Actions uses Playwright's managed Chromium only when Google Chrome is unavailable on the runner. This handoff leaves the final browser check to the operator's manual Chrome run.

### Package for the Chrome Web Store

Run the packaging command:

```sh
bun run zip
```

This creates a production Chrome MV3 package at `.output/needle-lens-<version>-chrome.zip`. Upload that ZIP in the Chrome Web Store Developer Dashboard; the generated archive has `manifest.json` at its root.

The browser smoke test launches Google Chrome directly, loads `.output/chrome-mv3` as an unpacked MV3 extension, and exercises the React/Base UI session-key lifecycle. To inspect the extension manually, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `.output/chrome-mv3`.

## User flow

1. Open X normally and keep the target posts visible.
2. Open Needle Lens from the extension action and press **Grant access to X**. The panel requests only the exact `x.com` and `www.x.com` optional origins, then verifies the active HTTPS X tab.
3. Preview the eligible visible posts. Preview performs extraction and cache inspection only; it does not call the provider. The key step appears only after enough candidates are extracted.
4. Paste a TypeSafe-compatible API key. The key is held only in `chrome.storage.session`, is never returned to the UI after save, and is cleared by **Forget key**, **Clear session**, browser restart, or authentication failure.
5. Confirm the handoff. The side panel names the exact fields leaving the browser, then the service worker sends one HTTPS request for uncached candidates.
6. Review at most three `ACT` or `INSPECT` cards, optionally open the original post, declare an outcome, and copy the session receipt.

## Security boundaries

The content boundary extracts only text, author, a canonical X status URL for local navigation, and viewport metadata. It never sees the API key. The service worker validates messages and provider responses, performs the allowlisted HTTPS request, keeps only hashed cache keys and signals in session storage, and redacts provider errors. See [the permission rationale](docs/permissions.md) and [the privacy note](docs/privacy.md).

## Current verification

The repository includes source-policy, TypeScript, unit-test, production-build, manifest, performance, and Chrome smoke checks. A live provider session requires a key supplied locally; never commit credentials or provider responses.
