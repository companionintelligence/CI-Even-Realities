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

- [ ] `npm test` passes (currently 64 tests)
- [ ] `npm run typecheck` clean
- [ ] `npm run build` produces `dist/` with `index.html`, JS, CSS
- [ ] `app.json` version bumped (semver)
- [ ] Backend URL field in Settings defaults to a sensible value (today: `http://localhost:8080`)
- [ ] `permissions.network.whitelist` is `["*"]` so users can point at their own hub / Ollama / OpenAI URLs
- [ ] Manually smoke-tested in the Even Hub simulator against at least one live backend (recommend Ollama)

---

## App manifest (`app.json`) reference

The portal validates `app.json` against a fixed schema. The current file is:

```json
{
  "package_id": "com.companionintelligence.ciglasses",
  "edition": "202601",
  "name": "CI Companion",
  "version": "0.2.0",
  "min_app_version": "2.0.0",
  "min_sdk_version": "0.0.7",
  "entrypoint": "index.html",
  "permissions": [
    { "name": "g2-microphone", "desc": "Capture voice queries from the G2 glasses for STT." },
    { "name": "network", "desc": "Send prompts to your configured AI backend …", "whitelist": ["*"] }
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
| `min_app_version` | Minimum Even Hub mobile app version. `2.0.0` is the current floor. |
| `min_sdk_version` | Minimum `@evenrealities/even_hub_sdk` version your code requires. Match your `dependencies` entry. |
| `entrypoint` | Must exist inside the packed `dist/` folder. |
| `permissions[].name` | One of: `g2-microphone`, `phone-microphone`, `album`, `location`, `network`, `camera`. |
| `permissions[].desc` | ≤ 300 chars; user-visible justification. |
| `permissions[].whitelist` | Network only. URL prefixes; `["*"]` allows any origin (user-configurable backend). |
| `supported_languages` | ISO codes. We only ship English right now. |

If you add a new permission (say `phone-microphone` for a fallback STT path), bump the version and re-pack.

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

**Screenshots to capture:**
1. Settings panel with Backend Kind selector
2. Streaming response on the G2 HUD (use the simulator)
3. Permission-prompt card on the HUD
4. agent-hub terminal output (for the developer story)

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
