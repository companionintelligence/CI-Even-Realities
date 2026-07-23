import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenClawAdapter } from '../openclaw.ts';
import type { ChatRequest, SessionContext } from '../Adapter.ts';
import type { AgentEvent } from '../../events.ts';

const CTX: SessionContext = { sessionId: 's1', signal: new AbortController().signal };

function req(text = 'hi'): ChatRequest {
  return {
    model: 'openclaw/default',
    stream: true,
    messages: [{ role: 'user', content: text }],
  };
}

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

/** Build a fetch Response whose body streams the given SSE lines as raw bytes. */
function sseResponse(lines: string[], opts: { chunked?: boolean } = {}): Response {
  const text = lines.join('\n') + '\n';
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (opts.chunked) {
        // Split into single-byte chunks to exercise cross-read buffering.
        for (const b of bytes) controller.enqueue(new Uint8Array([b]));
      } else {
        controller.enqueue(bytes);
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe('OpenClawAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('errors immediately when no gateway URL is configured', async () => {
    const adapter = new OpenClawAdapter({ gatewayUrl: '', token: '' });
    const events = await collect(adapter.run(req(), CTX));
    expect(events).toEqual([
      { type: 'error', message: 'openclaw: OPENCLAW_GATEWAY_URL not configured' },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs with a Bearer token and the request model/messages', async () => {
    fetchMock.mockResolvedValue(sseResponse(['data: [DONE]', '']));
    const adapter = new OpenClawAdapter({ gatewayUrl: 'http://gw:18790/v1/chat/completions', token: 'gw-token' });
    await collect(adapter.run(req('hello there'), CTX));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://gw:18790/v1/chat/completions');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer gw-token');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: 'openclaw/default',
      messages: [{ role: 'user', content: 'hello there' }],
      stream: true,
    });
  });

  it('yields thinking status before the request completes', async () => {
    fetchMock.mockResolvedValue(sseResponse(['data: [DONE]', '']));
    const adapter = new OpenClawAdapter({ gatewayUrl: 'http://gw', token: 't' });
    const events = await collect(adapter.run(req(), CTX));
    expect(events[0]).toEqual({ type: 'agent_status', kind: 'thinking' });
  });

  it('relays text deltas and terminates on [DONE] with a done status', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hello ' } }] }),
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'world' } }] }),
        'data: [DONE]',
        '',
      ])
    );
    const adapter = new OpenClawAdapter({ gatewayUrl: 'http://gw', token: 't' });
    const events = await collect(adapter.run(req(), CTX));

    const texts = events.filter((e) => e.type === 'text').map((e) => (e as any).delta);
    expect(texts).toEqual(['Hello ', 'world']);
    expect(events.at(-1)).toEqual({ type: 'agent_status', kind: 'done' });
  });

  it('strips fenced code blocks from deltas for the monochrome HUD', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: ' + JSON.stringify({
          choices: [{ delta: { content: 'before ```js\nconsole.log(1)\n``` after' } }],
        }),
        'data: [DONE]',
        '',
      ])
    );
    const adapter = new OpenClawAdapter({ gatewayUrl: 'http://gw', token: 't' });
    const events = await collect(adapter.run(req(), CTX));
    const text = events.find((e) => e.type === 'text') as { delta: string };
    expect(text.delta).toBe('before [code] after');
  });

  it('strips markdown links to bare text, preserving mailto/http links only', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: ' + JSON.stringify({
          choices: [{ delta: { content: 'see [docs](https://example.com/docs) or [email](mailto:a@b.com)' } }],
        }),
        'data: [DONE]',
        '',
      ])
    );
    const adapter = new OpenClawAdapter({ gatewayUrl: 'http://gw', token: 't' });
    const events = await collect(adapter.run(req(), CTX));
    const text = events.find((e) => e.type === 'text') as { delta: string };
    expect(text.delta).toBe('see docs or email');
  });

  it('leaves non-http(s)/mailto link syntax untouched (conservative stripping)', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: ' + JSON.stringify({
          choices: [{ delta: { content: 'a [ref](#anchor) here' } }],
        }),
        'data: [DONE]',
        '',
      ])
    );
    const adapter = new OpenClawAdapter({ gatewayUrl: 'http://gw', token: 't' });
    const events = await collect(adapter.run(req(), CTX));
    const text = events.find((e) => e.type === 'text') as { delta: string };
    expect(text.delta).toBe('a [ref](#anchor) here');
  });

  it('emits an executing/tool status once when a tool_calls delta first appears', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ id: 'c1' }] } }] }),
        'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ id: 'c1' }] } }] }),
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'result' } }] }),
        'data: [DONE]',
        '',
      ])
    );
    const adapter = new OpenClawAdapter({ gatewayUrl: 'http://gw', token: 't' });
    const events = await collect(adapter.run(req(), CTX));
    const toolBanners = events.filter(
      (e) => e.type === 'agent_status' && e.kind === 'executing'
    );
    expect(toolBanners).toHaveLength(1);
    expect(toolBanners[0]).toEqual({ type: 'agent_status', kind: 'executing', label: 'tool' });
  });

  it('drops empty-string deltas (no text event emitted)', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: ' + JSON.stringify({ choices: [{ delta: { content: '' } }] }),
        'data: [DONE]',
        '',
      ])
    );
    const adapter = new OpenClawAdapter({ gatewayUrl: 'http://gw', token: 't' });
    const events = await collect(adapter.run(req(), CTX));
    expect(events.filter((e) => e.type === 'text')).toHaveLength(0);
  });

  it('skips malformed JSON chunks without throwing', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {not valid json',
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }),
        'data: [DONE]',
        '',
      ])
    );
    const adapter = new OpenClawAdapter({ gatewayUrl: 'http://gw', token: 't' });
    const events = await collect(adapter.run(req(), CTX));
    const texts = events.filter((e) => e.type === 'text').map((e) => (e as any).delta);
    expect(texts).toEqual(['ok']);
  });

  it('reassembles chunks split byte-by-byte across multiple reads', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(
        [
          'data: ' + JSON.stringify({ choices: [{ delta: { content: 'byte-by-byte' } }] }),
          'data: [DONE]',
          '',
        ],
        { chunked: true }
      )
    );
    const adapter = new OpenClawAdapter({ gatewayUrl: 'http://gw', token: 't' });
    const events = await collect(adapter.run(req(), CTX));
    const texts = events.filter((e) => e.type === 'text').map((e) => (e as any).delta);
    expect(texts).toEqual(['byte-by-byte']);
  });

  it('yields an error event when the gateway responds non-2xx', async () => {
    fetchMock.mockResolvedValue(new Response('gateway down', { status: 502 }));
    const adapter = new OpenClawAdapter({ gatewayUrl: 'http://gw', token: 't' });
    const events = await collect(adapter.run(req(), CTX));
    const err = events.find((e) => e.type === 'error') as { message: string };
    expect(err.message).toContain('openclaw 502');
    expect(err.message).toContain('gateway down');
  });

  it('yields an error event when the response has no body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const adapter = new OpenClawAdapter({ gatewayUrl: 'http://gw', token: 't' });
    const events = await collect(adapter.run(req(), CTX));
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('supports both "data:" and "data: " (with space) prefixes', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data:' + JSON.stringify({ choices: [{ delta: { content: 'no-space' } }] }),
        'data: [DONE]',
        '',
      ])
    );
    const adapter = new OpenClawAdapter({ gatewayUrl: 'http://gw', token: 't' });
    const events = await collect(adapter.run(req(), CTX));
    const texts = events.filter((e) => e.type === 'text').map((e) => (e as any).delta);
    expect(texts).toEqual(['no-space']);
  });

  it('does not implement approve (no permission-prompt support yet)', () => {
    const adapter = new OpenClawAdapter({ gatewayUrl: 'http://gw', token: 't' });
    expect(adapter.approve).toBeUndefined();
  });

  it('has kind "openclaw"', () => {
    const adapter = new OpenClawAdapter({ gatewayUrl: 'http://gw', token: 't' });
    expect(adapter.kind).toBe('openclaw');
  });
});
