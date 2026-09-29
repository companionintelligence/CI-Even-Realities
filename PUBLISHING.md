# Publishing — Even Hub App Store

End-to-end guide for shipping `ci-glasses-app` to the Even Hub portal. The companion `agent-hub` is **not** distributed through the portal — it's a separate Node service users run on their LAN.

---

## Release runbook (macOS)

Everything runs on your Mac, in Terminal. Steps marked **(you)** need your Even
Realities account or the portal UI and cannot be done by a script or an agent.
`evenhub-cli` has `login`, `init`, `pack` and `qr` — **no `publish`** — so the
upload is always a manual step in the portal.

**Prerequisites:** Node 20.19+ (what CI uses), `gh` logged in (`gh auth status`) —
`@companionintelligence/*` packages come from the private GitHub Packages
registry — and an Even Realities developer account.

### 1. Get the release commit

```bash
git checkout main && git pull --ff-only
cd ci-glasses-app
```

### 2. Install (private registry auth)

`.npmrc` reads `NODE_AUTH_TOKEN` for `npm.pkg.github.com`; your `gh` token works:

```bash
export NODE_AUTH_TOKEN="$(gh auth token)"
npm ci
```

A `401`/`403` on install means the token lacks package access:
`gh auth refresh -s read:packages`, then re-export and retry.

### 3. Verify

```bash
npm test && npm run typecheck && npm run lint && npm run lint:canon
```

All four must pass. `lint:canon` prints a few non-blocking "used but never
defined" warnings for `--primary`, `--destructive`, `--radius-*` etc.: the gate
does not follow the `@import` of the token package, and
`src/ui/__tests__/theme-tokens.test.ts` is what actually checks those names.

### 4. Log in to Even Hub (you)

```bash
npx evenhub login -e you@example.com
```

Use the email of your Even Realities developer account and follow the prompts.
Credentials are stored locally by the CLI. Confirm with step 5 — `pack --check`
fails with "Not authenticated" if the login didn't take.

### 5. Check the package id

```bash
npm run pack:check
```

This builds, then runs `evenhub pack … --check`, which the CLI documents as
"check if the package id is available". `com.companionintelligence.ciglasses`
is our id. If you already uploaded an earlier version, the id may report as
taken by you; that is expected for an *update* (not verified against the CLI —
if in doubt, continue and let the portal validate).

### 6. Build the package

```bash
npm run pack:ehpk
ls -lh ci-companion.ehpk      # ~165 KB for 0.5.2; gitignored on purpose
open -R ci-companion.ehpk     # reveal it in Finder
```

`ci-companion.ehpk` is a binary with an `EHPK` magic header, not a zip.

### 7. Upload (you)

```bash
open https://evenhub.evenrealities.com/
open assets/screenshots       # the six store screenshots, ready to drag in
```

In the portal: sign in → **Apps** → **New** (first release) or your existing
CI Companion → upload `ci-companion.ehpk`. Fill the listing from
[`docs/store-listing.md`](docs/store-listing.md) — name, tagline, description,
categories, the six screenshots from `ci-glasses-app/assets/screenshots/` in
order, icon `ci-glasses-app/assets/icons/icon-1024.png`, and the "Release notes"
block for this version. Submit for review. (Button and menu labels here are from the
existing notes, not a fresh walkthrough of the portal — expect small wording
differences.)

### 8. After the portal accepts it

```bash
git tag v0.5.2 -m "CI Companion 0.5.2"
git push --tags
```

### 9. Verify the release on real hardware / phone

1. Install **CI Companion** from Even Hub on the phone (or, before approval,
   scan `npm run qr` output with the Even Hub app's developer mode).
2. Open it: the screen should be the dark teal-navy Companion look with outlined
   quick-prompt chips and a sage accent — not near-black.
3. Settings → **Sign in with Companion Intelligence** → log in at
   `hub.ci.computer` → you land back in the app showing your identity.
4. Settings → CI-Hub → enter your Hub host → tap a **Quick connect** preset.
5. Long-press the G2 touchbar, ask something, and watch the answer stream onto
   the HUD.
6. Run the browser-side check as well: [er-connect → Test sign-in end to
   end](er-connect/README.md#test-sign-in-end-to-end).

---

## Pre-flight checklist

- [ ] `npm test` passes (currently 185 tests)
- [ ] `npm run typecheck` clean
- [ ] `npm run build` produces `dist/` with `index.html`, JS, CSS
- [ ] `app.json` version bumped (semver) — currently `0.5.2`
- [ ] Backend URL field in Settings defaults to a sensible value (today: `http://localhost:8080`)
- [ ] `permissions.network.whitelist` is `["*"]` so users can point at their own hub / Ollama / OpenAI URLs **and reach CI-Portal for OIDC sign-in**
- [ ] "Sign in with Companion Intelligence" (CI-Portal OIDC) reaches the configured issuer; signed-out API-key mode still works
- [ ] CI-Hub quick-connect fills a valid Ollama/Hermes/OpenClaw backend from a Hub base URL
- [ ] Manually smoke-tested in the Even Hub simulator against at least one live backend (recommend Ollama)
- [x] Store-listing screenshots recaptured on the current brand (0.5.2 set — see "Screenshots" below)

---

## App manifest (`app.json`) reference

The portal validates `app.json` against a fixed schema. The current file is:

```json
{
  "package_id": "com.companionintelligence.ciglasses",
  "edition": "202601",
  "name": "CI Companion",
  "version": "0.5.2",
  "min_app_version": "2.2.10",
  "min_sdk_version": "0.0.16",
  "entrypoint": "index.html",
  "permissions": [
    { "name": "g2-microphone", "desc": "Capture voice queries from the G2 glasses for STT." },
    { "name": "network", "desc": "Sign in with Companion Intelligence (CI-Portal OIDC) and send prompts to your configured AI backend …", "whitelist": ["*"] }
  ],
  "supported_languages": ["en"]
}
```

### Field constraints (verified against `evenhub-cli@0.1.13`)

| Field | Rule |
|---|---|
| `package_id` | Reverse-DNS. **Each segment must start with a lowercase letter and contain only `[a-z0-9]`** — no hyphens, no underscores. |
| `edition` | Must be exactly `"202601"` (the manifest spec edition, not a release date). |
| `version` | Semver. Bump on every portal upload. |
| `min_app_version` | Minimum Even Hub mobile app version. `2.2.10` is the current floor — set by `@evenrealities/even_hub_sdk`'s own declared `minAppVersion`; bump alongside `min_sdk_version` on every SDK upgrade. |
| `min_sdk_version` | Minimum `@evenrealities/even_hub_sdk` version your code requires. Match your `dependencies` entry. |
| `entrypoint` | Must exist inside the packed `dist/` folder. |
| `permissions[].name` | One of: `g2-microphone`, `phone-microphone`, `album`, `location`, `network`, `camera`. |
| `permissions[].desc` | ≤ 300 chars; user-visible justification. |
| `permissions[].whitelist` | Network only. URL prefixes; `["*"]` allows any origin (user-configurable backend). |
| `supported_languages` | ISO codes. We only ship English right now. |

If you add a new permission (say `phone-microphone` for a fallback STT path), bump the version and re-pack.

---

## Authentication & CI-Hub connection (new in 0.4.0)

**Sign in with Companion Intelligence (CI-Portal OIDC).** The Account section in
Settings runs an Authorization-Code + PKCE flow against the CI-Portal Better-Auth
IdP (public client, no secret). Because the Even Hub SDK cannot open an external
browser, the flow redirects the phone WebView to the Portal and completes the
code exchange when the app reloads at the redirect URI; a manual code-paste
fallback is provided for WebViews that can't round-trip the redirect. The
resulting access token becomes the `Authorization: Bearer` for backend calls,
replacing the static API key. Tokens persist through device-backed bridge storage
(localStorage in simulator/browser) and auto-refresh.

- Issuer / client id / scope are configurable (Account → Advanced). Defaults:
  issuer `https://hub.ci.computer/api/auth`, client `ci-even`, scope
  `openid email profile offline_access`.
- API-key mode still works; a fresh install defaults to it, so nothing breaks for
  users who don't sign in.
- The companion `agent-hub` can verify these tokens (`PORTAL_OIDC_ENABLED=true`) —
  see `agent-hub/README.md`.

**CI-Hub quick-connect.** Enter your Hub base host once; one tap fills the
standardized backend URL / kind / model for **Ollama** (`:11434/v1`, `local-llm`),
**Hermes** (Ollama `/v1` with a Hermes model), or **OpenClaw** (`:8787` via
agent-hub). See `ci-glasses-app/src/config/HubPresets.ts`.

---

## Build & pack

```bash
# Full clean build
rm -rf dist ci-companion.ehpk
npm install
npm run build

# Produce the .ehpk bundle
npx evenhub pack app.json dist --output ci-companion.ehpk
```

The `pack:ehpk` script wraps these two steps.

`evenhub pack` writes a custom binary format (magic header `EHPK`). It is not a zip — don't try to unzip it. A clean build today packs to ~165 KB (0.5.2: 47 KB gzip JS, 8 KB gzip CSS, ~72 KB of self-hosted Manrope `.woff2` files, icons).

---

## Develop against the real device (no upload)

The fastest inner loop uses the **Even Hub mobile app's dev mode** with a QR code:

```bash
# Terminal 1
npm run dev          # vite on http://0.0.0.0:5173

# Terminal 2
npm run qr           # evenhub qr --port 5173
```

Scan the QR with the Even Hub mobile app → it loads your local Vite server in dev mode → hot-reload works end-to-end into the G2. No upload, no .ehpk.

The Even Hub simulator (`evenhub-simulator http://<LAN-IP>:5173`) covers the same loop in a browser when you don't have glasses in front of you.

---

## Upload to the portal

See [Release runbook (macOS)](#release-runbook-macos) above — steps 4–7. In short:
`evenhub` has no `publish` command, so you log in with the CLI, build the `.ehpk`
with `npm run pack:ehpk`, and upload it by hand at
<https://evenhub.evenrealities.com/>.

---

## Store listing copy (suggested)

Use this as the starting point — the portal accepts plain text + images.

**Short name:** CI Companion

**Tagline:** Talk to any AI — local LLM, OpenClaw, Claude Code, Codex — through your G2 glasses.

**Description:**

> CI Companion turns your Even Realities G2 into a voice-driven front-end for the AI agent of your choice. Long-press the G2 touchbar to ask a question, see the answer stream onto the MicroLED display, and approve agent permission prompts with a double-tap (a single tap denies).
>
> Bring your own backend:
> • **OpenAI / Claude / Gemini** via any OpenAI-compatible endpoint
> • **Local LLMs** through Ollama, vLLM, llama.cpp (Hermes, Llama, Qwen…)
> • **Coding agents** — Claude Code or Codex CLI, via the open-source `agent-hub` companion service
> • **OpenClaw** Gateway
>
> No data goes anywhere except the backend URL you configure. Free, open source, no account required.

**Categories:** Productivity · Developer Tools

**Icon assets** (in `ci-glasses-app/assets/icons/`):
- `icon-1024.png` — App Store / portal master
- `icon-512.png`, `icon-192.png`, `icon-128.png`, `icon-64.png` — derived sizes
- `icon-512.png` is also bundled inside the `.ehpk` at `dist/icon.png`

**Screenshots** (in `ci-glasses-app/assets/screenshots/`) — recaptured 2026-09-28 from the 0.5.2 build (`vite build`, served with `vite preview`) on the Companion teal-navy surface (canon `@companionintelligence/tokens`, dark), replacing the earlier near-black set. `05`/`06` stream a fixed, accurate answer from a small deterministic OpenAI-compatible mock (word by word, exactly like a real backend) so they are reproducible; everything else is the app as-is. The old `07-beta1-settings.png` is gone on purpose — it showed a private Tailscale address.

| File | What it shows | Source |
|---|---|---|
| `01-empty-quick-actions.png` | Empty Chat tab — CI mark, "Ready when you are" hero, quick-action chips, "Connected to Even G2" pill, GLASSES DISPLAY pane, mic dock | simulator webview |
| `02-hud-ready.png` | G2 HUD showing "CI Companion ready" startup status | simulator glasses |
| `03-settings.png` | Settings tab — Account ("Sign in with Companion Intelligence") and CI-Hub quick-connect (Assistant / Ollama / Hermes / OpenClaw / Memory) | simulator webview |
| `04-hud-prompt.png` | Permission-prompt card on the HUD — tool name, summary, tap/double-tap footer | simulator glasses |
| `05-hud-stream.png` | A streamed answer paginated on the HUD | simulator glasses |
| `06-chat-with-response.png` | Full webview after a streamed answer: user bubble, assistant bubble, live GLASSES DISPLAY preview | simulator webview |

To recapture, run the simulator against a built app (`npm run build && npm run preview -- --port 5173`) with `--automation-port 9898` and fetch `/api/screenshot/{glasses,webview}` (one fresh simulator launch per shot; the webview snapshot only works while the window is frontmost). Sizes are 1200×1544 (webview) and 576×288 (glasses). **Give each webview shot a long settle (15–22 s after launch).** The splash is dismissed by a CSS animation, and with the window backgrounded the WebView throttles it, so a shorter wait can capture the splash mid cross-fade (seen while producing this set). Also look at every image before committing it: a screenshot of an unstyled page still looks like "a screenshot".

**Optional extras** (capture only if you want extra polish):
- agent-hub terminal output (for the developer story)
- Real glasses photo (out-of-app context for the hero image)

### How the screenshots were captured

The app supports three URL-param **demo bootstraps** wired into [Main.ts](ci-glasses-app/src/Main.ts) — used only for screenshot capture and dev, no production overhead:

| URL | Effect |
|---|---|
| `?screen=settings` | Open the Settings tab on load |
| `?screen=prompt` | Render a synthetic permission-prompt card on the HUD on load |
| `?screen=stream&q=<text>&baseUrl=<url>&model=<name>` | Fire a real chat request through the configured backend on load |

Repro the full simulator setup:

```bash
# 1) Ollama (if not running):  ollama serve  &&  ollama pull qwen2.5:0.5b
# 2) Hub:
cd agent-hub && AGENT_KIND=local-llm DOWNSTREAM_URL=http://localhost:11434 npm run dev
# 3) Glasses app dev server:
cd ci-glasses-app && npm run dev
# 4) Simulator with automation:
node_modules/@evenrealities/sim-darwin-arm64/bin/evenhub-simulator \
  --automation-port 9898 \
  "http://localhost:5173/?screen=stream&q=Hello&baseUrl=http://<LAN-IP>:8787&model=qwen2.5:0.5b"
# 5) Capture screenshots:
curl -o glasses.png http://localhost:9898/api/screenshot/glasses
curl -o webview.png http://localhost:9898/api/screenshot/webview
```

**Note on networking**: with simulator 0.7.3 the Tauri webview reaches the host's `localhost` fine (verified streaming through `http://localhost:8787`), so `baseUrl=http://localhost:8787` works. If a future simulator build blocks loopback, use your machine's LAN IP (`192.168.x.y:8787`) instead — the hub binds loopback only by default, so that also needs `HUB_BIND=0.0.0.0` + `HUB_TOKEN`. The agent-hub sends permissive CORS headers so the webview's preflight passes.

**Support URL:** <https://github.com/companionintelligence/CI-Even-Realities>

---

## Versioning policy

| Change type | Action |
|---|---|
| Bug fix / docs | Patch (`0.2.0` → `0.2.1`) |
| New backend kind / SSE event / settings option | Minor (`0.2.0` → `0.3.0`) |
| Permission set changes, breaking config migration | Major (`0.2.0` → `1.0.0`) — review burden goes up |

Tag releases in git as `v<version>` after the portal accepts the build:

```bash
git tag v0.2.0 -m "CI Companion 0.2.0 — pluggable agent-hub backends"
git push --tags
```

---

## Rollback

The portal keeps previous versions; revert in the dashboard. There is no CLI rollback. If a release breaks production, immediately:

1. Roll back via portal.
2. File a `notes/incident-<date>.md` describing what shipped, what broke, and the fix.
3. Add a regression test before shipping the fix.

---

## What we explicitly do **not** ship through the portal

- `agent-hub/` — Node service users run themselves. Published as source on GitHub.
- Backend secrets — never bundled. Users configure their own API keys in Settings (persisted to device-local storage).
- Telemetry — none. The app does not phone home.
