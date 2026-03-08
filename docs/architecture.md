# System Architecture

This document describes the full technical architecture of `ci-even-realities`, the Even Hub app that connects Even Realities G2 smart glasses to an agentic AI backend.

---

## Table of Contents

1. [High-level overview](#high-level-overview)
2. [Component map](#component-map)
3. [Voice pipeline — sequence diagram](#voice-pipeline--sequence-diagram)
4. [AI adapter — API selection logic](#ai-adapter--api-selection-logic)
5. [Even Hub SDK integration](#even-hub-sdk-integration)
6. [Data flow diagrams](#data-flow-diagrams)
7. [State management](#state-management)
8. [Error handling strategy](#error-handling-strategy)

---

## High-level overview

The app is a **web page** served by Vite and loaded by the Even Hub iOS/Android mobile app. It communicates with two external systems:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Even Hub mobile app (iOS / Android)                                     │
│                                                                          │
│  ┌──────────────────────────────────┐   BLE     ┌──────────────────┐   │
│  │  ci-glasses-app (this repo)      │◄─────────►│  Even G2 glasses │   │
│  │  (runs as embedded WebView)      │           └──────────────────┘   │
│  └────────────────┬─────────────────┘                                   │
└───────────────────┼─────────────────────────────────────────────────────┘
                    │ HTTPS / HTTP
                    ▼
        ┌───────────────────────┐
        │  AI Backend           │
        │  (ci-server, Ollama,  │
        │   vLLM, OpenAI, etc.) │
        └───────────────────────┘
```

The Even Hub app bridges the WebView to the glasses via Bluetooth Low Energy (BLE). The `even_hub_sdk` exposes this bridge as a JavaScript object (`EvenAppBridge`) injected into `window`.

---

## Component map

```
src/
├── Main.ts                 ← Entry: bootstraps all modules, wires events
│
├── config/
│   └── Settings.ts         ← BackendConfig, localStorage persistence
│
├── ai/
│   ├── ApiAdapter.ts       ← Unified send/probe, auto-selects API shape
│   ├── ChatCompletions.ts  ← POST /v1/chat/completions, client history
│   ├── ResponsesApi.ts     ← POST /v1/responses, server-side context
│   └── StreamParser.ts     ← SSE text/event-stream → AsyncGenerator<string>
│
├── audio/
│   ├── MicCapture.ts       ← SDK mic access, returns ArrayBuffer (WAV)
│   ├── LC3Decoder.ts       ← Decodes LC3 BLE audio frames to PCM
│   └── TTSPlayer.ts        ← Web Speech API TTS through phone speaker
│
├── stt/
│   ├── STTEngine.ts        ← Interface: transcribe(audio) → Promise<string>
│   ├── WhisperSTT.ts       ← POST /v1/audio/transcriptions
│   └── WebSpeechSTT.ts     ← Browser SpeechRecognition API (fallback)
│
├── glasses/
│   └── GlassesRenderer.ts  ← Word-wrap, paginate, BLE display update
│
└── ui/
    ├── ChatView.ts         ← Message list, mic button, glasses preview
    ├── SettingsView.ts     ← Form to edit BackendConfig at runtime
    ├── StatusBar.ts        ← Connection status, model name indicator
    └── styles.css          ← Even-brand dark-mode CSS
```

---

## Voice pipeline — sequence diagram

```
User          G2 Glasses    MicCapture    STT             ApiAdapter    AI Backend    GlassesRenderer
 │                │              │          │                  │              │              │
 │  long-press    │              │          │                  │              │              │
 │────────────────►              │          │                  │              │              │
 │           FOREGROUND_ENTER    │          │                  │              │              │
 │                │──────────────►          │                  │              │              │
 │                │         startCapture()  │                  │              │              │
 │                │              │          │                  │              │              │
 │  release       │              │          │                  │              │              │
 │────────────────►              │          │                  │              │              │
 │           FOREGROUND_EXIT     │          │                  │              │              │
 │                │──────────────►          │                  │              │              │
 │                │         stopCapture()   │                  │              │              │
 │                │              │─────────►│                  │              │              │
 │                │              │  transcribe(WAV)            │              │              │
 │                │              │    POST /v1/audio/          │              │              │
 │                │              │    transcriptions           │              │              │
 │                │              │          │──────────────────►              │              │
 │                │              │          │             sendMessage(text)   │              │
 │                │              │          │                  │──────────────►              │
 │                │              │          │                  │  SSE stream  │              │
 │                │              │          │                  │◄─────────────┤              │
 │                │              │          │           displayStreaming()    │              │
 │                │              │          │                  │──────────────────────────────►
 │                │              │          │                  │              │    BLE update │
 │                │◄─────────────────────────────────────────────────────────────────────────┤
 │  sees text on  │              │          │                  │              │              │
 │  display       │              │          │                  │              │              │
```

### Streaming throttle

The G2 communicates over BLE. Sending a display update on every SSE token would overwhelm the BLE layer. `GlassesRenderer.displayStreaming()` therefore throttles BLE writes to at most one every **150 ms**, with a final guaranteed update when the stream ends.

---

## AI adapter — API selection logic

`ApiAdapter` auto-detects which API generation the backend supports:

```
sendMessage(text)
     │
     ▼
shouldUseResponsesApi()
     │
     ├─ apiMode === 'responses'  →  ResponsesApi.send()
     ├─ apiMode === 'completions' →  ChatCompletions.send()
     └─ apiMode === 'auto'
           │
           ├─ [cached]  →  use cached result
           └─ [probe]   →  OPTIONS /v1/responses
                              ├─ 2xx or 405  →  ResponsesApi.send()
                              └─ error / 4xx →  ChatCompletions.send()
```

The probe result is cached for the lifetime of the adapter instance. Calling `updateConfig()` resets the cache (important when the user changes the backend URL in Settings).

Concurrent callers during the probe share a single in-flight `Promise` to avoid duplicate `OPTIONS` requests.

---

## Even Hub SDK integration

The SDK exposes `waitForEvenAppBridge()` which resolves to an `EvenAppBridge` once the mobile app injects it into the page:

```typescript
const bridge = await waitForEvenAppBridge();
```

If the bridge is not available (running in a plain browser), the `await` rejects after a timeout. The app catches this and enters **browser mode** — all functionality still works except direct BLE display updates.

### Key SDK APIs used

| API | Purpose |
|---|---|
| `bridge.onEvenHubEvent(handler)` | Receive ring/touchbar gesture events |
| `bridge.createStartUpPageContainer(container)` | Initialise display container |
| `bridge.textContainerUpgrade(upgrade)` | Fast incremental display update |
| `bridge.rebuildPageContainer(container)` | Full display rebuild (fallback) |
| `OsEventTypeList.CLICK_EVENT` | Single ring tap |
| `OsEventTypeList.DOUBLE_CLICK_EVENT` | Double ring tap |
| `OsEventTypeList.SCROLL_TOP_EVENT` | Ring scroll up |
| `OsEventTypeList.SCROLL_BOTTOM_EVENT` | Ring scroll down |
| `OsEventTypeList.FOREGROUND_ENTER_EVENT` | Long-press begin |
| `OsEventTypeList.FOREGROUND_EXIT_EVENT` | Long-press end |

---

## Data flow diagrams

### Settings persistence

```
SettingsView (form) ──patch──► Settings.set()
                                    │
                                    ▼
                             localStorage (JSON)
                                    │
                                    ▼
                             Settings.load() ◄── app startup
                                    │
                                    ▼
                             ApiAdapter.updateConfig()
```

### Conversation history

**Chat Completions mode (client-side)**

```
ChatCompletions.history[]
  ├─ system message (from Settings.systemPrompt)
  ├─ user: "Hello"
  ├─ assistant: "Hi there!"
  ├─ user: "What is the weather?"
  └─ assistant: "I don't have weather data..."

Sent on every request as full messages[]
```

**Responses API mode (server-side)**

```
ResponsesApi.previousResponseId = "resp_abc123"

POST /v1/responses
  body: {
    input: "What is the weather?",
    instructions: "...",
    store: true,
    previous_response_id: "resp_abc123"
  }
```

The server maintains context; only the latest user message is sent per request.

---

## State management

The app uses a simple imperative state model — no framework or reactive library:

| State | Location | Type |
|---|---|---|
| User configuration | `Settings` + `localStorage` | Persisted |
| Conversation history | `ChatCompletions.history[]` | In-memory |
| Responses API context | `ResponsesApi.previousResponseId` | In-memory |
| API capability cache | `ApiAdapter.responsesApiSupported` | In-memory |
| Mic state | `MicCapture.getState()` | In-memory |
| Display pages | `GlassesRenderer.pages[]` | In-memory |
| UI rendering | DOM manipulation in `ChatView`, `StatusBar` | DOM |

---

## Error handling strategy

Each layer has a distinct error-handling strategy:

| Layer | Strategy |
|---|---|
| `ApiAdapter` | Throws typed `Error` with HTTP status; callers display in UI |
| `ChatCompletions` | Does **not** push user message to history until the request succeeds — no orphaned history on network error |
| `GlassesRenderer` | Silently re-initialises display container if `textContainerUpgrade` fails |
| `MicCapture` | Catches and rethrows; `Main.ts` sets status bar to error state |
| `Main.ts` | All async handlers are `try/catch`; errors shown in glasses display and chat UI |
| SDK bridge | Bridge unavailable → `browser mode` warning; app fully functional without glasses |
