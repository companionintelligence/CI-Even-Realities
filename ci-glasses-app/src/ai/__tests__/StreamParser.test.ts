import { describe, it, expect } from 'vitest';
import { parseSSEStream } from '../StreamParser.ts';

/** Build a Response whose body streams the given string chunks. */
function makeSSEResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

/** Collect all yielded strings from the async generator into an array. */
async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const results: string[] = [];
  for await (const chunk of gen) {
    results.push(chunk);
  }
  return results;
}

describe('parseSSEStream', () => {
  describe('Chat Completions format', () => {
    it('yields content from a single data line', async () => {
      const data = JSON.stringify({
        choices: [{ delta: { content: 'Hello' } }],
      });
      const response = makeSSEResponse([`data: ${data}\ndata: [DONE]\n`]);
      expect(await collect(parseSSEStream(response))).toEqual(['Hello']);
    });

    it('yields multiple chunks in order', async () => {
      const d1 = JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] });
      const d2 = JSON.stringify({ choices: [{ delta: { content: 'lo' } }] });
      const response = makeSSEResponse([
        `data: ${d1}\ndata: ${d2}\ndata: [DONE]\n`,
      ]);
      expect(await collect(parseSSEStream(response))).toEqual(['Hel', 'lo']);
    });

    it('stops at [DONE] and ignores lines after it', async () => {
      const d1 = JSON.stringify({ choices: [{ delta: { content: 'A' } }] });
      const d2 = JSON.stringify({ choices: [{ delta: { content: 'B' } }] });
      const response = makeSSEResponse([
        `data: ${d1}\ndata: [DONE]\ndata: ${d2}\n`,
      ]);
      expect(await collect(parseSSEStream(response))).toEqual(['A']);
    });

    it('handles \\r\\n line terminators', async () => {
      const data = JSON.stringify({
        choices: [{ delta: { content: 'CR-LF' } }],
      });
      const response = makeSSEResponse([`data: ${data}\r\ndata: [DONE]\r\n`]);
      expect(await collect(parseSSEStream(response))).toEqual(['CR-LF']);
    });

    it('handles \\r-only line terminators', async () => {
      const data = JSON.stringify({
        choices: [{ delta: { content: 'CR' } }],
      });
      const response = makeSSEResponse([`data: ${data}\rdata: [DONE]\r`]);
      expect(await collect(parseSSEStream(response))).toEqual(['CR']);
    });

    it('handles chunks split across multiple network reads', async () => {
      const data = JSON.stringify({
        choices: [{ delta: { content: 'split' } }],
      });
      // Simulate the data split mid-line across two Uint8Array chunks
      const full = `data: ${data}\ndata: [DONE]\n`;
      const half = Math.floor(full.length / 2);
      const response = makeSSEResponse([full.slice(0, half), full.slice(half)]);
      expect(await collect(parseSSEStream(response))).toEqual(['split']);
    });

    it('skips lines without "data: " prefix (e.g. comments, event:)', async () => {
      const data = JSON.stringify({ choices: [{ delta: { content: 'ok' } }] });
      const response = makeSSEResponse([
        `event: message\ndata: ${data}\n: comment\ndata: [DONE]\n`,
      ]);
      expect(await collect(parseSSEStream(response))).toEqual(['ok']);
    });

    it('skips malformed JSON gracefully', async () => {
      const data = JSON.stringify({ choices: [{ delta: { content: 'good' } }] });
      const response = makeSSEResponse([
        `data: {bad json\ndata: ${data}\ndata: [DONE]\n`,
      ]);
      expect(await collect(parseSSEStream(response))).toEqual(['good']);
    });

    it('skips delta with no content field', async () => {
      const d1 = JSON.stringify({ choices: [{ delta: {} }] });
      const d2 = JSON.stringify({ choices: [{ delta: { content: 'X' } }] });
      const response = makeSSEResponse([
        `data: ${d1}\ndata: ${d2}\ndata: [DONE]\n`,
      ]);
      expect(await collect(parseSSEStream(response))).toEqual(['X']);
    });
  });

  describe('Responses API format', () => {
    it('yields text from delta.text field', async () => {
      const data = JSON.stringify({ delta: { text: 'World' } });
      const response = makeSSEResponse([`data: ${data}\ndata: [DONE]\n`]);
      expect(await collect(parseSSEStream(response))).toEqual(['World']);
    });

    it('yields text when delta is a plain string', async () => {
      const data = JSON.stringify({ delta: 'plain' });
      const response = makeSSEResponse([`data: ${data}\ndata: [DONE]\n`]);
      expect(await collect(parseSSEStream(response))).toEqual(['plain']);
    });

    it('returns empty for unknown shape', async () => {
      const data = JSON.stringify({ something: 'else' });
      const response = makeSSEResponse([`data: ${data}\ndata: [DONE]\n`]);
      expect(await collect(parseSSEStream(response))).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('throws when response.body is null', async () => {
      const response = new Response(null, { status: 200 });
      await expect(collect(parseSSEStream(response))).rejects.toThrow(
        'Response body is null'
      );
    });

    it('yields nothing for an empty stream', async () => {
      const response = makeSSEResponse([]);
      expect(await collect(parseSSEStream(response))).toEqual([]);
    });

    it('yields nothing for a stream with only [DONE]', async () => {
      const response = makeSSEResponse(['data: [DONE]\n']);
      expect(await collect(parseSSEStream(response))).toEqual([]);
    });
  });
});
