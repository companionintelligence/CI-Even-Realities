import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatCompletions } from '../ChatCompletions.ts';
import type { BackendConfig } from '../../config/Settings.ts';
import type { AgentEvent } from '../AgentEvent.ts';

const BASE_CONFIG: BackendConfig = {
  baseUrl: 'http://localhost:8080',
  apiKey: 'test-key',
  model: 'gpt-test',
  backendKind: 'openai',
  apiMode: 'completions',
  systemPrompt: 'You are a test assistant.',
  streaming: false,
  storeContext: false,
  sttProvider: 'whisper',
  ttsEnabled: false,
  maxHistoryMessages: 20,
  authMode: 'apiKey',
  oidcIssuer: 'https://hub.ci.computer/api/auth',
  oidcClientId: 'ci-hub',
  oidcScope: 'openid email profile offline_access',
  hubBaseUrl: 'http://localhost',
  useMemory: false,
};

/** Non-streaming success response */
function makeJsonResponse(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

/** Collect all yielded strings from an async generator. */
async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

/** Collect all yielded AgentEvents. */
async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function textChunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

/** A well-formed SSE response that completes normally with [DONE]. */
function sseResponse(lines: string[]): Response {
  const bytes = new TextEncoder().encode(lines.join(''));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

/**
 * An SSE response that yields `goodLines` then errors instead of closing —
 * simulates a dropped connection. Uses `pull` (lazy, per-read) rather than
 * enqueueing + erroring in `start` — the latter can surface synchronously
 * before any reader even attaches, which isn't how a real drop behaves (the
 * first chunk arrives fine; only a later read fails).
 */
function droppedSSEResponse(goodLines: string[]): Response {
  const bytes = new TextEncoder().encode(goodLines.join(''));
  let delivered = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!delivered) {
        delivered = true;
        controller.enqueue(bytes);
        return;
      }
      controller.error(new TypeError('network error'));
    },
  });
  return new Response(stream, { status: 200 });
}

/** An SSE response that ends cleanly (closes) without ever sending [DONE]. */
function truncatedSSEResponse(goodLines: string[]): Response {
  const bytes = new TextEncoder().encode(goodLines.join(''));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

const STREAMING_CONFIG: BackendConfig = { ...BASE_CONFIG, streaming: true };

describe('ChatCompletions', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('happy path', () => {
    it('yields the assistant response', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse('Hi there!'));
      const cc = new ChatCompletions(BASE_CONFIG);
      expect(await collect(cc.send('Hello'))).toEqual(['Hi there!']);
    });

    it('adds user and assistant messages to history on success', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse('World'));
      const cc = new ChatCompletions(BASE_CONFIG);
      await collect(cc.send('Hello'));
      const history = cc.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(history[1]).toEqual({ role: 'assistant', content: 'World' });
    });

    it('accumulates history across multiple turns', async () => {
      fetchMock
        .mockResolvedValueOnce(makeJsonResponse('Turn 1'))
        .mockResolvedValueOnce(makeJsonResponse('Turn 2'));
      const cc = new ChatCompletions(BASE_CONFIG);
      await collect(cc.send('Q1'));
      await collect(cc.send('Q2'));
      expect(cc.getHistory()).toHaveLength(4);
    });

    it('clearHistory resets conversation', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse('answer'));
      const cc = new ChatCompletions(BASE_CONFIG);
      await collect(cc.send('question'));
      cc.clearHistory();
      expect(cc.getHistory()).toHaveLength(0);
    });
  });

  describe('history not mutated on failure', () => {
    it('does NOT add user message when fetch throws a network error', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      const cc = new ChatCompletions(BASE_CONFIG);
      await expect(collect(cc.send('hello'))).rejects.toThrow('Failed to fetch');
      expect(cc.getHistory()).toHaveLength(0);
    });

    it('does NOT add user message on non-2xx response', async () => {
      fetchMock.mockResolvedValue(
        new Response('Internal Server Error', { status: 500 })
      );
      const cc = new ChatCompletions(BASE_CONFIG);
      await expect(collect(cc.send('hello'))).rejects.toThrow('500');
      expect(cc.getHistory()).toHaveLength(0);
    });

    it('does NOT add user message on 400 Bad Request', async () => {
      fetchMock.mockResolvedValue(
        new Response('Bad Request', { status: 400 })
      );
      const cc = new ChatCompletions(BASE_CONFIG);
      await expect(collect(cc.send('hi'))).rejects.toThrow('400');
      expect(cc.getHistory()).toHaveLength(0);
    });

    it('does NOT corrupt history when second request fails', async () => {
      fetchMock
        .mockResolvedValueOnce(makeJsonResponse('ok'))
        .mockResolvedValueOnce(new Response('error', { status: 503 }));

      const cc = new ChatCompletions(BASE_CONFIG);
      await collect(cc.send('first'));
      const snapshotBefore = [...cc.getHistory()];

      await expect(collect(cc.send('second'))).rejects.toThrow('503');

      // History must be identical to the snapshot before the failed call
      expect([...cc.getHistory()]).toEqual(snapshotBefore);
    });
  });

  describe('history length cap', () => {
    it('caps history at maxHistoryMessages', async () => {
      fetchMock.mockImplementation(async () => makeJsonResponse('answer'));
      const cc = new ChatCompletions({ ...BASE_CONFIG, maxHistoryMessages: 4 });

      // 3 turns → 6 messages → trimmed to 4
      for (let i = 0; i < 3; i++) {
        await collect(cc.send(`Q${i}`));
      }

      expect(cc.getHistory().length).toBeLessThanOrEqual(4);
    });

    it('does not trim when history is within the cap', async () => {
      fetchMock.mockImplementation(async () => makeJsonResponse('answer'));
      const cc = new ChatCompletions({ ...BASE_CONFIG, maxHistoryMessages: 10 });

      await collect(cc.send('Q1'));
      await collect(cc.send('Q2'));

      expect(cc.getHistory()).toHaveLength(4); // 2 user + 2 assistant
    });
  });

  describe('streaming reconnect on dropped connection', () => {
    it('reconnects to the resume endpoint and yields the rest of the answer', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/v1/chat/completions/stream')) {
          expect(url).toContain('session_id=sess-1');
          expect(url).toContain('after=0');
          return sseResponse([textChunk('second'), 'data: [DONE]\n\n']);
        }
        return droppedSSEResponse([textChunk('first ')]);
      });

      const cc = new ChatCompletions(STREAMING_CONFIG);
      const events = await collectEvents(
        cc.sendEvents('hello', undefined, { session_id: 'sess-1' })
      );
      const text = events
        .filter((e) => e.type === 'text')
        .map((e) => (e as { delta: string }).delta)
        .join('');
      expect(text).toBe('first second');

      // Assistant history reflects the full, reconnected answer.
      const history = cc.getHistory();
      expect(history[history.length - 1]).toEqual({
        role: 'assistant',
        content: 'first second',
      });
    });

    it('treats a clean-but-truncated stream (no [DONE]) as droppable and reconnects', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/v1/chat/completions/stream')) {
          return sseResponse([textChunk('second'), 'data: [DONE]\n\n']);
        }
        return truncatedSSEResponse([textChunk('first ')]);
      });

      const cc = new ChatCompletions(STREAMING_CONFIG);
      const text = (
        await collectEvents(cc.sendEvents('hello', undefined, { session_id: 'sess-2' }))
      )
        .filter((e) => e.type === 'text')
        .map((e) => (e as { delta: string }).delta)
        .join('');
      expect(text).toBe('first second');
    });

    it('does not attempt to reconnect when no session_id is available', async () => {
      let fetchCount = 0;
      fetchMock.mockImplementation(async () => {
        fetchCount++;
        return droppedSSEResponse([textChunk('first ')]);
      });

      const cc = new ChatCompletions(STREAMING_CONFIG);
      await expect(
        collectEvents(cc.sendEvents('hello'))
      ).rejects.toThrow();
      expect(fetchCount).toBe(1); // only the initial POST — no reconnect attempt
    });

    it('surfaces the original error when reconnecting also fails', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/v1/chat/completions/stream')) {
          return new Response('not found', { status: 404 });
        }
        return droppedSSEResponse([textChunk('first ')]);
      });

      const cc = new ChatCompletions(STREAMING_CONFIG);
      await expect(
        collectEvents(cc.sendEvents('hello', undefined, { session_id: 'sess-3' }))
      ).rejects.toThrow();
    });

    it('does not reconnect when the caller deliberately aborted', async () => {
      const controller = new AbortController();
      let fetchCount = 0;
      fetchMock.mockImplementation(async () => {
        fetchCount++;
        controller.abort();
        throw new DOMException('Aborted', 'AbortError');
      });

      const cc = new ChatCompletions(STREAMING_CONFIG);
      await expect(
        collectEvents(
          cc.sendEvents('hello', controller.signal, { session_id: 'sess-4' })
        )
      ).rejects.toThrow();
      expect(fetchCount).toBe(1);
    });

    it('gives up after exhausting the reconnect budget', async () => {
      let reconnectAttempts = 0;
      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/v1/chat/completions/stream')) {
          reconnectAttempts++;
          return droppedSSEResponse([]); // every reconnect also drops immediately
        }
        return droppedSSEResponse([textChunk('first ')]);
      });

      const cc = new ChatCompletions(STREAMING_CONFIG);
      await expect(
        collectEvents(cc.sendEvents('hello', undefined, { session_id: 'sess-5' }))
      ).rejects.toThrow();
      // Bounded retry budget, not an infinite reconnect loop.
      expect(reconnectAttempts).toBeGreaterThan(0);
      expect(reconnectAttempts).toBeLessThanOrEqual(3);
    }, 10_000);
  });

  describe('AbortSignal', () => {
    it('propagates AbortSignal to fetch', async () => {
      const controller = new AbortController();
      let capturedSignal: AbortSignal | undefined;

      fetchMock.mockImplementation(async (_url: string, opts: RequestInit) => {
        capturedSignal = opts?.signal as AbortSignal | undefined;
        return makeJsonResponse('ok');
      });

      const cc = new ChatCompletions(BASE_CONFIG);
      await collect(cc.send('hi', controller.signal));
      expect(capturedSignal).toBe(controller.signal);
    });

    it('throws when fetch is aborted', async () => {
      const controller = new AbortController();
      fetchMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
      controller.abort();

      const cc = new ChatCompletions(BASE_CONFIG);
      await expect(collect(cc.send('hi', controller.signal))).rejects.toThrow();
    });
  });
});
