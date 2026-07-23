import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassthroughAdapter } from '../passthrough.ts';
import type { ChatRequest, SessionContext } from '../Adapter.ts';
import type { AgentEvent } from '../../events.ts';

const CTX: SessionContext = { sessionId: 's1', signal: new AbortController().signal };

function req(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: 'gpt-test',
    stream: true,
    messages: [{ role: 'user', content: 'hi' }],
    ...overrides,
  };
}

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

function sseResponse(lines: string[], opts: { chunked?: boolean } = {}): Response {
  const bytes = new TextEncoder().encode(lines.join('\n') + '\n');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (opts.chunked) {
        for (const b of bytes) controller.enqueue(new Uint8Array([b]));
      } else {
        controller.enqueue(bytes);
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe('PassthroughAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('kind', () => {
    it('defaults to "openai" when unspecified', () => {
      expect(new PassthroughAdapter({ baseUrl: 'http://x' }).kind).toBe('openai');
    });

    it('respects an explicit kind (used for local-llm / hermes)', () => {
      expect(new PassthroughAdapter({ baseUrl: 'http://x', kind: 'local-llm' }).kind).toBe(
        'local-llm'
      );
      expect(new PassthroughAdapter({ baseUrl: 'http://x', kind: 'hermes' }).kind).toBe(
        'hermes'
      );
    });
  });

  describe('request construction', () => {
    it('POSTs to {baseUrl}/v1/chat/completions with model/messages/stream:true', async () => {
      fetchMock.mockResolvedValue(sseResponse(['data: [DONE]', '']));
      const adapter = new PassthroughAdapter({ baseUrl: 'http://downstream:1234' });
      await collect(adapter.run(req({ model: 'llama3.2' }), CTX));

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://downstream:1234/v1/chat/completions');
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({
        model: 'llama3.2',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      });
    });

    it('includes an Authorization header when an apiKey is configured', async () => {
      fetchMock.mockResolvedValue(sseResponse(['data: [DONE]', '']));
      const adapter = new PassthroughAdapter({ baseUrl: 'http://x', apiKey: 'sk-test' });
      await collect(adapter.run(req(), CTX));

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');
    });

    it('omits the Authorization header when no apiKey is configured', async () => {
      fetchMock.mockResolvedValue(sseResponse(['data: [DONE]', '']));
      const adapter = new PassthroughAdapter({ baseUrl: 'http://x' });
      await collect(adapter.run(req(), CTX));

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
    });

    it('propagates the session AbortSignal to fetch', async () => {
      fetchMock.mockResolvedValue(sseResponse(['data: [DONE]', '']));
      const adapter = new PassthroughAdapter({ baseUrl: 'http://x' });
      const controller = new AbortController();
      await collect(adapter.run(req(), { sessionId: 's', signal: controller.signal }));

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.signal).toBe(controller.signal);
    });
  });

  describe('streaming behavior', () => {
    it('yields a thinking status before the request, and done at the end', async () => {
      fetchMock.mockResolvedValue(sseResponse(['data: [DONE]', '']));
      const adapter = new PassthroughAdapter({ baseUrl: 'http://x' });
      const events = await collect(adapter.run(req(), CTX));
      expect(events[0]).toEqual({ type: 'agent_status', kind: 'thinking' });
      expect(events.at(-1)).toEqual({ type: 'agent_status', kind: 'done' });
    });

    it('relays text deltas verbatim, in order', async () => {
      fetchMock.mockResolvedValue(
        sseResponse([
          'data: ' + JSON.stringify({ choices: [{ delta: { content: 'foo' } }] }),
          'data: ' + JSON.stringify({ choices: [{ delta: { content: 'bar' } }] }),
          'data: [DONE]',
          '',
        ])
      );
      const adapter = new PassthroughAdapter({ baseUrl: 'http://x' });
      const events = await collect(adapter.run(req(), CTX));
      const texts = events.filter((e) => e.type === 'text').map((e) => (e as any).delta);
      expect(texts).toEqual(['foo', 'bar']);
    });

    it('does not strip code fences or markdown links (unlike OpenClaw)', async () => {
      const raw = 'plain ```js\ncode()\n``` and [link](https://x.com)';
      fetchMock.mockResolvedValue(
        sseResponse([
          'data: ' + JSON.stringify({ choices: [{ delta: { content: raw } }] }),
          'data: [DONE]',
          '',
        ])
      );
      const adapter = new PassthroughAdapter({ baseUrl: 'http://x' });
      const events = await collect(adapter.run(req(), CTX));
      const text = events.find((e) => e.type === 'text') as { delta: string };
      expect(text.delta).toBe(raw);
    });

    it('drops empty-string content deltas', async () => {
      fetchMock.mockResolvedValue(
        sseResponse([
          'data: ' + JSON.stringify({ choices: [{ delta: { content: '' } }] }),
          'data: [DONE]',
          '',
        ])
      );
      const adapter = new PassthroughAdapter({ baseUrl: 'http://x' });
      const events = await collect(adapter.run(req(), CTX));
      expect(events.filter((e) => e.type === 'text')).toHaveLength(0);
    });

    it('skips malformed JSON lines without throwing', async () => {
      fetchMock.mockResolvedValue(
        sseResponse([
          'data: {broken',
          'data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }),
          'data: [DONE]',
          '',
        ])
      );
      const adapter = new PassthroughAdapter({ baseUrl: 'http://x' });
      const events = await collect(adapter.run(req(), CTX));
      const texts = events.filter((e) => e.type === 'text').map((e) => (e as any).delta);
      expect(texts).toEqual(['ok']);
    });

    it('ignores non-data lines (comments, blank lines)', async () => {
      fetchMock.mockResolvedValue(
        sseResponse([
          ': this is a comment',
          'data: ' + JSON.stringify({ choices: [{ delta: { content: 'x' } }] }),
          'data: [DONE]',
          '',
        ])
      );
      const adapter = new PassthroughAdapter({ baseUrl: 'http://x' });
      const events = await collect(adapter.run(req(), CTX));
      const texts = events.filter((e) => e.type === 'text').map((e) => (e as any).delta);
      expect(texts).toEqual(['x']);
    });

    it('reassembles a chunk split byte-by-byte across multiple stream reads', async () => {
      fetchMock.mockResolvedValue(
        sseResponse(
          [
            'data: ' + JSON.stringify({ choices: [{ delta: { content: 'reassembled' } }] }),
            'data: [DONE]',
            '',
          ],
          { chunked: true }
        )
      );
      const adapter = new PassthroughAdapter({ baseUrl: 'http://x' });
      const events = await collect(adapter.run(req(), CTX));
      const texts = events.filter((e) => e.type === 'text').map((e) => (e as any).delta);
      expect(texts).toEqual(['reassembled']);
    });

    it('stops immediately on [DONE] even if more lines follow (should not happen, but is safe)', async () => {
      fetchMock.mockResolvedValue(
        sseResponse([
          'data: [DONE]',
          'data: ' + JSON.stringify({ choices: [{ delta: { content: 'ghost' } }] }),
          '',
        ])
      );
      const adapter = new PassthroughAdapter({ baseUrl: 'http://x' });
      const events = await collect(adapter.run(req(), CTX));
      expect(events.filter((e) => e.type === 'text')).toHaveLength(0);
      expect(events.at(-1)).toEqual({ type: 'agent_status', kind: 'done' });
    });
  });

  describe('error handling', () => {
    it('yields an error event with the status and truncated body on non-2xx', async () => {
      fetchMock.mockResolvedValue(new Response('rate limited', { status: 429 }));
      const adapter = new PassthroughAdapter({ baseUrl: 'http://x' });
      const events = await collect(adapter.run(req(), CTX));
      const err = events.find((e) => e.type === 'error') as { message: string };
      expect(err.message).toBe('passthrough 429: rate limited');
    });

    it('truncates a very long error body to 200 chars', async () => {
      const longBody = 'x'.repeat(500);
      fetchMock.mockResolvedValue(new Response(longBody, { status: 500 }));
      const adapter = new PassthroughAdapter({ baseUrl: 'http://x' });
      const events = await collect(adapter.run(req(), CTX));
      const err = events.find((e) => e.type === 'error') as { message: string };
      expect(err.message.length).toBeLessThanOrEqual('passthrough 500: '.length + 200);
    });

    it('yields an error when the response has no body', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      const adapter = new PassthroughAdapter({ baseUrl: 'http://x' });
      const events = await collect(adapter.run(req(), CTX));
      expect(events.some((e) => e.type === 'error')).toBe(true);
    });

    it('does not yield a done status after an error (stream ends at error)', async () => {
      fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
      const adapter = new PassthroughAdapter({ baseUrl: 'http://x' });
      const events = await collect(adapter.run(req(), CTX));
      expect(events.some((e) => e.type === 'agent_status' && e.kind === 'done')).toBe(false);
    });
  });
});
