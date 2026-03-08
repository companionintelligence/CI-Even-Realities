# AI Backend API Compatibility

This document explains how `ci-even-realities` integrates with AI backends via the OpenAI API standard, covering both the legacy Chat Completions API and the current Responses API.

---

## Table of Contents

1. [The OpenAI API standard](#the-openai-api-standard)
2. [Chat Completions API](#chat-completions-api)
3. [Responses API](#responses-api)
4. [Auto-detection logic](#auto-detection-logic)
5. [Configuration reference](#configuration-reference)
6. [Payload examples](#payload-examples)
7. [Compatible backends](#compatible-backends)
8. [Deprecation timeline](#deprecation-timeline)

---

## The OpenAI API standard

The **OpenAI API standard** is a RESTful HTTP API format that has become the de facto industry standard for AI inference. It is:

- **RESTful / HTTP** — works from any environment that supports web requests.
- **Bearer token authenticated** — `Authorization: Bearer <api-key>`.
- **JSON payload** — request and response bodies are JSON.
- **Streaming via SSE** — server-sent events (`text/event-stream`) for token-by-token output.

The standard is currently transitioning from the legacy **Chat Completions** model to the newer **Responses API**, an initiative OpenAI calls **"Open Responses"** aimed at making the format a shared cross-provider industry standard. Major adopters include Vercel, Hugging Face, Ollama, and vLLM.

---

## Chat Completions API

**Endpoint:** `POST /v1/chat/completions`

The legacy standard. History is maintained client-side and resent with every request.

### Request shape

```json
{
  "model": "gpt-4o",
  "messages": [
    { "role": "system",    "content": "You are a helpful assistant." },
    { "role": "user",      "content": "What is the capital of France?" },
    { "role": "assistant", "content": "Paris." },
    { "role": "user",      "content": "And Germany?" }
  ],
  "stream": true
}
```

### Response shape (non-streaming)

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "The capital of Germany is Berlin."
      }
    }
  ]
}
```

### Response shape (streaming)

A series of SSE events, each containing a `delta`:

```
data: {"choices":[{"delta":{"content":"The "}}]}
data: {"choices":[{"delta":{"content":"capital"}}]}
...
data: [DONE]
```

### How this app uses it

`ChatCompletions.ts` maintains a local `history: Message[]` array. On each call:

1. The system prompt, full history, and new user message are assembled into `messages[]`.
2. The request is sent.
3. On success, the user + assistant messages are appended to `history`.
4. If the request fails, history is **not** modified — preventing orphaned entries.

---

## Responses API

**Endpoint:** `POST /v1/responses`

The current recommended standard. Context is maintained server-side via `previous_response_id`.

### Key differences from Chat Completions

| Feature | Chat Completions | Responses API |
|---|---|---|
| Method | `client.chat.completions.create` | `client.responses.create` |
| User input | `messages: [{"role": "user", ...}]` | `input: "Your prompt"` |
| System guidance | `{"role": "system", "content": "..."}` | `instructions: "..."` |
| Response text | `response.choices[0].message.content` | `response.output_text` |
| Context storage | Client-side `messages[]` | `store: true` + `previous_response_id` |
| Native tools | Manual function calling | `{"type": "web_search"}` etc. |

### Request shape

```json
{
  "model": "gpt-4o",
  "input": "And Germany?",
  "instructions": "You are a helpful assistant.",
  "store": true,
  "previous_response_id": "resp_abc123",
  "stream": true
}
```

### Response shape (non-streaming)

```json
{
  "id": "resp_xyz789",
  "output_text": "The capital of Germany is Berlin."
}
```

### How this app uses it

`ResponsesApi.ts` stores `previousResponseId` in memory. On each call:

1. `input` (user text) and `instructions` (system prompt) are sent.
2. If `storeContext: true`, `store: true` and `previous_response_id` are included.
3. On a successful non-streaming response, `previousResponseId` is updated from `data.id`.

To clear server-side context, call `ApiAdapter.clearHistory()` which calls `ResponsesApi.clearContext()` (sets `previousResponseId = undefined`).

---

## Auto-detection logic

When `apiMode` is set to `"auto"` (the default), the adapter probes the backend once:

```
OPTIONS /v1/responses
  ├─ 200 OK   →  Responses API supported ✓
  ├─ 405 Method Not Allowed  →  endpoint exists, Responses API supported ✓
  └─ error / 4xx / timeout   →  fall back to Chat Completions
```

The probe result is cached for the lifetime of the `ApiAdapter` instance. Concurrent callers during the probe share a single in-flight `Promise` to avoid duplicate OPTIONS requests.

The cache is cleared when `ApiAdapter.updateConfig()` is called (e.g. the user changes the backend URL in Settings).

---

## Configuration reference

Settings are persisted in `localStorage` as `"ci-glasses-config"` JSON and managed by `Settings.ts`.

| Setting | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | `string` | `"http://localhost:8080"` | Backend base URL (no trailing slash) |
| `apiKey` | `string` | `"ci-local-key"` | Bearer token / API key |
| `model` | `string` | `"ci-companion"` | Model name forwarded to backend |
| `apiMode` | `"auto" \| "completions" \| "responses"` | `"auto"` | API shape selection |
| `systemPrompt` | `string` | "You are a personal companion…" | Default system / instructions text |
| `streaming` | `boolean` | `true` | Enable SSE streaming |
| `storeContext` | `boolean` | `true` | Responses API: send `store: true` |
| `sttProvider` | `"whisper" \| "webspeech"` | `"whisper"` | Speech-to-text engine |
| `ttsEnabled` | `boolean` | `false` | Text-to-speech via phone speaker |

---

## Payload examples

### Connect to a local Ollama instance

```json
{
  "baseUrl": "http://localhost:11434",
  "apiKey": "",
  "model": "llama3.2",
  "apiMode": "completions"
}
```

Ollama supports `/v1/chat/completions` but not `/v1/responses`, so force `completions` mode or let `auto` fall back.

### Connect to ci-server (Responses API)

```json
{
  "baseUrl": "http://localhost:8080",
  "apiKey": "ci-local-key",
  "model": "ci-companion",
  "apiMode": "auto",
  "storeContext": true
}
```

### Connect to OpenAI directly

```json
{
  "baseUrl": "https://api.openai.com",
  "apiKey": "sk-...",
  "model": "gpt-4o",
  "apiMode": "auto"
}
```

### Connect to a vLLM / text-generation-inference server

```json
{
  "baseUrl": "http://my-server:8000",
  "apiKey": "token-abc",
  "model": "meta-llama/Meta-Llama-3-8B-Instruct",
  "apiMode": "completions"
}
```

---

## Compatible backends

Any backend that implements the OpenAI API standard is compatible:

| Backend | Chat Completions | Responses API | Notes |
|---|---|---|---|
| [ci-server](https://github.com/companionintelligence/ci-server) | ✅ | ✅ | Primary target |
| [OpenAI](https://platform.openai.com) | ✅ | ✅ | Requires paid API key |
| [Ollama](https://ollama.com/) | ✅ | ❌ | Local LLMs; use `completions` mode |
| [vLLM](https://docs.vllm.ai/) | ✅ | ❌ | High-throughput local inference |
| [LM Studio](https://lmstudio.ai/) | ✅ | ❌ | Desktop local LLM runner |
| [Hugging Face TGI](https://huggingface.co/docs/text-generation-inference) | ✅ | ❌ | |
| [Groq](https://console.groq.com/) | ✅ | ❌ | Cloud inference |
| [Together AI](https://www.together.ai/) | ✅ | ❌ | Cloud inference |

---

## Deprecation timeline

| API | Status |
|---|---|
| Chat Completions (`/v1/chat/completions`) | Supported; sunset planned by end of 2026 |
| Responses API (`/v1/responses`) | Current recommended standard (as of 2025) |
| Assistants API | Deprecated early 2026; full removal August 26, 2026 |

The app supports both APIs simultaneously via the `ApiAdapter` auto-detection mechanism, ensuring forward compatibility as backends migrate to the Responses API and backward compatibility with those that haven't yet.
