import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResponsesApi } from '../ResponsesApi.ts';
import type { BackendConfig } from '../../config/Settings.ts';

const BASE_CONFIG: BackendConfig = {
  baseUrl: 'http://localhost:8080',
  apiKey: 'test-key',
  model: 'gpt-test',
  backendKind: 'openai',
  apiMode: 'responses',
  systemPrompt: 'You are a test assistant.',
  streaming: false,
  storeContext: true,
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

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

function sseResponse(lines: string[], status = 200): Response {
  const bytes = new TextEncoder().encode(lines.join(''));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Response(stream, { status });
}

function textDelta(text: string): string {
  return `data: ${JSON.stringify({ delta: { text } })}\n\n`;
}

function responseCreated(id: string): string {
  return (
    'event: response.created\n' +
    `data: ${JSON.stringify({ type: 'response.created', response: { id } })}\n\n`
  );
}

describe('ResponsesApi', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('non-streaming', () => {
    it('captures the response id from the JSON body and sends it as previous_response_id next turn', async () => {
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 'resp-1', output_text: 'first' }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 'resp-2', output_text: 'second' }), { status: 200 })
        );

      const api = new ResponsesApi({ ...BASE_CONFIG, streaming: false });
      expect(await collect(api.send('one'))).toEqual(['first']);

      const firstBody = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(firstBody.previous_response_id).toBeUndefined();

      await collect(api.send('two'));
      const secondBody = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
      expect(secondBody.previous_response_id).toBe('resp-1');
    });
  });

  describe('streaming', () => {
    it('captures the response id from a response.created SSE event (the streaming-mode gap)', async () => {
      fetchMock
        .mockResolvedValueOnce(
          sseResponse([responseCreated('resp-stream-1'), textDelta('hi'), 'data: [DONE]\n'])
        )
        .mockResolvedValueOnce(sseResponse([textDelta('again'), 'data: [DONE]\n']));

      const api = new ResponsesApi({ ...BASE_CONFIG, streaming: true });
      expect(await collect(api.send('one'))).toEqual(['hi']);

      await collect(api.send('two'));
      const secondBody = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
      expect(secondBody.previous_response_id).toBe('resp-stream-1');
    });

    it('omits previous_response_id when storeContext is off', async () => {
      fetchMock.mockImplementation(async () =>
        sseResponse([responseCreated('resp-x'), textDelta('hi'), 'data: [DONE]\n'])
      );
      const api = new ResponsesApi({ ...BASE_CONFIG, streaming: true, storeContext: false });
      await collect(api.send('one'));
      await collect(api.send('two'));
      const secondBody = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
      expect(secondBody.previous_response_id).toBeUndefined();
      expect(secondBody.store).toBeUndefined();
    });
  });

  describe('expired previous_response_id recovery', () => {
    it('clears the stale id and retries once, succeeding transparently', async () => {
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 'resp-1', output_text: 'first' }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: { message: "previous_response_id 'resp-1' not found" },
            }),
            { status: 400 }
          )
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 'resp-3', output_text: 'recovered' }), {
            status: 200,
          })
        );

      const api = new ResponsesApi({ ...BASE_CONFIG, streaming: false });
      await collect(api.send('one')); // captures resp-1
      const result = await collect(api.send('two')); // 400 -> clears -> retries -> succeeds
      expect(result).toEqual(['recovered']);

      // The retry (3rd call) must NOT carry the stale previous_response_id.
      const retryBody = JSON.parse(fetchMock.mock.calls[2]![1].body as string);
      expect(retryBody.previous_response_id).toBeUndefined();
    });

    it('throws the retry error when the expired-context retry also fails', async () => {
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 'resp-1', output_text: 'first' }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { message: 'previous_response_id gone' } }), {
            status: 400,
          })
        )
        .mockResolvedValueOnce(new Response('still broken', { status: 500 }));

      const api = new ResponsesApi({ ...BASE_CONFIG, streaming: false });
      await collect(api.send('one'));
      await expect(collect(api.send('two'))).rejects.toThrow('Responses API error 500');
    });

    it('does not retry a non-expired-context error (surfaces immediately)', async () => {
      fetchMock.mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
      const api = new ResponsesApi({ ...BASE_CONFIG, streaming: false });
      await expect(collect(api.send('one'))).rejects.toThrow('Responses API error 429');
      expect(fetchMock).toHaveBeenCalledTimes(1); // no retry attempted
    });

    it('does not retry when there was no previous_response_id to have expired', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'previous_response_id bogus' } }), {
          status: 400,
        })
      );
      const api = new ResponsesApi({ ...BASE_CONFIG, streaming: false });
      await expect(collect(api.send('one'))).rejects.toThrow('Responses API error 400');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearContext', () => {
    it('drops the stored response id so the next turn starts fresh', async () => {
      fetchMock.mockImplementation(
        async () =>
          new Response(JSON.stringify({ id: 'resp-1', output_text: 'ok' }), { status: 200 })
      );
      const api = new ResponsesApi({ ...BASE_CONFIG, streaming: false });
      await collect(api.send('one'));
      api.clearContext();
      await collect(api.send('two'));
      const secondBody = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
      expect(secondBody.previous_response_id).toBeUndefined();
    });
  });

  describe('sendEvents', () => {
    it('lifts text deltas into AgentEvents and ignores response_id events', async () => {
      fetchMock.mockResolvedValue(
        sseResponse([responseCreated('resp-y'), textDelta('hello'), 'data: [DONE]\n'])
      );
      const api = new ResponsesApi({ ...BASE_CONFIG, streaming: true });
      const events = [];
      for await (const evt of api.sendEvents('hi')) events.push(evt);
      expect(events).toEqual([{ type: 'text', delta: 'hello' }]);
    });
  });
});
