import { describe, it, expect, vi } from 'vitest';
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import {
  StartUpPageCreateResult,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk';
import { GlassesRenderer, wordWrap, paginate } from '../GlassesRenderer.ts';

/** Minimal fake Even Hub bridge capturing text sent to the display. */
function makeFakeBridge() {
  const textContainerUpgrade = vi.fn(async (_u: TextContainerUpgrade) => true);
  const bridge = {
    createStartUpPageContainer: vi.fn(async () => StartUpPageCreateResult.success),
    textContainerUpgrade,
    rebuildPageContainer: vi.fn(async () => true),
  } as unknown as EvenAppBridge;
  return { bridge, textContainerUpgrade };
}

describe('displayPromptCard', () => {
  it('renders the safety-inverted footer: double-tap approves, single tap denies', async () => {
    const { bridge, textContainerUpgrade } = makeFakeBridge();
    const renderer = new GlassesRenderer(bridge);

    await renderer.displayPromptCard({
      tool: 'Bash',
      summary: 'Run `git push origin main`?',
    });

    const calls = textContainerUpgrade.mock.calls;
    const sent = calls[calls.length - 1][0].content ?? '';
    const lines = sent.split('\n');
    // Approve must require the deliberate gesture (double-tap); a stray
    // single tap only denies.
    expect(lines[lines.length - 1]).toBe('2×tap: Approve · tap: Deny');
  });

  it('uses the prompt-supplied option labels in the footer', async () => {
    const { bridge, textContainerUpgrade } = makeFakeBridge();
    const renderer = new GlassesRenderer(bridge);

    await renderer.displayPromptCard({
      tool: 'Write',
      summary: 'Create /tmp/notes.md?',
      approveLabel: 'Yes',
      denyLabel: 'No',
    });

    const calls = textContainerUpgrade.mock.calls;
    const sent = calls[calls.length - 1][0].content ?? '';
    const lines = sent.split('\n');
    expect(lines[lines.length - 1]).toBe('2×tap: Yes · tap: No');
  });
});

describe('sendText retry', () => {
  it('retries after a transient failure and succeeds without throwing', async () => {
    const { bridge, textContainerUpgrade } = makeFakeBridge();
    let call = 0;
    textContainerUpgrade.mockImplementation(async () => {
      call++;
      return call > 1; // fails once, then succeeds
    });
    (bridge as unknown as { rebuildPageContainer: ReturnType<typeof vi.fn> })
      .rebuildPageContainer = vi.fn(async () => false); // never helps, forces reliance on the retry

    const renderer = new GlassesRenderer(bridge);
    await expect(renderer.displayText('hello')).resolves.toBeUndefined();
    expect(textContainerUpgrade).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries when every attempt fails', async () => {
    const { bridge, textContainerUpgrade } = makeFakeBridge();
    textContainerUpgrade.mockImplementation(async () => false);
    (bridge as unknown as { rebuildPageContainer: ReturnType<typeof vi.fn> })
      .rebuildPageContainer = vi.fn(async () => false);

    const renderer = new GlassesRenderer(bridge);
    await expect(renderer.displayText('hello')).rejects.toThrow(
      'both textContainerUpgrade and rebuildPageContainer failed'
    );
  });

  it('recovers on the next call after a fully-exhausted failure (no permanent latch)', async () => {
    const { bridge, textContainerUpgrade } = makeFakeBridge();
    let failEverything = true;
    textContainerUpgrade.mockImplementation(async () => !failEverything);
    (bridge as unknown as { rebuildPageContainer: ReturnType<typeof vi.fn> })
      .rebuildPageContainer = vi.fn(async () => !failEverything);

    const renderer = new GlassesRenderer(bridge);
    await expect(renderer.displayText('first')).rejects.toThrow();

    failEverything = false;
    await expect(renderer.displayText('second')).resolves.toBeUndefined();
  });
});

describe('wordWrap', () => {
  it('returns a single empty line for empty string', () => {
    // An empty string is one empty paragraph — it produces one empty line,
    // which paginate can then use as the placeholder page.
    expect(wordWrap('', 10)).toEqual(['']);
  });

  it('wraps a single short word', () => {
    expect(wordWrap('Hello', 10)).toEqual(['Hello']);
  });

  it('fits text within maxChars on one line', () => {
    expect(wordWrap('Hello World', 20)).toEqual(['Hello World']);
  });

  it('wraps at word boundary when line exceeds maxChars', () => {
    expect(wordWrap('Hello World', 8)).toEqual(['Hello', 'World']);
  });

  it('hard-wraps a single word longer than maxChars', () => {
    expect(wordWrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('hard-wraps a long word that appears mid-sentence', () => {
    expect(wordWrap('Go abcdefghij end', 6)).toEqual(['Go', 'abcdef', 'ghij', 'end']);
  });

  it('handles multi-paragraph text (newlines)', () => {
    const result = wordWrap('Hello World\nSecond paragraph', 20);
    expect(result).toEqual(['Hello World', 'Second paragraph']);
  });

  it('preserves blank lines from empty paragraphs', () => {
    const result = wordWrap('Line one\n\nLine two', 20);
    expect(result).toEqual(['Line one', '', 'Line two']);
  });

  it('handles text that fills exactly maxChars on one line', () => {
    // 'ABCD' is exactly 4 chars — should fit on one line
    expect(wordWrap('ABCD', 4)).toEqual(['ABCD']);
  });

  it('wraps multiple words across several lines', () => {
    const result = wordWrap('one two three four five', 9);
    // 'one two' = 7, add 'three' => 11 > 9, so wrap
    // 'three' = 5, add 'four' => 10 > 9, so wrap
    // 'four' = 4, add 'five' => 9 <= 9, stay
    expect(result).toEqual(['one two', 'three', 'four five']);
  });

  it('ignores extra spaces between words', () => {
    // split(' ') produces empty tokens for consecutive spaces; they are skipped
    const result = wordWrap('a  b', 10);
    expect(result).toEqual(['a b']);
  });

  it('handles very small maxChars of 1', () => {
    expect(wordWrap('ab', 1)).toEqual(['a', 'b']);
  });

  it('handles text with only newlines', () => {
    expect(wordWrap('\n\n', 10)).toEqual(['', '', '']);
  });
});

describe('paginate', () => {
  it('returns a single page with one empty line for empty input', () => {
    expect(paginate([], 5)).toEqual([['']]);
  });

  it('returns a single page when lines fit within linesPerScreen', () => {
    expect(paginate(['a', 'b', 'c'], 5)).toEqual([['a', 'b', 'c']]);
  });

  it('returns a single page when lines exactly fill one screen', () => {
    expect(paginate(['a', 'b', 'c', 'd', 'e'], 5)).toEqual([
      ['a', 'b', 'c', 'd', 'e'],
    ]);
  });

  it('splits into two pages when lines exceed one screen by one', () => {
    const lines = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(paginate(lines, 5)).toEqual([
      ['a', 'b', 'c', 'd', 'e'],
      ['f'],
    ]);
  });

  it('splits into exactly N pages when lines fill them exactly', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i}`);
    const pages = paginate(lines, 5);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual(['line0', 'line1', 'line2', 'line3', 'line4']);
    expect(pages[1]).toEqual(['line5', 'line6', 'line7', 'line8', 'line9']);
  });

  it('handles linesPerScreen of 1', () => {
    expect(paginate(['a', 'b', 'c'], 1)).toEqual([['a'], ['b'], ['c']]);
  });

  it('handles a large number of lines', () => {
    const lines = Array.from({ length: 23 }, (_, i) => `L${i}`);
    const pages = paginate(lines, 5);
    // 23 / 5 = 4 full pages + 3-line remainder
    expect(pages).toHaveLength(5);
    expect(pages[4]).toEqual(['L20', 'L21', 'L22']);
  });
});
