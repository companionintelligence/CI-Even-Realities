/**
 * GlassesRenderer.ts
 *
 * Formats AI response text for the G2 binocular MicroLED display and sends
 * it to the glasses via the Even Hub SDK.
 *
 * G2 display constraints:
 *  - Usable text width: 488 px
 *  - Font size: ~21 px (monospace-equivalent)
 *  - Lines per screen: 5
 *  - Display: 640×350 MicroLED (green on black)
 */

import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  StartUpPageCreateResult,
} from '@evenrealities/even_hub_sdk';

const DISPLAY_WIDTH_PX = 488;
const FONT_SIZE_PX = 21;
const LINES_PER_SCREEN = 5;
// Approximate characters per line. 0.55 is an empirically-determined ratio of
// average character width to font size for the G2's monospace display rendering.
const CHARS_PER_LINE = Math.floor(DISPLAY_WIDTH_PX / (FONT_SIZE_PX * 0.55));

// Minimum interval (ms) between BLE display updates during streaming.
// Sending on every SSE chunk can overwhelm the BLE layer, cause flickering,
// and drain battery — throttling to ~150 ms gives a smooth, readable update
// rate while staying well within typical BLE throughput limits.
const STREAMING_THROTTLE_MS = 150;

// Container IDs
const TEXT_CONTAINER_ID = 1;

export class GlassesRenderer {
  private pages: string[][] = [];
  private currentPage = 0;
  private initialized = false;

  constructor(private bridge: EvenAppBridge) {}

  /**
   * Initialize the glasses display container (must be called once after bridge ready).
   */
  async init(): Promise<boolean> {
    if (this.initialized) return true;

    const container = new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [
        new TextContainerProperty({
          containerID: TEXT_CONTAINER_ID,
          containerName: 'main',
          xPosition: 0,
          yPosition: 0,
          width: DISPLAY_WIDTH_PX,
          height: 350,
          content: '',
        }),
      ],
    });

    const result = await this.bridge.createStartUpPageContainer(container);
    this.initialized =
      result === StartUpPageCreateResult.success;
    return this.initialized;
  }

  /**
   * Show a short status message on the glasses display.
   */
  async showStatus(message: string): Promise<void> {
    await this.sendText(message);
  }

  /**
   * Display streamed text on the glasses in real-time as chunks arrive.
   * Updates the display at most every STREAMING_THROTTLE_MS milliseconds to
   * avoid overwhelming the BLE layer with per-chunk updates, which would
   * cause flickering and unnecessary battery drain. A final update is always
   * sent after the stream ends to ensure the display shows complete content.
   */
  async displayStreaming(textStream: AsyncGenerator<string>): Promise<void> {
    let accumulated = '';
    let lastSendTime = 0;

    for await (const chunk of textStream) {
      accumulated += chunk;

      const now = Date.now();
      if (now - lastSendTime >= STREAMING_THROTTLE_MS) {
        const lines = wordWrap(stripMarkdown(accumulated), CHARS_PER_LINE);
        const allPages = paginate(lines, LINES_PER_SCREEN);
        // Show the last page while streaming (auto-scroll to end)
        const lastPage = allPages[allPages.length - 1] ?? [];
        await this.sendText(lastPage.join('\n'));
        lastSendTime = now;
      }
    }

    // After streaming completes, build full paginated view and show first page
    const lines = wordWrap(stripMarkdown(accumulated), CHARS_PER_LINE);
    this.pages = paginate(lines, LINES_PER_SCREEN);
    this.currentPage = 0;
    await this.showCurrentPage();
  }

  /**
   * Display a static text string (non-streaming).
   * Basic Markdown formatting is stripped before rendering.
   */
  async displayText(text: string): Promise<void> {
    const plain = stripMarkdown(text);
    const lines = wordWrap(plain, CHARS_PER_LINE);
    this.pages = paginate(lines, LINES_PER_SCREEN);
    this.currentPage = 0;
    await this.showCurrentPage();
  }

  /** Advance to the next page (ring tap right). */
  async nextPage(): Promise<void> {
    if (this.currentPage < this.pages.length - 1) {
      this.currentPage++;
      await this.showCurrentPage();
    }
  }

  /** Go back to the previous page (ring tap left). */
  async prevPage(): Promise<void> {
    if (this.currentPage > 0) {
      this.currentPage--;
      await this.showCurrentPage();
    }
  }

  get pageCount(): number {
    return this.pages.length;
  }

  get pageIndex(): number {
    return this.currentPage;
  }

  private async showCurrentPage(): Promise<void> {
    const page = this.pages[this.currentPage];
    if (!page) return;

    const pageIndicator =
      this.pages.length > 1
        ? `[${this.currentPage + 1}/${this.pages.length}]`
        : '';
    const lines = pageIndicator
      ? [...page.slice(0, LINES_PER_SCREEN - 1), pageIndicator]
      : page;

    await this.sendText(lines.join('\n'));
  }

  private async sendText(text: string): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }

    // Try textContainerUpgrade first (lightweight update)
    const ok = await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: TEXT_CONTAINER_ID,
        containerName: 'main',
        content: text,
      })
    );

    if (!ok) {
      // Fall back to full rebuild
      const container = new RebuildPageContainer({
        containerTotalNum: 1,
        textObject: [
          new TextContainerProperty({
            containerID: TEXT_CONTAINER_ID,
            containerName: 'main',
            xPosition: 0,
            yPosition: 0,
            width: DISPLAY_WIDTH_PX,
            height: 350,
            content: text,
          }),
        ],
      });
      const rebuilt = await this.bridge.rebuildPageContainer(container);
      if (!rebuilt) {
        throw new Error('GlassesRenderer: both textContainerUpgrade and rebuildPageContainer failed');
      }
    }
  }
}

/**
 * Strip basic Markdown formatting so the plain-text G2 display renders cleanly.
 *
 * Handles:
 *  - ATX headers: `## Heading` → `Heading`
 *  - Bold: `**text**` or `__text__` → `text`
 *  - Italic: `*text*` or `_text_` → `text`
 *  - Inline code: `` `code` `` → `code`
 *  - Unordered list markers: `- item` or `* item` → `• item`
 *  - Ordered list markers: `1. item` → `item`
 *  - Horizontal rules: `---`, `***`, `___` → (empty line)
 *  - Blockquotes: `> text` → `text`
 */
export function stripMarkdown(text: string): string {
  return text
    // ATX headers (## Title) — strip leading # characters
    .replace(/^#{1,6}\s+/gm, '')
    // Bold + italic: ***text*** or ___text___
    .replace(/\*{3}([^*]+?)\*{3}/g, '$1')
    .replace(/_{3}([^_]+?)_{3}/g, '$1')
    // Bold: **text** or __text__
    .replace(/\*{2}([^*]+?)\*{2}/g, '$1')
    .replace(/_{2}([^_]+?)_{2}/g, '$1')
    // Italic: *text* or _text_ (not part of ** or __)
    .replace(/(^|[^*])\*(?!\*)([^*]+?)\*(?!\*)/g, '$1$2')
    .replace(/(^|[^_])_(?!_)([^_]+?)_(?!_)/g, '$1$2')
    // Inline code: `code`
    .replace(/`([^`]+)`/g, '$1')
    // Horizontal rules (--- / *** / ___)
    .replace(/^(\s*[-*_]){3,}\s*$/gm, '')
    // Blockquotes: > text
    .replace(/^>\s?/gm, '')
    // Unordered list markers (- or *) → bullet
    .replace(/^[\s]*[-*]\s+/gm, '• ')
    // Ordered list markers (1. 2. etc.) → strip number
    .replace(/^\s*\d+\.\s+/gm, '')
    // Collapse multiple consecutive blank lines into one
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Word-wrap text to fit within the specified character width.
 * Breaks on word boundaries; long words are hard-wrapped.
 */
export function wordWrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }

    const words = paragraph.split(' ');
    let current = '';

    for (const word of words) {
      if (word.length === 0) continue;

      // Hard-wrap words longer than maxChars
      if (word.length > maxChars) {
        if (current.length > 0) {
          lines.push(current);
          current = '';
        }
        for (let i = 0; i < word.length; i += maxChars) {
          lines.push(word.slice(i, i + maxChars));
        }
        continue;
      }

      const candidate = current.length === 0 ? word : `${current} ${word}`;
      if (candidate.length <= maxChars) {
        current = candidate;
      } else {
        if (current.length > 0) lines.push(current);
        current = word;
      }
    }

    if (current.length > 0) lines.push(current);
  }

  return lines;
}

/**
 * Split an array of lines into screens of `linesPerScreen` lines each.
 */
export function paginate(
  lines: string[],
  linesPerScreen: number
): string[][] {
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += linesPerScreen) {
    pages.push(lines.slice(i, i + linesPerScreen));
  }
  return pages.length > 0 ? pages : [['']];
}
