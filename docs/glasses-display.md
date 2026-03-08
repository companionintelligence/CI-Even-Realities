# G2 Glasses Display Reference

Technical details about the Even Realities G2 MicroLED display and how `GlassesRenderer.ts` formats content for it.

---

## Table of Contents

1. [Hardware specs](#hardware-specs)
2. [Display constraints](#display-constraints)
3. [Text rendering pipeline](#text-rendering-pipeline)
4. [Pagination](#pagination)
5. [BLE update strategy](#ble-update-strategy)
6. [Ring gesture navigation](#ring-gesture-navigation)
7. [SDK display APIs](#sdk-display-apis)
8. [Design guidelines](#design-guidelines)

---

## Hardware specs

| Property | Value |
|---|---|
| Display type | Binocular MicroLED waveguide |
| Resolution | 640 × 350 px |
| Color | Green on black (monochrome) |
| Connectivity | Bluetooth Low Energy (BLE) via phone |
| Audio | Bone-conduction speakers (on-device TTS handled by phone via Web Speech API) |
| Input | Capacitive touchbar (left arm), optional Even Ring |

---

## Display constraints

The G2 display renders text in a fixed-size monospace-equivalent font. The usable text area within the 640 × 350 display is:

| Parameter | Value |
|---|---|
| Usable text width | 488 px |
| Font size | ~21 px |
| Character width ratio | 0.55 (average char width / font size) |
| Characters per line | ≈ 42 (`floor(488 / (21 × 0.55))`) |
| Lines per screen | 5 |

These values are defined as constants in `GlassesRenderer.ts`:

```typescript
const DISPLAY_WIDTH_PX  = 488;
const FONT_SIZE_PX      = 21;
const LINES_PER_SCREEN  = 5;
const CHARS_PER_LINE    = Math.floor(DISPLAY_WIDTH_PX / (FONT_SIZE_PX * 0.55)); // ≈ 42
```

> **Note:** The character count is an empirical approximation. The G2 uses a proportional-ish rendering that varies by character. 42 characters per line is a conservative estimate to avoid unexpected wrapping.

---

## Text rendering pipeline

When a response (streaming or complete) arrives, it goes through two stages:

### Stage 1: Word wrap (`wordWrap`)

`wordWrap(text, maxChars)` splits the raw response string into display-width lines:

1. Split on existing newlines (preserve paragraph structure).
2. For each paragraph, accumulate words into the current line.
3. When adding a word would exceed `maxChars`, push the current line and start a new one.
4. Words longer than `maxChars` are hard-wrapped at the character boundary.

```typescript
export function wordWrap(text: string, maxChars: number): string[]
```

### Stage 2: Pagination (`paginate`)

`paginate(lines, linesPerScreen)` groups the wrapped lines into pages of 5 lines each:

```typescript
export function paginate(lines: string[], linesPerScreen: number): string[][]
```

### Page indicator

When there are multiple pages, the last line of each page is replaced with a page indicator:

```
[1/3]
[2/3]
[3/3]
```

This reserves one line for navigation feedback, giving 4 lines of content per page when a response spans multiple screens.

---

## Pagination

### Example

Input text: `"The quick brown fox jumps over the lazy dog. And then the fox ran away into the forest."` (≈ 88 characters)

After word-wrap (42 chars/line):

```
Line 1: "The quick brown fox jumps over the lazy"
Line 2: "dog. And then the fox ran away into the"
Line 3: "forest."
```

Paginated at 5 lines/screen → 1 page (no indicator needed):

```
Screen 1:
  The quick brown fox jumps over the lazy
  dog. And then the fox ran away into the
  forest.
```

---

## BLE update strategy

The G2 communicates over BLE which has limited throughput. Sending a display update on every streamed token would cause:

- **Flickering** on the display
- **BLE buffer overflow**
- **Excessive battery drain**

`GlassesRenderer.displayStreaming()` therefore **throttles** BLE writes:

```typescript
const STREAMING_THROTTLE_MS = 150;
```

During streaming:
- A display update is sent **at most once every 150 ms**.
- The **last page** of the accumulated response is shown (auto-scrolling to the most recent content).
- A **final guaranteed update** is sent when the stream ends, showing page 1 of the full paginated response.

After streaming completes, the user can navigate pages with ring gestures.

### Update method priority

The SDK provides two methods for updating the display. `GlassesRenderer` tries the faster one first:

1. **`textContainerUpgrade`** — Lightweight content-only update. Used when the container already exists.
2. **`rebuildPageContainer`** — Full container rebuild. Used as a fallback when the lightweight update fails (e.g. on first use after a display sleep).

---

## Ring gesture navigation

Once a response is fully rendered, users navigate with the **Even Ring** or touchbar:

| Gesture | SDK Event | Action |
|---|---|---|
| Single tap | `CLICK_EVENT` | Next page (`nextPage()`) |
| Double tap | `DOUBLE_CLICK_EVENT` | Clear conversation |
| Scroll up | `SCROLL_TOP_EVENT` | Previous page (`prevPage()`) |
| Scroll down | `SCROLL_BOTTOM_EVENT` | Next page (`nextPage()`) |
| Long press start | `FOREGROUND_ENTER_EVENT` | Begin voice recording |
| Long press end | `FOREGROUND_EXIT_EVENT` | Stop recording, transcribe, send |

---

## SDK display APIs

### Container initialisation

Called once after the bridge is ready:

```typescript
const container = new CreateStartUpPageContainer({
  containerTotalNum: 1,
  textObject: [
    new TextContainerProperty({
      containerID: 1,
      containerName: 'main',
      xPosition: 0,
      yPosition: 0,
      width: 488,
      height: 350,
      content: '',
    }),
  ],
});
await bridge.createStartUpPageContainer(container);
```

### Text update (preferred)

```typescript
await bridge.textContainerUpgrade(
  new TextContainerUpgrade({
    containerID: 1,
    containerName: 'main',
    content: 'Hello, world!\n[1/2]',
  })
);
```

### Full rebuild (fallback)

```typescript
await bridge.rebuildPageContainer(
  new RebuildPageContainer({
    containerTotalNum: 1,
    textObject: [
      new TextContainerProperty({
        containerID: 1,
        containerName: 'main',
        xPosition: 0,
        yPosition: 0,
        width: 488,
        height: 350,
        content: 'Hello, world!\n[1/2]',
      }),
    ],
  })
);
```

---

## Design guidelines

Even Realities publishes official design guidelines for Even Hub apps:

**Figma:** [Even Realities — Software Design Guidelines (Public)](https://www.figma.com/design/X82y5uJvqMH95jgOfmV34j/Even-Realities---Software-Design-Guidelines--Public-?node-id=2922-80782)

Key guidelines relevant to this app:

- **Color palette:** Green (`#00FF00`) on black (`#000000`) for the MicroLED display.
- **Page margins:** Use the published pixel values for text positioning.
- **Font size:** 21 px is the standard body text size for G2 apps.
- **Contrast:** All foreground elements should use high-contrast green/white tones for legibility on the waveguide display.
- **Brevity:** Responses are displayed on a 5-line screen. AI system prompts should instruct the model to be concise.

The UI in the phone app (ChatView, SettingsView) follows a dark-mode style consistent with the Even brand aesthetic (`styles.css`).
