# Even Realities — Resources & Community Notes

A curated collection of links, community findings, and development tips for building on the Even Realities G2 / R1 platform.

---

## Official Resources

| Resource | URL |
|---|---|
| Even Realities website | <https://www.evenrealities.com/smart-glasses> |
| Even Hub (portal and docs) | <https://hub.evenrealities.com/> |
| Even Hub developer console | <https://hub.evenrealities.com/hub> |
| Even Hub support docs | <https://support.evenrealities.com/hc/en-us/articles/15016109505679-Even-Hub-Pilot-Program> |
| Even Hub SDK (npm) | <https://www.npmjs.com/package/@evenrealities/even_hub_sdk> |
| Even Hub CLI (npm) | <https://www.npmjs.com/package/@evenrealities/evenhub-cli> |
| Official Demo App (GitHub) | <https://github.com/even-realities/EvenDemoApp> |
| Even Hub InNovel example | <https://github.com/even-realities/EH-InNovel> |
| Software Design Guidelines (Figma) | <https://www.figma.com/design/X82y5uJvqMH95jgOfmV34j/Even-Realities---Software-Design-Guidelines--Public-?node-id=2922-80782> |

---

## Community Projects

| Project | URL | Notes |
|---|---|---|
| `@jappyjan/even-better-sdk` (npm) | <https://www.npmjs.com/package/@jappyjan/even-better-sdk> | Community-maintained SDK wrapper with improved ergonomics |
| even-jarvis | <https://github.com/iDigz/even-jarvis> | AI assistant Even Hub app (Jarvis-style) |
| pong-even-g2 | <https://github.com/nickustinov/pong-even-g2> | Pong game for Even G2 |
| even-dev | <https://github.com/BxNxM/even-dev> | Dev tooling / notes for Even platform |
| even-g2-notes | <https://github.com/nickustinov/even-g2-notes/tree/main> | Community documentation and reverse-engineered notes |
| awesome-even-realities-g1 | <https://github.com/galfaroth/awesome-even-realities-g1> | Curated list for G1 (much applies to G2) |
| rdt-even-g2-rddit-client | <https://github.com/fuutott/rdt-even-g2-rddit-client> | Reddit client running on G2 |
| even-ui-builder | <https://langerhans.github.io/even-ui-builder/> | Visual UI layout builder for Even Hub apps |
| Mentraglass OS | <https://mentraglass.com/os> | Alternative OS / firmware exploration |

---

## Video Resources

| Title | URL |
|---|---|
| Even G2 development walkthrough | <https://www.youtube.com/watch?v=PcQphgdt1IA> |
| Streamed demo (app in action) | <https://streamable.com/hdqzz8> |

---

## Community Discussions (Reddit)

| Thread | URL |
|---|---|
| r/EvenRealities — top posts (all time) | <https://www.reddit.com/r/EvenRealities/top/?t=all> |
| "Good news bad news — I think I figured out why…" | <https://www.reddit.com/r/EvenRealities/comments/1i4mlgh/good_new_bad_news_i_think_i_figured_out_why/> |

---

## npm Packages

Browse all Even Realities packages:
<https://www.npmjs.com/search?q=evenrealities>

Key packages:

| Package | Description |
|---|---|
| `@evenrealities/even_hub_sdk` | Official Even Hub SDK |
| `@evenrealities/evenhub-cli` | CLI for publishing Even Hub apps |
| `@evenrealities/evenhub-simulator` | Desktop simulator for Even Hub apps |
| `@jappyjan/even-better-sdk` | Community SDK wrapper |

---

## Developer Tips

These tips are compiled from the Even Realities developer community:

### Your app is a website

- An Even Hub app is effectively a **website** (HTML + CSS + JavaScript/TypeScript).
- It runs inside a WebView in the Even Hub mobile app, or in any browser.
- Development is standard web dev with the added Even Hub SDK bridge.

### TypeScript + npm

- Even Hub apps are conventionally written in **TypeScript** (a typed superset of JavaScript).
- Dependencies are standard npm packages — run `npm install` after cloning.
- No special build toolchain is required beyond a bundler like Vite.

### Vite is the recommended bundler

- `vite` provides a fast dev server with HMR and produces optimised production bundles.
- Start: `vite --host <IP> --port <PORT>` (or `npm run dev` in this project).
- Build: `vite build` (or `npm run build`).

### index.html is the entry point

- The Even Hub portal and simulator look for `index.html` in the root of your app.
- This file must exist and must load your main script.

### SDK bridge vs browser mode

- The `waitForEvenAppBridge()` function resolves when the Even Hub mobile app injects the bridge.
- In a plain desktop browser it times out — handle this gracefully and show a "browser mode" warning.
- All non-BLE functionality (settings, chat history, AI requests) works in browser mode.

### Simulator workflow

- Keep **one terminal** running Vite.
- Open a **second terminal** with `evenhub-simulator http://<IP>:<PORT>`.
- Edit code → Vite HMR reloads → simulator refreshes instantly.

### Even Hub design guidelines

- Even publishes a detailed Figma file with exact pixel values, colours, and layout rules.
- Give the Figma URL to an AI assistant to generate conformant UI code.
- Green on black is the primary colour scheme for the G2 waveguide display.

### BLE limitations

- BLE has limited throughput and latency. Do not send display updates on every SSE token.
- Throttle display updates to ~150 ms minimum interval (as done in `GlassesRenderer`).
- Keep displayed text concise — users only see 5 lines at a time.

### LC3 audio codec

- The G2 transmits microphone audio over BLE using the **LC3** codec (used in Bluetooth LE Audio).
- The `LC3Decoder.ts` module decodes LC3 frames to PCM/WAV before sending to the STT engine.
- Whisper and other STT backends typically accept WAV or MP3 input.

### Input event quirks

Community reverse-engineering notes document several quirks that can break naïve gesture handling:

- **`CLICK_EVENT = 0` normalization**: `OsEventTypeList.CLICK_EVENT` is the SDK enum constant for a single ring tap, and its numeric value is `0`. When parsed from the SDK JSON payload, `0` may be coerced to `undefined`. Guard input handlers to treat `undefined` as a click in the relevant code paths.
- **Simulator vs real hardware differences**: The simulator may fire `sysEvent` for button presses, while real G2 hardware routes the same action via `textEvent` or `listEvent` depending on the active container type. Test both paths.
- **Scroll debounce**: Scroll events can fire rapidly. Implement a cooldown of ~300 ms to avoid double-firing page navigation actions.
- **Reliable gesture capture**: If the firmware's internal scroll handler consumes events before your app sees them, use a hidden text container with `isEventCapture: 1`. This pattern is documented in the [pong-even-g2](https://github.com/nickustinov/pong-even-g2) community demo and ensures scroll/tap gestures are delivered to your handler.

### UI state machine

Structure the app around an explicit state machine rather than ad-hoc flags. A proven pattern (from community voice assistant designs):

```
Idle → Listening → Thinking → Answering → Idle
```

- **Idle**: Show last response or welcome screen. Accept tap/scroll for page navigation.
- **Listening**: Mic is active. Show a "recording…" indicator on the display.
- **Thinking**: Audio sent to STT + AI request in flight. Show a "thinking…" indicator.
- **Answering**: Streaming tokens arrive; update display with `textContainerUpgrade`.
- Back to **Idle** when stream ends or on error.

A state machine also helps handle the `abnormal_exit` SDK event gracefully (e.g. app loses foreground while recording).

### Audio recording limits and VAD

- The Even native demo app (Even AI mode) describes a **30-second maximum recording window** for LC3 audio over BLE. Design your UX and buffer sizes to handle a hard stop at ~30 s.
- Consider client-side **Voice Activity Detection (VAD)** to auto-stop recording when the user goes silent, rather than relying on an explicit gesture release:
  - Simple approach: RMS energy threshold + a short hangover period (~500 ms of silence triggers stop).
  - More robust: send audio chunks to the backend and let the server determine end-of-utterance.
- For streaming STT, send 200–500 ms PCM chunks over WebSocket. For non-streaming STT, buffer the full utterance and POST it as a WAV file on release.

### Audio transport: WebSocket vs HTTPS

When sending microphone audio to the backend you have two options:

| Transport | Pros | Cons |
|---|---|---|
| **WebSocket (WSS)** | Bidirectional — audio goes up, partial transcripts come down; avoids browser limits on long-lived POST streams | Slightly more complex to implement |
| **HTTPS chunk upload** | Simpler; works with any fetch-based client | One-way per request; harder to return partial transcripts |

WSS is preferred for a voice assistant where you want to stream partial transcripts back to the display while audio is still being uploaded.

### App packaging and network permissions

Even Hub apps are packaged as `.ehpk` bundles using the `evenhub-cli`:

```bash
evenhub-cli pack          # produces app.ehpk
evenhub-cli publish       # packs + uploads to the portal
```

Add `*.ehpk` to `.gitignore` — it is a build artifact, not source.

The `app.json` manifest controls what network origins your app may call:

```json
{
  "permissions": {
    "network": ["https://api.openai.com", "https://my-server.example.com"]
  }
}
```

For apps where the user can configure their own backend URL (e.g. a LAN IP), use the wildcard:

```json
{
  "permissions": {
    "network": ["*"]
  }
}
```

`["*"]` is explicitly documented in the [even-g2-notes](https://github.com/nickustinov/even-g2-notes/tree/main) community packaging notes. It increases distribution trust requirements and places the security burden on robust auth and TLS.

### Security model

- **Frontend → backend auth**: Use a short-lived session token exchanged via a login or QR-pair flow. Never embed a provider API key in the Even Hub app bundle — it is a web page and can be inspected.
- **Developer / agentic clients → backend**: Issue separate bearer tokens (like OpenAI's API key model) with per-key rate limits, project separation, and audit logging.
- **Correlation IDs**: Add `x-request-id` to every backend request and log it end-to-end. This is critical for debugging intermittent BLE/WebView failures where the same request may be retried multiple times.
- **Privacy**: Avoid sending raw audio or transcripts to third parties unless the user explicitly opts in per-provider. Store conversation logs encrypted; log only hashes or truncated payloads in production metrics.
