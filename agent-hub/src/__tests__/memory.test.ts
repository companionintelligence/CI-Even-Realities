import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryAdapter } from '../adapters/memory.ts';
import type { ChatRequest, SessionContext } from '../adapters/Adapter.ts';
import type { AgentEvent } from '../events.ts';

const CTX: SessionContext = { sessionId: 's1', signal: new AbortController().signal };

function req(content: string): ChatRequest {
  return {
    model: 'ci-memory',
    stream: true,
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content },
    ],
  };
}

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('MemoryAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('recalls with x-api-key and streams the block', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ block: 'You met Ada at CI.', resultCount: 2 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const a = new MemoryAdapter({ baseUrl: 'http://server:3030', apiKey: 'mk-1' });
    const events = await collect(a.run(req('who is ada'), CTX));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://server:3030/memory/recall');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('mk-1');
    expect(JSON.parse(init.body as string).query).toBe('who is ada');

    expect(events.some((e) => e.type === 'text' && e.delta === 'You met Ada at CI.')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'agent_status', kind: 'done' });
  });

  it('honors a proxy recall path', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ block: 'x' }), { status: 200 }));
    const a = new MemoryAdapter({
      baseUrl: 'http://hub:5002',
      apiKey: 'k',
      recallPath: '/api/memory/recall',
    });
    await collect(a.run(req('q'), CTX));
    expect(fetchMock.mock.calls[0][0]).toBe('http://hub:5002/api/memory/recall');
  });

  it('falls back to results[] when no block is present', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ results: [{ text: 'a' }, { summary: 'b' }] }), { status: 200 })
    );
    const a = new MemoryAdapter({ baseUrl: 'http://server:3030', apiKey: 'k' });
    const events = await collect(a.run(req('q'), CTX));
    expect(events.some((e) => e.type === 'text' && e.delta === 'a\n\nb')).toBe(true);
  });

  it('reports a friendly line when nothing is found', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ resultCount: 0 }), { status: 200 }));
    const a = new MemoryAdapter({ baseUrl: 'http://server:3030', apiKey: 'k' });
    const events = await collect(a.run(req('unknown'), CTX));
    expect(events.some((e) => e.type === 'text' && /No memories found/.test(e.delta))).toBe(true);
  });

  it('surfaces a non-2xx as an error event', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 401 }));
    const a = new MemoryAdapter({ baseUrl: 'http://server:3030', apiKey: 'bad' });
    const events = await collect(a.run(req('q'), CTX));
    expect(events.some((e) => e.type === 'error' && /401/.test(e.message))).toBe(true);
  });

  it('errors when baseUrl is unset', async () => {
    const a = new MemoryAdapter({ baseUrl: '', apiKey: 'k' });
    const events = await collect(a.run(req('q'), CTX));
    expect(events[0]).toMatchObject({ type: 'error' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a timeout as an error event instead of hanging forever', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    );
    const a = new MemoryAdapter({ baseUrl: 'http://server:3030', apiKey: 'k', timeoutMs: 50 });

    const collected = collect(a.run(req('q'), CTX));
    await vi.advanceTimersByTimeAsync(50);
    const events = await collected;

    expect(events.some((e) => e.type === 'error' && /timed out after 50ms/.test(e.message))).toBe(
      true
    );
    vi.useRealTimers();
  });
});
