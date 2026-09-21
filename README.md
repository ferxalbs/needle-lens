# Needle Lens

Needle Lens is a small, local-first Chromium MV3 side-panel extension. It turns the public X posts already rendered in the active tab into a short, goal-directed session. The extension uses a personal TypeSafe AI key (BYOK), sends one consented Jev `systemOne` request for uncached candidates, applies a deterministic local policy, and records a session receipt.

Needle Lens does not crawl X, scroll, click, post, follow, message, read DMs, or run in the background while the panel is closed. It is deliberately a judgment aid for the information already in front of the user.

## Stack

- WXT + Manifest V3
- React 19 with `@wxt-dev/module-react`
- `@base-ui/react` 1.8 for the side-panel controls, styled with local CSS tokens
- `@typesafe-ai/sdk` 0.6 for the official Jev `systemOne` client (Node >=20-compatible and statically checked for MV3 service-worker use)
- TypeScript 7, Bun, plain CSS design tokens
- Valibot provider-boundary validation
- Existing Vitest/Playwright scripts for operator verification (not part of the static release gate)

## Development

```sh
bun install
bun run lint
bun run compile
bun run build
bun run check:manifest
bun audit --production
```

The release gate is intentionally static: source policy, TypeScript, production build, manifest, performance, and dependency audit. `bun run dev` starts WXT's development build. Runtime/browser/provider checks are not part of the release gate because the extension boundary must remain user-controlled and the provider requires a user-supplied key.

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
3. Open **Settings**, create or choose a Lens, and set its goal, target/evidence criteria, exclusions, strictness, candidate cap (1–30), and action cap (1–3). A safe Jev infrastructure-prospect example is restored by default.
4. Preview the eligible visible posts. Preview performs extraction and cache inspection only; it does not call the provider. Zero eligible candidates is a recoverable empty state; there is no eight-post minimum.
5. Enter a TypeSafe-compatible API key in Settings. Session-only retention is the default. The optional seven-day mode uses an AES-GCM encrypted envelope and a non-extractable browser key when the browser can persist it; otherwise it fails closed to session-only retention. The raw key never reaches page JavaScript or the UI after save.
6. Review the exact data-use notice and press **Send one decision request**. After consent, the trusted service worker sends one HTTPS `systemOne` request containing only the Lens criteria and rendered candidate text needed for uncached candidates.
7. Review the typed decision cards. The local policy may surface zero to three manual **ACT** or **INSPECT** suggestions, with **PASS** and **UNCERTAIN** outcomes retained in the receipt. Declare an outcome and copy the session receipt if useful.

## Security boundaries

The content boundary extracts only text, author, a canonical X status URL for a user-clicked link, and viewport metadata. It never sees the API key. The service worker validates messages and provider responses, performs the allowlisted HTTPS request, keeps only hashed cache keys and typed signals under the selected off/session/24-hour retention policy, and redacts provider errors. See [the permission rationale](docs/permissions.md) and [the privacy note](docs/privacy.md).

## Current verification

The repository includes source-policy, TypeScript, production-build, manifest, performance, and dependency-audit checks. A live provider session requires a key supplied locally; never commit credentials or provider responses.
