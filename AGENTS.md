# Repository Guidelines

## Project Structure & Module Organization

Needle Lens is a local-first Chromium MV3 extension built with WXT and React. Extension entry points live in `entrypoints/`: `background.ts` owns trusted service-worker work, `visible.ts` extracts rendered X content, and `sidepanel/` and `settings/` contain the React interfaces. Core TypeScript is organized by responsibility under `src/`, including `domain/`, `extraction/`, `provider/`, `runtime/`, `security/`, and `cache/`. Static icons belong in `public/`; documentation belongs in `docs/`. Unit tests are in `tests/*.test.ts`, browser tests in `tests/e2e/`, and HTML fixtures in `tests/fixtures/`.

## Build, Test, and Development Commands

- `bun install` installs dependencies and prepares WXT types.
- `bun run dev` starts the WXT development build.
- `bun run lint` enforces repository source policies.
- `bun run compile` runs strict TypeScript checking without emitting files.
- `bun test` runs the Vitest unit suite; `bun run test:watch` reruns it during development.
- `bun run test:e2e` runs all Playwright tests. Use `test:e2e:chrome` for the side-panel smoke test or `test:e2e:live` for the credential-dependent provider flow.
- `bun run build` creates `.output/chrome-mv3`; `bun run verify` runs the static release gate.

## Coding Style & Naming Conventions

Follow existing TypeScript and React conventions: two-space indentation, single quotes, semicolons, functional components, and explicit types at trust boundaries. Use `camelCase` for variables and functions, `PascalCase` for React components and domain types, and kebab-case filenames such as `decision-cache.ts`. Prefer the configured `#components`, `#ui`, and `#lib` aliases for side-panel imports. Keep provider responses validated and security-sensitive logic in `src/security/` or the background boundary.

## Testing Guidelines

Use Vitest for deterministic domain, extraction, cache, protocol, and orchestration behavior. Name unit files `<subject>.test.ts` and Playwright files `<flow>.spec.ts`. Extend the closest existing test and fixture before adding new infrastructure. There is no numeric coverage threshold; every behavior change should include focused regression coverage. Never commit API keys or captured provider responses.

## Commit & Pull Request Guidelines

History primarily uses Conventional Commit subjects, for example `feat(security): add hashing and redaction utilities`. Use an imperative, scoped subject (`feat:`, `fix:`, `docs:`, or `test:`) and keep each commit focused. Pull requests should explain the user-visible change, security or permission impact, and verification commands run; link relevant issues and include screenshots for side-panel or settings UI changes.
