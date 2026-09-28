# Publishing — Even Hub App Store

End-to-end guide for shipping `ci-glasses-app` to the Even Hub portal. The companion `agent-hub` is **not** distributed through the portal — it's a separate Node service users run on their LAN.

---

## TL;DR

```bash
cd ci-glasses-app
npm run build           # tsc + vite -> dist/
npx evenhub login       # one-time, opens Even Realities auth
npm run pack:ehpk       # builds + produces ci-companion.ehpk
# Upload ci-companion.ehpk via https://evenhub.evenrealities.com/
```

---

## Pre-flight checklist

- [ ] `npm test` passes (currently 172 tests)
- [ ] `npm run typecheck` clean
- [ ] `npm run build` produces `dist/` with `index.html`, JS, CSS
- [ ] `app.json` version bumped (semver) — currently `0.5.0`
- [ ] Backend URL field in Settings defaults to a sensible value (today: `http://localhost:8080`)
- [ ] `permissions.network.whitelist` is `["*"]` so users can point at their own hub / Ollama / OpenAI URLs **and reach CI-Portal for OIDC sign-in**
- [ ] "Sign in with Companion Intelligence" (CI-Portal OIDC) reaches the configured issuer; signed-out API-key mode still works
- [ ] CI-Hub quick-connect fills a valid Ollama/Hermes/OpenClaw backend from a Hub base URL
- [ ] Manually smoke-tested in the Even Hub simulator against at least one live backend (recommend Ollama)

---

## App manifest (`app.json`) reference

The portal validates `app.json` against a fixed schema. The current file is:

```json
{
  "package_id": "com.companionintelligence.ciglasses",
  "edition": "202601",
  "name": "CI Companion",
  "version": "0.5.0",
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
  issuer `https://hub.ci.computer/api/auth`, client `ci-hub`, scope
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

`evenhub pack` writes a custom binary format (magic header `EHPK`). It is not a zip — don't try to unzip it. A clean build today is ~36 KB (15 KB JS minified+gzip, 1.8 KB CSS, plus the SDK runtime).

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

`evenhub-cli` does **not** have a `publish` subcommand — uploads are manual via the portal:

1. `npx evenhub login` (one-time; saves credentials locally).
2. Build + pack: `npm run pack:ehpk`.
3. Open <https://evenhub.evenrealities.com/>.
4. **Apps → New / Update → Upload `.ehpk`**.
5. Fill out store listing (title, screenshots, description) using `docs/store-listing.md` as the source of truth (see below).
6. Submit for review.

---

## Store listing copy (suggested)

Use this as the starting point — the portal accepts plain text + images.

**Short name:** CI Companion

**Tagline:** Talk to any AI — local LLM, OpenClaw, Claude Code, Codex — through your G2 glasses.

**Description:**

> CI Companion turns your Even Realities G2 into a voice-driven front-end for the AI agent of your choice. Long-press the G2 touchbar to ask a question, see the answer stream onto the MicroLED display, and approve agent permission prompts with a single ring tap.
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

**Screenshots already captured** (in `ci-glasses-app/assets/screenshots/`):

| File | What it shows | Source |
|---|---|---|
| `01-empty-quick-actions.png` | Empty Chat tab — icon mark, "Ready when you are" hero, 5 quick-action chips, system pill, GLASSES DISPLAY pane, polished SVG mic button | simulator webview |
| `02-hud-ready.png` | G2 HUD showing "CI Companion ready" startup status | simulator glasses |
| `03-settings.png` | Settings tab with the **Backend Kind card grid** (Local LLM active), card hints visible | simulator webview |
| `04-hud-prompt.png` | Permission-prompt card on the HUD — tool name, summary, "tap: Approve  2x: Deny" footer | simulator glasses |
| `05-hud-stream-ollama.png` | Real `qwen2.5:0.5b` answer paginated on the HUD with "[1/2]" indicator, streamed through beta-1 over Tailscale | simulator glasses |
| `06-chat-with-response.png` | Full polished webview mid-stream: connected pill, model badge, user bubble (gradient green), assistant bubble (dark surface), live GLASSES DISPLAY preview with scan-line overlay | simulator webview |
| `07-beta1-settings.png` | Settings showing Backend URL `http://100.124.211.75:8787` (beta-1 via Tailscale) — proves the deploy chain | simulator webview |

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

**Note on networking**: the Tauri webview inside the simulator can reach a LAN IP (`192.168.x.y:8787`) but not `localhost` of the host. Use your machine's LAN IP when pointing at the hub from the simulator. The agent-hub now sends permissive CORS headers so the webview's preflight passes.

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
