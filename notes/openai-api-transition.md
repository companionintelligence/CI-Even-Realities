# OpenAI API Transition Notes

Notes on the ongoing transition from the legacy Chat Completions API to the Responses API, and what it means for `ci-even-realities`.

---

## Background

OpenAI is migrating its primary API surface from the **Chat Completions** model to the **Responses API**, as part of a broader initiative called **"Open Responses"** to establish a shared cross-provider standard for AI inference.

### Open Responses initiative

- **Goal:** Allow developers to write code once and run it across different providers (Anthropic, Meta, Google, etc.) without rewriting per-provider logic.
- **Adopters (as of early 2026):** Vercel, Hugging Face, Ollama, vLLM, and others.
- **Standard format:** RESTful HTTP, Bearer token auth, JSON payload, SSE streaming.

---

## API Comparison

### Chat Completions (legacy)

**Endpoint:** `POST /v1/chat/completions`

```python
# Python example
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system",    "content": "You are helpful."},
        {"role": "user",      "content": "Hello"}
    ]
)
text = response.choices[0].message.content
```

**Characteristics:**
- History maintained **client-side** — full `messages[]` array sent on every request.
- System context via `{"role": "system", "content": "..."}` in the messages array.
- Response in `response.choices[0].message.content`.

---

### Responses API (current standard)

**Endpoint:** `POST /v1/responses`

```python
# Python example
response = client.responses.create(
    model="gpt-4o",
    input="Hello",
    instructions="You are helpful.",
    store=True,
    previous_response_id="resp_abc123"
)
text = response.output_text
```

**Characteristics:**
- History maintained **server-side** via `previous_response_id`.
- System context via top-level `instructions` parameter.
- Response in `response.output_text`.
- Stateful conversations with `store: true` — no need to resend full history.
- Native tools: `{"type": "web_search"}`, `{"type": "code_interpreter"}`, etc.
- Structured outputs moved from `response_format` to `text: { "format": { ... } }`.

---

## Migration Cheat Sheet

| Feature | Chat Completions | Responses API |
|---|---|---|
| Endpoint | `/v1/chat/completions` | `/v1/responses` |
| User input | `messages: [{"role":"user","content":"..."}]` | `input: "..."` |
| System prompt | `{"role":"system","content":"..."}` | `instructions: "..."` |
| Response text | `choices[0].message.content` | `output_text` |
| Conversation state | Full history in every request | `store: true` + `previous_response_id` |
| Streaming | SSE `data: {"choices":[{"delta":{...}}]}` | SSE (same format) |
| Tools | `tools: [{"type":"function",...}]` | `tools: [{"type":"web_search"}]` |

---

## Deprecation Timeline

| API | Status | Notes |
|---|---|---|
| Chat Completions | Active, **sunset planned end of 2026** | Still the most widely supported across third-party backends |
| Responses API | **Current recommended standard** (since 2025) | Supported by OpenAI and ci-server; limited third-party adoption yet |
| Assistants API | **Deprecated** early 2026; removed August 26, 2026 | Not used in this project |

---

## Impact on ci-even-realities

The `ApiAdapter` in this project handles the transition transparently:

1. **`auto` mode (default):** Probes `OPTIONS /v1/responses`. If the backend supports it, uses Responses API. Otherwise falls back to Chat Completions.

2. **`responses` mode:** Always uses Responses API. Use when the backend is known to support it (e.g. ci-server, OpenAI).

3. **`completions` mode:** Always uses Chat Completions. Use for backends that haven't yet adopted the Responses API (Ollama, LM Studio, vLLM, most self-hosted options as of early 2026).

### Streaming notes

The Responses API streaming SSE format differs slightly from Chat Completions. The `StreamParser.ts` module handles both formats — consult that file and the [OpenAI Responses API streaming docs](https://platform.openai.com/docs/api-reference/responses/streaming) for details.

### Context management

- **Chat Completions mode:** All conversation history is sent on every request. Long conversations increase request payload size and token cost.
- **Responses API mode:** Only the latest `input` is sent; history is stored server-side. This is more efficient for multi-turn conversations and is the recommended approach going forward.
- Call `ApiAdapter.clearHistory()` (ring double-tap) to reset both the client-side history array and the server-side `previousResponseId`.

---

## Audio API endpoints

The audio endpoints are independent of the Chat Completions / Responses API split, but are an important part of the voice pipeline:

| Endpoint | Purpose |
|---|---|
| `POST /v1/audio/transcriptions` | Speech-to-text (STT) — Whisper-compatible |
| `POST /v1/audio/speech` | Text-to-speech (TTS) — returns audio bytes |

Both endpoints use the same Bearer token auth pattern. Implement them on `ci-server` to keep all provider API keys server-side.

### STT streaming

`/v1/audio/transcriptions` supports a streaming variant (`stream=true`) that emits partial transcripts as SSE events. This lets you display "what I heard" on the glasses display before the AI response starts, reducing perceived latency.

### TTS as a parallel channel

Because the G2 has no speaker, TTS output plays on the phone. Two-tier approach:

1. **Low-latency baseline**: Use the browser/platform `SpeechSynthesis` API (Web Speech TTS) — no external dependency, works offline.
2. **High-quality voice**: Call `POST /v1/audio/speech` from `ci-server` and stream audio bytes back to the frontend. OpenAI's `tts-1` and `tts-1-hd` models support multiple output formats.

Make TTS opt-in (a toggle in Settings). Never block the text display on TTS completion — text and audio are parallel channels.

---

## Structured output differences

| Feature | Chat Completions | Responses API |
|---|---|---|
| JSON mode | `response_format: {"type": "json_object"}` | `text: {"format": {"type": "json_object"}}` |
| JSON schema | `response_format: {"type": "json_schema", "json_schema": <schema>}` | `text: {"format": {"type": "json_schema", "json_schema": <schema>}}` |

The semantics are the same — only the wrapper key changed from top-level `response_format` to nested `text.format`. `ApiAdapter` should normalise structured output requests when translating between the two APIs.

---

## Context management strategies

### Chat Completions mode — token budget

In Chat Completions mode the full `messages[]` array is sent on every request. Long conversations grow the payload quadratically (each turn adds to every subsequent request). Mitigations:

- **Max history length**: Keep the last N turns only. A practical default is ~10 turns (20 messages). Prune the oldest user+assistant pair when the limit is reached.
- **Token counting**: Estimate token count before sending and truncate history if the estimated count exceeds a budget (e.g. 80% of the model's context window).
- **Summarisation**: Periodically ask the model to summarise the conversation so far and replace the full history with the summary.

### Responses API mode — expired context

With `store: true` and `previous_response_id`, the server maintains history. Potential failure mode: the server-side context expires or is deleted.

- Detect the error: the backend returns a `4xx` with a message like "response not found" or "context expired".
- Recovery: clear `previousResponseId`, warn the user ("conversation reset"), and retry the last message as a fresh turn.

---

## Known limitations

### `previous_response_id` not captured during streaming

In Responses API streaming mode, the incremental SSE events do not include the response `id`. The final non-streaming response body contains `id`, but the current streaming implementation may miss it.

**Workaround**: Look for a terminal SSE event (e.g. `event: response.completed`) that includes the full response object with `id`. Alternatively, extract the ID from a custom response header if `ci-server` emits one.

This is tracked as a known limitation in `ROADMAP.md`.

---

## Resources

| Resource | URL |
|---|---|
| Responses API reference | <https://platform.openai.com/docs/api-reference/responses> |
| Responses API streaming reference | <https://platform.openai.com/docs/api-reference/responses/streaming> |
| Chat Completions reference | <https://platform.openai.com/docs/api-reference/chat> |
| Audio transcriptions reference | <https://platform.openai.com/docs/api-reference/audio/createTranscription> |
| Audio speech reference | <https://platform.openai.com/docs/api-reference/audio/createSpeech> |
| Migration guide | <https://platform.openai.com/docs/guides/responses-vs-chat-completions> |
| OpenAPI specification (GitHub) | <https://github.com/openai/openai-openapi> |
| Developer quickstart | <https://platform.openai.com/docs/quickstart> |
