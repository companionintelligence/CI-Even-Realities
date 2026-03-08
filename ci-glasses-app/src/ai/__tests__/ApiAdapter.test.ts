import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiAdapter } from '../ApiAdapter.ts';
import type { BackendConfig } from '../../config/Settings.ts';

const BASE_CONFIG: BackendConfig = {
  baseUrl: 'http://localhost:8080',
  apiKey: 'test-key',
  model: 'test-model',
  apiMode: 'auto',
  systemPrompt: 'You are a test assistant.',
  streaming: false,
  storeContext: false,
  sttProvider: 'whisper',
  ttsEnabled: false,
  maxHistoryMessages: 20,
};

/** Build a non-streaming completions Response. */
function makeCompletionsResponse(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

/** Collect all yielded strings. */
async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

describe('ApiAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('auto mode — fallback to Chat Completions', () => {
    it('falls back when OPTIONS /v1/responses throws (network error)', async () => {
      fetchMock.mockImplementation(async (url: string, opts: RequestInit) => {
        if (opts?.method === 'OPTIONS') {
          if ((url as string).includes('/v1/responses')) {
            throw new Error('Network error');
          }
          // completions probe succeeds
          return new Response(null, { status: 200 });
        }
        // actual POST
        return makeCompletionsResponse('hello from completions');
      });

      const adapter = new ApiAdapter({ ...BASE_CONFIG, apiMode: 'auto' });
      const result = await collect(adapter.sendMessage('hi'));
      expect(result).toEqual(['hello from completions']);
    });

    it('falls back when OPTIONS /v1/responses returns non-ok/405', async () => {
      fetchMock.mockImplementation(async (url: string, opts: RequestInit) => {
        if (opts?.method === 'OPTIONS') {
          if ((url as string).includes('/v1/responses')) {
            return new Response(null, { status: 404 });
          }
          return new Response(null, { status: 200 });
        }
        return makeCompletionsResponse('completions answer');
      });

      const adapter = new ApiAdapter({ ...BASE_CONFIG, apiMode: 'auto' });
      const result = await collect(adapter.sendMessage('hi'));
      expect(result).toEqual(['completions answer']);
    });
  });

  describe('auto mode — selects Responses API on 200 or 405', () => {
    it('selects Responses API when OPTIONS returns 200', async () => {
      fetchMock.mockImplementation(async (_url: string, opts: RequestInit) => {
        if (opts?.method === 'OPTIONS') {
          return new Response(null, { status: 200 });
        }
        // Responses API non-streaming
        return new Response(
          JSON.stringify({ id: 'resp-1', output_text: 'responses answer' }),
          { status: 200 }
        );
      });

      const adapter = new ApiAdapter({ ...BASE_CONFIG, apiMode: 'auto' });
      const result = await collect(adapter.sendMessage('hi'));
      expect(result).toEqual(['responses answer']);
    });

    it('selects Responses API when OPTIONS returns 405', async () => {
      fetchMock.mockImplementation(async (_url: string, opts: RequestInit) => {
        if (opts?.method === 'OPTIONS') {
          return new Response(null, { status: 405 });
        }
        return new Response(
          JSON.stringify({ id: 'resp-2', output_text: 'responses 405' }),
          { status: 200 }
        );
      });

      const adapter = new ApiAdapter({ ...BASE_CONFIG, apiMode: 'auto' });
      const result = await collect(adapter.sendMessage('hi'));
      expect(result).toEqual(['responses 405']);
    });
  });

  describe('concurrent callers share a single OPTIONS probe', () => {
    it('calls OPTIONS exactly once even when two messages are sent concurrently', async () => {
      let optionsCallCount = 0;

      fetchMock.mockImplementation(async (_url: string, opts: RequestInit) => {
        if (opts?.method === 'OPTIONS') {
          optionsCallCount++;
          // Simulate a slightly delayed probe
          await new Promise<void>((r) => setTimeout(r, 5));
          return new Response(null, { status: 404 });
        }
        return makeCompletionsResponse('ok');
      });

      const adapter = new ApiAdapter({ ...BASE_CONFIG, apiMode: 'auto' });
      // Fire two concurrent messages — both require the probe
      await Promise.all([
        collect(adapter.sendMessage('msg1')),
        collect(adapter.sendMessage('msg2')),
      ]);

      expect(optionsCallCount).toBe(1);
    });
  });

  describe('updateConfig clears the capability cache', () => {
    it('re-probes after updateConfig even when result is already cached', async () => {
      let optionsCallCount = 0;

      fetchMock.mockImplementation(async (_url: string, opts: RequestInit) => {
        if (opts?.method === 'OPTIONS') {
          optionsCallCount++;
          return new Response(null, { status: 404 });
        }
        return makeCompletionsResponse('after update');
      });

      const adapter = new ApiAdapter({ ...BASE_CONFIG, apiMode: 'auto' });

      // First call — probe fires once
      await collect(adapter.sendMessage('first'));
      expect(optionsCallCount).toBe(1);

      // Second call — cache hit, no new probe
      await collect(adapter.sendMessage('second'));
      expect(optionsCallCount).toBe(1);

      // Update config — cache cleared
      adapter.updateConfig({ ...BASE_CONFIG, apiMode: 'auto', baseUrl: 'http://new-url' });

      // Third call — probe fires again
      await collect(adapter.sendMessage('third'));
      expect(optionsCallCount).toBe(2);
    });
  });

  describe('explicit mode overrides', () => {
    it('uses Chat Completions directly when apiMode is "completions"', async () => {
      fetchMock.mockResolvedValue(makeCompletionsResponse('completions direct'));

      const adapter = new ApiAdapter({ ...BASE_CONFIG, apiMode: 'completions' });
      const result = await collect(adapter.sendMessage('hi'));

      // No OPTIONS probe should have been made
      const calls = fetchMock.mock.calls as [string, RequestInit | undefined][];
      expect(calls.every(([, opts]) => opts?.method !== 'OPTIONS')).toBe(true);
      expect(result).toEqual(['completions direct']);
    });

    it('uses Responses API directly when apiMode is "responses"', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ id: 'r1', output_text: 'responses direct' }), {
          status: 200,
        })
      );

      const adapter = new ApiAdapter({ ...BASE_CONFIG, apiMode: 'responses' });
      const result = await collect(adapter.sendMessage('hi'));
      expect(result).toEqual(['responses direct']);
    });
  });

  describe('sendMessage with AbortSignal', () => {
    it('passes the signal to fetch and propagates abort', async () => {
      const controller = new AbortController();

      fetchMock.mockImplementation(async (_url: string, opts: RequestInit) => {
        if (opts?.method === 'OPTIONS') return new Response(null, { status: 404 });
        // Simulate abort mid-request
        controller.abort();
        throw new DOMException('Aborted', 'AbortError');
      });

      const adapter = new ApiAdapter({ ...BASE_CONFIG, apiMode: 'completions' });
      await expect(collect(adapter.sendMessage('hi', controller.signal))).rejects.toThrow();
    });

    it('throws AbortError immediately when signal is already aborted before sendMessage', async () => {
      fetchMock.mockImplementation(async () => makeCompletionsResponse('should not reach'));

      const controller = new AbortController();
      controller.abort();

      const adapter = new ApiAdapter({ ...BASE_CONFIG, apiMode: 'auto' });
      await expect(collect(adapter.sendMessage('hi', controller.signal))).rejects.toThrow();

      // fetch should not have been called at all
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('aborts the OPTIONS probe when the signal fires mid-probe', async () => {
      const controller = new AbortController();
      let probeStarted = false;

      fetchMock.mockImplementation(async (_url: string, opts: RequestInit) => {
        if (opts?.method === 'OPTIONS') {
          probeStarted = true;
          // Abort the signal while the probe is in-flight
          controller.abort();
          // Then simulate the abort reaching fetch
          throw new DOMException('Aborted', 'AbortError');
        }
        return makeCompletionsResponse('should not reach');
      });

      const adapter = new ApiAdapter({ ...BASE_CONFIG, apiMode: 'auto' });
      await expect(collect(adapter.sendMessage('hi', controller.signal))).rejects.toThrow();
      expect(probeStarted).toBe(true);
    });

    it('allows a subsequent call to re-probe after an aborted probe', async () => {
      const controller = new AbortController();
      let optionsCallCount = 0;

      fetchMock.mockImplementation(async (_url: string, opts: RequestInit) => {
        if (opts?.method === 'OPTIONS') {
          optionsCallCount++;
          if (optionsCallCount === 1) {
            // First probe is aborted
            controller.abort();
            throw new DOMException('Aborted', 'AbortError');
          }
          // Second probe succeeds (falls back to completions)
          return new Response(null, { status: 404 });
        }
        return makeCompletionsResponse('retry ok');
      });

      const adapter = new ApiAdapter({ ...BASE_CONFIG, apiMode: 'auto' });

      // First call — probe is aborted
      await expect(collect(adapter.sendMessage('hi', controller.signal))).rejects.toThrow();

      // Second call with no signal — should re-probe and succeed
      const result = await collect(adapter.sendMessage('hi'));
      expect(result).toEqual(['retry ok']);
      expect(optionsCallCount).toBe(2);
    });
  });
});
