# Changelog

Notable changes to `ci-even-realities`. Format loosely follows [Keep a
Changelog](https://keepachangelog.com/); versions refer to `ci-glasses-app/app.json`
(the Even Hub portal manifest — see [`PUBLISHING.md`](PUBLISHING.md)). `agent-hub`
ships as source/Docker image, not through the portal, and is versioned separately
via its own `package.json` / Docker tag.

## Unreleased

### Added

- **`er-connect` rebuilt as a real Vite + React app** on the canonical
  `@companionintelligence/ui` component kit and `@companionintelligence/tokens`
  (real CI phthalo/sage palette and logo mark, instead of hand-approximated
  hex values — see `er-connect/README.md`'s "Why a build step"). IA
  redesigned around an `AppCard` + `QrCode` install step, a `Stepper`
  (Install → Connect → Talk) carrying the CI-Portal sign-in (Authorization
  Code + PKCE, mirroring `ci-glasses-app/src/auth/OidcClient.ts`) and
  CI-Hub connect probe, with auto-reconnect on return visits
  (`localStorage`) — and a tabbed `Dialog` "Help" modal holding everything
  explanatory (how it works, screenshots, manual backend config, supported
  Backend Kinds, troubleshooting) out of the main flow. Needs a CI-Portal
  `PUBLIC_CLIENTS` entry for `ci-er-connect` before sign-in works end to
  end; see `er-connect/README.md`.
- **Mermaid diagrams in docs** — the main README's ASCII architecture
  diagram is now a Mermaid flowchart (GitHub renders it inline).
- **`docs/ci-pipeline.md`** (new, hand-maintained) — documents what each
  GitHub Actions workflow does, with a Mermaid diagram and exact `gh workflow
  run` commands. Kept separate from the generated `docs/CI.md`, which says
  not to hand-edit it.

### Fixed

- **er-connect: the Connect status overflowed its card.** Found verifying the
  0.5.2 deploy on the live site: the explanation for a plain-http hub sat inside
  a single-line status pill, so the page scrolled sideways and the message was
  cut off. The pill now carries a short "Saved http://<host>:8787 — not verified"
  label, the explanation is a wrapping paragraph beneath it, and the pill itself
  wraps (`break-all`) so a long Tailscale MagicDNS name no longer runs off the
  card — that overflow already affected "Connected: …" / "Unreachable: …".
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

### er-connect: cross-links and audit fixes

- **Cross-links to the rest of Companion Intelligence.** The header logo and a
  footer link go to <https://ci.computer>; the hero and the Connect step carry
  **Buy Companion Core** (<https://ci.computer/core>) and **Download Companion**
  (<https://ci.computer/download>); **Docs** links to the matching docs page; the
  footer adds Support, Privacy and Terms. All URLs live in `er-connect/src/links.ts`.
- **No more promises the product cannot keep.** The Install step claimed an Even
  Hub store listing, a QR code and a sideloadable `.ehpk`. None exists (the docs
  say developer preview), so the step now says so and links the docs install steps
  and Discord. Links to the private GitHub repo (404 for visitors) are gone, the
  JSON-LD no longer declares a `SoftwareApplication`, and customer-facing copy
  says Companion Hub / Companion Memory instead of repo names.
- **Works without JavaScript and when blocked.** `index.html` carries a static
  shell (header, hero, callouts, footer, `<noscript>` note) so crawlers and
  restrictive webviews see content and working links. Manrope is self-hosted, the
  Help dialog loads on demand, React is its own cached chunk, and a dead
  `lucide-react` re-export is stripped from the icons package: the JS dropped
  from ~1.19 MB to ~440 KB. Screenshots are WebP with dimensions; hashed output
  under `/static/` is cached immutable; HSTS added.
- **Sign-in hardening.** Tokens moved from `localStorage` to `sessionStorage`
  and `offline_access` was dropped (the page only shows who is signed in, and
  Google's tag runs on the same origin). All storage access is guarded (a throwing
  `localStorage` used to blank the page), there is a top-level error boundary,
  `boot()` can no longer leave an unhandled rejection, a denied-consent redirect
  (`?error=…&state=…`) now shows its message and the query string is always
  stripped, and a blocked token request says what happened instead of "Failed to
  fetch".
- **Branded 404 and metadata.** The 404 page shares the app's CSS and links back to
  ci.computer. Icons, favicon (`.ico` + SVG), web manifest and OG image are
  regenerated from the CI-Common mark; the sitemap no longer carries a stale
  `<lastmod>`.
- **Build-time checks.** `npm run build` now ends with `scripts/check-dist.mjs`
  (cross-links, SEO tags, JSON-LD, GA4 exactly once, CSP, bundle budget), and
  `ci.yml` gained an `er-connect` typecheck and build job.
- **Deploy workflow.** `deploy-er-connect.yml` pins wrangler 4 (3.x fails the
  assets-only config with "Missing entry-point"), fails fast with a clear message
  when `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` are missing, and verifies
  the live site afterwards. The secrets still have to be added by someone with
  access.
- **Docs.** Even Hub links use `hub.evenrealities.com` (the developer console is
  `/hub`); the store-listing copy says source-available rather than open source,
  scopes "no telemetry" to the glasses app, and uses ci.computer/support as the
  support URL.

## [0.5.2] — Companion teal-navy redesign of the phone UI

### Changed

- **The phone WebView now actually looks like Companion.** It was painted from
  a legacy near-black palette held in two hand-copied token blocks (the drift
  CI-Common's `CONSUMING.md` forbids), so it read as generic dark UI rather
  than Companion's teal-navy. `styles.css` now imports
  `@companionintelligence/tokens/tokens.css`, keeps only thin `--color-*`
  aliases onto canon names (`--ci-bg`, `--ci-card`, `--ci-bg-deep`,
  `--ci-surface`, `--ci-border`, `--primary`, `--gradient-aurora`, …) and
  `index.html` sets `class="dark"` on `<html>` (tokens.css's `:root` is the
  *light* palette). The splash uses the real logo from `icon.png` instead of a
  hand-drawn SVG. The only literal colour left is the black GLASSES DISPLAY
  preview, which imitates the G2 MicroLED panel on purpose.
- Store screenshots, `README.md`, `docs/ui/` and the er-connect Help dialog now
  show the new look (all were the old near-black UI).

### Added

- `theme-tokens.test.ts` fails on any `var(--x)` that neither `styles.css` nor
  the installed canon `tokens.css` defines. A first pass aliased surfaces onto
  `--ci-surface-2` / `--ci-border-3`, which exist only in the Tailwind-flavoured
  `globals.css` this build doesn't import — the app rendered with no card
  fills, borders or chip outlines and every source-level check still passed.
- `PUBLISHING.md` **Release runbook (macOS)**: install → verify → `evenhub
  login` → `pack --check` → `pack:ehpk` → portal upload → tag → on-device
  verification.
- `er-connect/README.md` **Test sign-in end to end** and a failure table.

### Fixed

- **er-connect's Connect step reported a false "Unreachable".** It probes
  `http://<host>:8787` from `https://er.ci.computer`, and browsers refuse
  plain-http requests from an https page. Measured against the live site with a
  server answering on every address: the same `fetch` resolved from an http page
  and was rejected from er.ci.computer for a LAN IP, `127.0.0.1` and `localhost`.
  Non-loopback http hosts are no longer fetched — the host is saved and the page
  says it can't verify it from here and to use Quick connect in the app; a
  loopback failure from an https page is treated the same way; real failures
  (an http page, or an https hub) still show as errors. **Needs an er-connect
  redeploy** (`wrangler deploy`) to take effect on er.ci.computer.
- **The store listing (and README/planning docs) said a single ring tap approves
  an agent permission prompt. It is the opposite:** a double-tap approves and a
  single tap denies — deliberately, so an accidental brush of the touchbar can
  never approve a Bash command (`Main.ts`, `GlassesRenderer.showPromptCard`,
  which prints `2×tap: approve · tap: deny`). Corrected in
  `docs/store-listing.md` (the copy that gets pasted into the portal),
  `PUBLISHING.md`, `README.md` and `planning.md`.
- er-connect's README said the `ci-er-connect` OIDC client still needed
  registering; it is registered and deployed (redirect pinned to
  `https://er.ci.computer/`).
- Removed `er-connect/public/assets/preview.png`, an unreferenced leftover of
  the old near-black page that was being served publicly.

## [0.5.1] — Responses-API fallback fix, refreshed store screenshots

### Fixed

- **"Responses API error 404" against `agent-hub` and other OpenAI-compatible
  servers.** In `auto` API mode the app probed `OPTIONS /v1/responses` and
  treated any 2xx as "supported", but servers with global CORS handling answer
  a preflight 2xx for *every* path, so it picked an endpoint that doesn't exist
  and every message failed. `ApiAdapter` now retries the turn on Chat
  Completions when the real request returns 404/405/501 (and remembers it); real
  errors and an explicit `responses` mode still surface. `agent-hub` also
  answers preflight 204 only for routes it serves. Found running the app in the
  Even Hub simulator against the hub.
- Docs said the default OIDC client is `ci-hub`; it is `ci-even`.

### Changed

- Store-listing screenshots recaptured on the current sage brand (the previous
  set predated the canon migration). Dropped `07-beta1-settings.png`, which
  showed a private Tailscale address.

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
