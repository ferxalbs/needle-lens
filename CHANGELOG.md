# CHANGELOG

All notable changes to Needle Lens are documented here.

## [0.1.0] - 2026-09-20

### Added

- React 19 side-panel UI built with WXT and `@base-ui/react` primitives.
- Goal-driven analysis of the X posts already visible in the active tab.
- Session-only TypeSafe-compatible BYOK storage with local fingerprinting, explicit forget, and browser-restart clearing.
- One-request Jev adapter with Valibot response validation, deterministic policy scoring, bounded hashed decision cache, and receipt history.
- Conservative visible-post extraction, fail-closed X URL checks, minimal MV3 permissions, redacted errors, and no raw-post cache values.
- Unit, integration, source-policy, manifest, performance, and Playwright MV3 smoke coverage.

### Changed

- Replaced the former Preact starter UI with React-only entrypoints and `react-dom`.
- Selected TypeScript 7.0.2 with strict boundary settings and plain CSS design tokens.
- Added a Chrome-specific unpacked-extension smoke path using the installed Google Chrome executable; `NEEDLE_CHROME_PATH` overrides the default macOS path.
- Added a CI-only managed-Chromium fallback when Google Chrome is unavailable on the runner.

### Security

- API keys remain in `chrome.storage.session` under trusted-context access and are never returned to content scripts or receipts.
- The provider host is restricted to `https://api.typesafe.ai/*`; the extension does not use a proxy, X API, crawling, automated navigation, or background collection.

### Verification

- `bun run verify` passes: source policy, TypeScript compile, 25 Vitest tests, production build, manifest checks, and performance budgets.
- Added `bun run test:e2e:chrome` as the Chrome-specific smoke harness; the final Chrome UI/service-worker run is intentionally left for the operator's manual verification.

### Known limitation

- Live provider verification requires an operator-supplied key; credentials and provider responses are not part of the repository.
