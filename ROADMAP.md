# ROADMAP

Next steps for testing and development of `ci-even-realities`.

---

## Phase 1 — Core reliability (near-term)

### Testing

- [ ] **Unit tests for `GlassesRenderer`** — `wordWrap` and `paginate` are pure functions with well-defined behaviour; add tests covering empty strings, long words, multi-paragraph text, and exact boundary cases (e.g. text that fills exactly N pages).
- [ ] **Unit tests for `StreamParser`** — mock SSE byte streams and assert correct token extraction for both Chat Completions and Responses API delta formats.
- [ ] **Unit tests for `ApiAdapter`** — mock `fetch` to test:
  - `auto` mode falls back to Chat Completions when `OPTIONS /v1/responses` fails.
  - `auto` mode selects Responses API on `200` and `405` responses.
  - Concurrent callers during probe share a single `OPTIONS` request.
  - `updateConfig()` clears the capability cache.
- [ ] **Unit tests for `ChatCompletions`** — assert that history is **not** mutated when the request fails (network error / non-2xx).
- [ ] **End-to-end smoke test** — start a mock HTTP server, open the app in a headless browser (Playwright), send a voice input via the mic button, and assert the response appears in the chat view.

### Stability

- [ ] **LC3 decoder robustness** — add error handling for malformed BLE audio frames and empty recordings.
- [x] **Retry logic for BLE display updates** — `GlassesRenderer.sendText()` now retries the textContainerUpgrade→rebuildPageContainer sequence with a short backoff before giving up; a fully-exhausted failure surfaces as a quiet "⚠ HUD" indicator in the status bar (self-clears on the next successful send) instead of silently latching for the rest of the turn.
- [ ] **Streaming abort** — implement an abort button / gesture that cancels the in-flight `fetch` (via `AbortController`) and stops the SSE stream mid-response.
- [x] **agent-hub subprocess timeouts** — `claudeCli`/`codexCli` adapters now enforce an inactivity timeout, a wall-clock cap, and a periodic heartbeat status, so a hung CLI subprocess surfaces an error instead of leaving the HUD on "thinking…" forever. Configurable via `AGENT_INACTIVITY_TIMEOUT_MS` / `AGENT_WALL_CLOCK_MAX_MS` / `AGENT_HEARTBEAT_INTERVAL_MS`.
- [x] **SSE stream resume** — the agent-hub buffers each turn's SSE events per session (`streamBuffer.ts`) and exposes `GET /v1/chat/completions/stream?session_id=...&after=<cursor>`; `ChatCompletions.ts` reconnects through it automatically if the connection drops or ends without `[DONE]`, so a dropped wifi link or backgrounded WebView loses at most a few seconds of text instead of the whole in-flight answer. A dropped connection no longer aborts the turn on its own — explicit cancellation goes through the new `POST /v1/sessions/:id/cancel`, called by the app when the user clears the conversation or starts a new turn.

---

## Phase 2 — Feature development (mid-term)

### AI capabilities

- [ ] **Function calling / tool use** — expose the Responses API's native tools (`web_search`, `code_interpreter`) through the UI. Allow the user to enable/disable tools in Settings.
- [ ] **Multi-modal input** — explore sending images captured from the phone camera alongside the voice prompt. Design note: other G2 apps report the glasses' own sensor streams (e.g. IMU) as historically unreliable — firmware may not populate them at all — so any new sensor/camera input path should feature-detect and gracefully degrade rather than assume availability.
- [ ] **Structured output mode** — add a setting to request JSON-structured responses for use-cases like reminders, calendar events, etc.

### Voice pipeline

- [ ] **Continuous listening mode** — opt-in always-on wake-word detection (e.g. "Hey CI") without requiring a long-press.
- [ ] **STT language selection** — expose a language selector in Settings for Whisper's `language` parameter.
- [ ] **TTS voice selection** — allow choosing the browser's available `SpeechSynthesisVoice` options from Settings.

### Display

- [ ] **Markdown rendering** — strip or convert basic markdown (bold, bullets, headers) to plain text suitable for the 5-line display.
- [ ] **Notification cards** — use the Even Hub SDK's notification API to push short alerts from the AI backend.
- [ ] **Display brightness / font size settings** — expose G2 display preferences through the Settings view.

### Integration

- [ ] **CI-server agentic skills** — implement the Agent Skills standard to allow CI-server to trigger phone actions (calls, calendar, messages) via the glasses.
- [ ] **Webhook / push notifications** — allow the backend to proactively push messages to the glasses display (e.g. reminders, news headlines). Design note: rate-limit unsolicited pushes (e.g. a sliding-window cap) independent of any master "allow proactive" toggle, so a misbehaving backend can't spam the HUD — this is a pattern worth baking in from the start rather than retrofitting.

---

## Phase 3 — Polish and distribution (longer-term)

### Developer experience

- [ ] **Automated CI pipeline** — GitHub Actions workflow that runs `npm run typecheck` and unit tests on every pull request.
- [ ] **Linter configuration** — add ESLint with TypeScript and recommended rules; integrate with the CI pipeline.
- [ ] **Storybook / component docs** — document the `ChatView`, `SettingsView`, and `StatusBar` components visually.

### Production quality

- [ ] **Content Security Policy** — add CSP headers in `index.html` to restrict external script execution.
- [ ] **Settings encryption** — optionally encrypt the stored API key in `localStorage` using the Web Crypto API.
- [ ] **Offline mode** — cache the app shell with a Service Worker so the UI loads without network access (AI features degrade gracefully).

### Distribution

- [ ] **Even Hub store listing** — create a proper app listing with screenshots and description for the Even Hub portal.
- [ ] **Version tagging** — establish a semantic versioning convention and automate version bumps via CI.
- [ ] **Changelog** — maintain a `CHANGELOG.md` to track notable changes between releases.

---

## Known limitations to address

| Limitation | Priority | Notes |
|---|---|---|
| ~~`previousResponseId` not captured in streaming mode~~ | ~~High~~ | **Fixed.** `StreamParser` now extracts the id from `response.created`/`response.completed` SSE events (a new `response_id` AgentEvent); `ResponsesApi.send()` captures it in both streaming and non-streaming mode. |
| ~~No retry on failed BLE display update~~ | ~~Medium~~ | **Fixed** — see Stability section above. |
| History grows unboundedly in Chat Completions mode | Medium | Already handled — `ChatCompletions.sendEvents()` trims to `Settings.maxHistoryMessages` (default 20) after every turn; this row was stale documentation, not an open gap. |
| ~~No error recovery for expired `previous_response_id`~~ | ~~Medium~~ | **Fixed.** `ResponsesApi` detects a 400/404 whose message names `previous_response_id`, clears the stale id, and retries once as a fresh turn. |
| Single fixed system prompt | Low | Allow per-session or per-conversation system prompt overrides |
