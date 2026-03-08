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

## Resources

| Resource | URL |
|---|---|
| Responses API reference | <https://platform.openai.com/docs/api-reference/responses> |
| Chat Completions reference | <https://platform.openai.com/docs/api-reference/chat> |
| Migration guide | <https://platform.openai.com/docs/guides/responses-vs-chat-completions> |
| OpenAPI specification (GitHub) | <https://github.com/openai/openai-openapi> |
| Developer quickstart | <https://platform.openai.com/docs/quickstart> |
