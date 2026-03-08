# Companion Intelligence - Even Realities G2

> **Agentic AI companion for Even Realities G2 smart glasses** — a Vite + TypeScript Even Hub app that bridges any OpenAI-compatible AI backend to the G2 MicroLED display with voice-in / voice-out interaction.

[![Even Hub SDK](https://img.shields.io/badge/Even%20Hub%20SDK-0.0.7-blue)](https://www.npmjs.com/package/@evenrealities/even_hub_sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5.2-purple)](https://vitejs.dev/)

---

## Table of Contents

1. [What this is](#what-this-is)
2. [Architecture overview](#architecture-overview)
3. [Quick start](#quick-start)
4. [Voice pipeline](#voice-pipeline)
5. [AI backend compatibility](#ai-backend-compatibility)
6. [Glasses display](#glasses-display)
7. [Project structure](#project-structure)
8. [Further reading](#further-reading)

---

## What this is

`ci-even-realities` is an [Even Hub](https://evenhub.evenrealities.com/) app for the **Even Realities G2** smart glasses. It connects to any [OpenAI-API-compatible](https://platform.openai.com/docs/api-reference) backend (including [ci-server](https://github.com/companionintelligence/ci-server), local Ollama, vLLM, or OpenAI itself) and exposes a full voice-in / text-out loop:

```
[G2 touchbar long-press] ──▶ MicCapture ──▶ Whisper STT ──▶ ApiAdapter ──▶ AI backend
                                                                              │
[G2 display] ◀── GlassesRenderer ◀── SSE stream ◀────────────────────────────┘
```

The app runs as a standard web page inside the **Even Hub** iOS/Android app, or in any modern browser (simulator / dev mode).

---

## Architecture overview

See [`docs/architecture.md`](docs/architecture.md) for the full deep-dive. The high-level layers are:

| Layer | File(s) | Responsibility |
|---|---|---|
| Entry point | `src/Main.ts` | Bootstrap, SDK bridge wiring, gesture routing |
| AI adapter | `src/ai/ApiAdapter.ts` | Auto-selects Chat Completions vs Responses API |
| Chat Completions | `src/ai/ChatCompletions.ts` | `/v1/chat/completions`, client-side history |
| Responses API | `src/ai/ResponsesApi.ts` | `/v1/responses`, server-side context |
| SSE parser | `src/ai/StreamParser.ts` | Parses `text/event-stream` chunks |
| Audio capture | `src/audio/MicCapture.ts` | WebAudio mic recording via Even Hub SDK |
| LC3 decode | `src/audio/LC3Decoder.ts` | Converts G2 BLE audio frames to PCM/WAV |
| TTS | `src/audio/TTSPlayer.ts` | Web Speech TTS playback through phone speaker |
| Whisper STT | `src/stt/WhisperSTT.ts` | `/v1/audio/transcriptions` (Whisper-compatible) |
| Web Speech STT | `src/stt/WebSpeechSTT.ts` | Browser Web Speech API (fallback) |
| Glasses renderer | `src/glasses/GlassesRenderer.ts` | Word-wrap + paginate text for 488 px display |
| Settings | `src/config/Settings.ts` | `localStorage`-persisted `BackendConfig` |
| UI | `src/ui/` | `ChatView`, `SettingsView`, `StatusBar`, CSS |

---

## Quick start

### Prerequisites

| Tool | Install command |
|---|---|
| Node.js ≥ 18 | [nodejs.org](https://nodejs.org/) |
| Even Hub CLI | `sudo npm install -g @evenrealities/evenhub-cli` |
| Even Hub Simulator | `sudo npm install -g @evenrealities/evenhub-simulator` |
| Vite (global, optional) | `sudo npm install -g vite@latest` |

### 1 — Install dependencies

```bash
cd ci-glasses-app
npm install
```

### 2 — Start the dev server

```bash
npm run dev
# Listening on http://0.0.0.0:5173
```

### 3 — Open in simulator (optional)

In a second terminal:

```bash
evenhub-simulator http://<YOUR_LAN_IP>:5173
```

The simulator opens a browser window that mirrors what the Even Hub mobile app renders.

### 4 — Configure your AI backend

Open the **Settings** tab inside the app and set:

| Field | Default | Description |
|---|---|---|
| Backend URL | `http://localhost:8080` | Base URL of any OpenAI-compatible server |
| API Key | `ci-local-key` | Bearer token (can be any string for local backends) |
| Model | `ci-companion` | Model name forwarded to the backend |
| API Mode | `auto` | `auto` probes the server; or force `completions` / `responses` |
| STT Provider | `whisper` | `whisper` (server-side) or `webspeech` (browser) |
| TTS | off | Speaks responses through phone speaker |

### 5 — Build for production / Even Hub upload

```bash
npm run build   # outputs dist/
```

Upload `dist/` to the Even Hub portal or use the CLI:

```bash
evenhub-cli publish dist/
```

---

## Voice pipeline

```
1. Long-press G2 touchbar  →  MicCapture.startCapture()
2. Release                  →  MicCapture.stopCapture()  →  ArrayBuffer (WAV)
3. WhisperSTT.transcribe()  →  POST /v1/audio/transcriptions
4. ApiAdapter.sendMessage() →  POST /v1/chat/completions  OR  /v1/responses
5. SSE stream               →  GlassesRenderer.displayStreaming()
6. Ring tap                 →  nextPage() / prevPage()
7. Ring double-tap          →  clearHistory()
```

See [`docs/architecture.md`](docs/architecture.md) for sequence diagrams and the full flow.

---

## AI backend compatibility

The `ApiAdapter` supports both OpenAI API generations:

| API | Endpoint | Notes |
|---|---|---|
| Chat Completions | `POST /v1/chat/completions` | Client-side history, `messages[]` |
| Responses API | `POST /v1/responses` | Server-side context, `store: true` |

In `auto` mode the adapter sends an `OPTIONS /v1/responses` probe. If the backend responds with `2xx` or `405`, the Responses API is used; otherwise it falls back to Chat Completions.

See [`docs/api-compatibility.md`](docs/api-compatibility.md) for migration details and payload examples.

---

## Glasses display

The G2 display is a **640 × 350 px MicroLED** (green-on-black). The renderer uses:

- **488 px** usable text width
- **21 px** font size → ≈ 42 characters per line
- **5 lines** per screen (page)

Long responses are automatically word-wrapped and paginated. Navigation is via the **G2 ring** (single tap = next page, double tap = clear).

See [`docs/glasses-display.md`](docs/glasses-display.md) for full display spec details.

---

## Project structure

```
ci-even-realities/
├── README.md              ← you are here
├── ROADMAP.md             ← next steps for testing and development
├── docs/
│   ├── architecture.md    ← system architecture deep-dive
│   ├── api-compatibility.md ← Chat Completions vs Responses API
│   ├── dev-setup.md       ← complete developer environment guide
│   └── glasses-display.md ← G2 display spec and rendering details
├── notes/
│   ├── even-realities-resources.md ← links, community notes, SDK tips
│   └── openai-api-transition.md    ← Chat Completions → Responses API transition notes
└── ci-glasses-app/        ← Even Hub app source
    ├── index.html
    ├── app.json
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    └── src/
        ├── Main.ts
        ├── ai/
        │   ├── ApiAdapter.ts
        │   ├── ChatCompletions.ts
        │   ├── ResponsesApi.ts
        │   └── StreamParser.ts
        ├── audio/
        │   ├── LC3Decoder.ts
        │   ├── MicCapture.ts
        │   └── TTSPlayer.ts
        ├── config/
        │   └── Settings.ts
        ├── glasses/
        │   └── GlassesRenderer.ts
        ├── stt/
        │   ├── STTEngine.ts
        │   ├── WebSpeechSTT.ts
        │   └── WhisperSTT.ts
        └── ui/
            ├── ChatView.ts
            ├── SettingsView.ts
            ├── StatusBar.ts
            └── styles.css
```

---

## Further reading

| Resource | Link |
|---|---|
| Even Hub portal | <https://evenhub.evenrealities.com/> |
| Even Hub SDK (npm) | <https://www.npmjs.com/package/@evenrealities/even_hub_sdk> |
| Even Hub CLI (npm) | <https://www.npmjs.com/package/@evenrealities/evenhub-cli> |
| Even Realities design guidelines (Figma) | <https://www.figma.com/design/X82y5uJvqMH95jgOfmV34j/> |
| CI Server (backend) | <https://github.com/companionintelligence/ci-server> |
| OpenAI Responses API docs | <https://platform.openai.com/docs/api-reference/responses> |
| OpenAI Chat Completions docs | <https://platform.openai.com/docs/api-reference/chat> |
| Even G2 community notes | <https://github.com/nickustinov/even-g2-notes/tree/main> |
| Awesome Even Realities G1 | <https://github.com/galfaroth/awesome-even-realities-g1> |
