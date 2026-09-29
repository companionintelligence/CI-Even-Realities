# Store listing — CI Companion (Even Hub App Store)

Source of truth for the Even Hub portal listing. Copy these fields into the
portal's **Apps → New / Update** form. Keep in sync with `app.json` on every
release. See [`../PUBLISHING.md`](../PUBLISHING.md) for the upload workflow.

---

## Identity

| Field | Value |
|---|---|
| **App name** | CI Companion |
| **Package id** | `com.companionintelligence.ciglasses` |
| **Version** | `0.5.2` |
| **Categories** | Productivity · Developer Tools |
| **Supported languages** | English (`en`) |
| **Support URL** | <https://github.com/companionintelligence/CI-Even-Realities> |

## Short name / tagline

- **Short name:** CI Companion
- **Tagline:** Talk to your Companion — sign in with Companion Intelligence and reach any AI on your CI-Hub from your G2 glasses.

## Description

> CI Companion turns your Even Realities G2 into a voice-driven front-end for the
> AI agent of your choice. Long-press the G2 touchbar to ask a question, watch the
> answer stream onto the MicroLED display, and approve agent permission prompts
> with a single ring tap.
>
> **Sign in with Companion Intelligence.** Authenticate once against your
> CI-Portal identity (OpenID Connect) — no API keys to paste, and your session
> refreshes itself. Prefer to bring your own key? API-key mode still works.
>
> **One-tap CI-Hub connection.** Point at your CI-Hub and pick a service — Ollama,
> Hermes, or OpenClaw — and the backend URL, kind, and model are filled in for you.
>
> Bring your own backend, too:
> • **OpenAI / Claude / Gemini** via any OpenAI-compatible endpoint
> • **Local LLMs** through Ollama, vLLM, llama.cpp (Hermes, Llama, Qwen…)
> • **Coding agents** — Claude Code or Codex CLI, via the open-source `agent-hub`
> • **OpenClaw** Gateway
>
> Your prompts go only to the backend you configure, and sign-in goes only to the
> CI-Portal issuer you set. Open source, no telemetry.

## Permissions (user-visible justifications)

| Permission | Justification |
|---|---|
| `g2-microphone` | Capture voice queries from the G2 glasses for speech-to-text transcription. |
| `network` | Sign in with Companion Intelligence (CI-Portal OIDC) and send transcribed prompts to your configured AI backend (CI-Hub Ollama/Hermes/OpenClaw, agent-hub on LAN, OpenAI, or any OpenAI-compatible URL) and stream the response. |

## Icon assets (`ci-glasses-app/assets/icons/`)

- `icon-1024.png` — App Store / portal master
- `icon-512.png`, `icon-192.png`, `icon-128.png`, `icon-64.png` — derived sizes
- `icon-512.png` is also bundled inside the `.ehpk` at `dist/icon.png`

## Screenshots (`ci-glasses-app/assets/screenshots/`)

Recaptured for 0.5.2 on the Companion teal-navy surface (see [`../PUBLISHING.md`](../PUBLISHING.md#how-the-screenshots-were-captured) for how).

| File | What it shows |
|---|---|
| `01-empty-quick-actions.png` | Empty Chat tab — hero, quick-action chips, mic button |
| `02-hud-ready.png` | G2 HUD "CI Companion ready" |
| `03-settings.png` | Settings — Account sign-in and CI-Hub quick-connect |
| `04-hud-prompt.png` | Permission-prompt card on the HUD |
| `05-hud-stream.png` | Streamed answer paginated on the HUD |
| `06-chat-with-response.png` | Full webview after a streamed answer, with glasses preview |

## Release notes — 0.5.2

- Redesigned to the Companion Intelligence look: the phone screen now uses the shared Companion teal-navy palette, Manrope type, raised cards, outlined quick-prompt chips and the sage accent, instead of a generic near-black theme.
- Refreshed store screenshots to match.

## Release notes — 0.5.1 (previous)

- Fixed: pointing the app at a self-hosted or OpenAI-compatible server that has no Responses API (an `agent-hub`, or many local servers) no longer fails with "Responses API error 404" — the app now falls back to Chat Completions automatically.
- Native G2 touchbar long-press now starts and stops recording directly (Even Hub SDK 0.0.16).
- More resilient streaming, HUD writes, and CI-Server memory calls: a slow or unreachable backend can no longer stall a turn indefinitely.
- Refreshed store screenshots to match the current design.

## Release notes — 0.4.0 (previous)

- Added "Sign in with Companion Intelligence" (CI-Portal OIDC, Authorization-Code + PKCE).
- Added CI-Hub quick-connect presets (Ollama / Hermes / OpenClaw).
- Backend requests now carry the OIDC access token and auto-refresh on expiry.
- `agent-hub` can verify CI-Portal JWTs (`PORTAL_OIDC_ENABLED`).
