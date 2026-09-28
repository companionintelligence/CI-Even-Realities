# Changelog

Notable changes to `ci-even-realities`. Format loosely follows [Keep a
Changelog](https://keepachangelog.com/); versions refer to `ci-glasses-app/app.json`
(the Even Hub portal manifest — see [`PUBLISHING.md`](PUBLISHING.md)). `agent-hub`
ships as source/Docker image, not through the portal, and is versioned separately
via its own `package.json` / Docker tag.

## Unreleased

### Added

- **`er-connect` Quick Connect generator** — the setup/connect page now has
  a live config generator: type your Hub host once and it renders the exact
  Backend URL / Backend Kind / Model for all five CI-Hub presets (Assistant,
  Ollama, Hermes, OpenClaw, Memory), each with a copy button. Computed
  client-side, mirroring `ci-glasses-app/src/config/HubPresets.ts`'s
  `hubHost()` normalization and preset table exactly — no network calls.
- **`er-connect` "How it works" diagram + real screenshots** — a
  Mermaid-rendered flow diagram (glasses → phone → backend → AI) and a "See
  it in action" section using the current-brand Chat/Settings screenshots
  (the same ones the main README uses). `_headers`' CSP now allows
  `cdn.jsdelivr.net` in `script-src` for the Mermaid library.
- **Mermaid diagrams in docs** — the main README's ASCII architecture
  diagram is now a Mermaid flowchart (GitHub renders it inline); `er-connect/README.md`
  gained a deploy-decision flowchart (Option A/B/C/D).
- **`er-connect/README.md` Option D** — a complete `wrangler` CLI command
  sequence (login → create project → deploy → attach custom domain) for
  deploying straight from a terminal, no Cloudflare dashboard clicking.
- **`docs/ci-pipeline.md`** (new, hand-maintained) — documents what each
  GitHub Actions workflow does, with a Mermaid diagram and exact `gh workflow
  run` commands. Kept separate from the generated `docs/CI.md`, which says
  not to hand-edit it.
- **`er-connect` sign-in + auto-connect** — a real Authorization Code + PKCE
  flow against CI-Portal (mirroring `ci-glasses-app/src/auth/OidcClient.ts`),
  wired into the existing Quick Connect section. Once signed in with a Hub
  host entered, both are remembered (`localStorage`) and reconnect
  automatically on the next visit — no clicks needed. Needs a CI-Portal
  `PUBLIC_CLIENTS` entry for `ci-er-connect` before sign-in works end to end;
  see `er-connect/README.md`.

### Fixed

- Flagged `ci-glasses-app/assets/screenshots/*.png` (used by `PUBLISHING.md`'s
  store-listing checklist) as stale — they predate the sage brand migration
  and visually mismatch the current app. Added a pre-flight checklist item
  and a `ROADMAP.md` note; recapturing them needs simulator/device access
  this session doesn't have.
- **`er-connect` is deployed and live** at `er.ci.computer`. Turned out
  `wrangler pages project create`/`deploy` no longer create or target
  classic Cloudflare Pages projects (as of wrangler 4.143.0) — they're
  Cloudflare Workers with static assets now, and `wrangler pages deploy`
  fails against one (`The Pages project ... does not exist`). Switched to
  plain `wrangler deploy`, reading the Worker name, assets directory, and
  the `er.ci.computer` custom-domain route from a committed
  `er-connect/wrangler.jsonc`; updated `deploy-er-connect.yml` to match.
  `er-connect/README.md`'s four-option deploy flowchart is gone, replaced
  with the two paths that actually apply now (local `wrangler deploy`, or
  the GitHub Actions workflow).

## [0.5.0] — Even Hub SDK 0.0.16, native long-press, CI-Server hardening

### Changed

- **Even Hub SDK bumped `0.0.10` → `0.0.16`** (`ci-glasses-app`). Purely additive
  for this codebase — no breaking API changes affect `ci-glasses-app`'s usage
  (verified by diffing the two versions' type declarations). `app.json`'s
  `min_sdk_version` and `min_app_version` are bumped to match the SDK's own
  declared floor (`0.0.16` / `2.2.10`).

### Added

- **Native long-press gesture** — `Main.ts` now wires the SDK's
  `OsEventTypeList.LONG_PRESS_EVENT` / `LONG_PRESS_RELEASE_EVENT` (new in
  `0.0.16`) directly to mic start/stop, in addition to the existing
  `FOREGROUND_ENTER/EXIT_EVENT` fallback kept for firmware/simulator paths
  that still route the gesture that way.
- **CI-Server recall/write-back timeout** — `agent-hub`'s `MemoryAdapter` and
  `withMemoryAugment` middleware now abort a CI-Server `/memory/recall` or
  `/memory/turn` call that hasn't responded within `CI_SERVER_TIMEOUT_MS`
  (default 8s), via a new shared `fetchWithTimeout` helper. A hung or
  unreachable CI-Server can no longer stall a `use_memory` chat turn
  indefinitely, or leak a socket on the fire-and-forget write-back.
- **`agent-hub` CI coverage** — `.github/workflows/ci.yml` gained an
  `agent-hub` job (typecheck + unit tests), alongside the existing
  `ci-glasses-app` job. Still dispatched manually per the repo's
  [CI cost-gating policy](docs/CI.md).
- Explicit `AudioInputSource.Glasses` passed to `audioControl()` in
  `MicCapture.ts`, using the SDK's new optional mic-source parameter.
- **`er-connect/`** — a public static "Setup & Connect" page for CI Companion
  (install, backend-connect steps, manual config, supported backend kinds),
  with a Cloudflare Pages deploy workflow
  (`.github/workflows/deploy-er-connect.yml`). Meant to be served at
  `er.ci.computer`; the custom domain still needs one-time Cloudflare
  dashboard setup — see `er-connect/README.md`.

### Fixed

- Stale documentation: README SDK/TypeScript/Vite badges, `ROADMAP.md`
  checkmarks for already-shipped work (Markdown stripping, CI pipeline,
  ESLint config), and `PUBLISHING.md`'s manifest snippet and test count.

## Unreleased / earlier work

Everything before this entry predates the changelog. See `git log` and
`ROADMAP.md`'s checked items for prior history (BLE display retry, agent-hub
subprocess timeouts, SSE stream resume, CI-Portal OIDC sign-in, CI-Hub
quick-connect, PolyForm Noncommercial licensing, CI-Common canon 1.0 styling).
