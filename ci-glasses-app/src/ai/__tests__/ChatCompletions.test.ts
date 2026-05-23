import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatCompletions } from '../ChatCompletions.ts';
import type { BackendConfig } from '../../config/Settings.ts';

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
