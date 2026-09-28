import { describe, it, expect, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { generateKeyPair, SignJWT } from 'jose';
import { makeRouter } from '../router.ts';
import { PortalTokenVerifier } from '../auth.ts';
import type { Adapter, BackendKind, ChatRequest, SessionContext } from '../adapters/Adapter.ts';
import type { AgentEvent } from '../events.ts';
import type { HubConfig } from '../config.ts';

const BASE_CFG: HubConfig = {
  port: 0,
  bind: '127.0.0.1',
  authToken: '',
  agentKind: 'openai',
  downstreamUrl: '',
  downstreamApiKey: '',
  claudeBinary: 'claude',
  codexBinary: 'codex',
  openclawGatewayUrl: '',
  openclawToken: '',
  agentCwd: process.cwd(),
  portalOidcEnabled: false,
  portalIssuer: 'https://hub.ci.computer',
  portalJwksUri: 'https://hub.ci.computer/api/auth/jwks',
  portalAudience: 'ci-hub,ci-even,ci-server',
};

class FakeAdapter implements Adapter {
  readonly kind = 'openai' as const;
  approvals: Array<{ sessionId: string; promptId: string; optionId: string }> = [];
  async *run(_req: ChatRequest, _ctx: SessionContext): AsyncIterable<AgentEvent> {
    yield { type: 'agent_status', kind: 'thinking' };
    yield { type: 'text', delta: 'hello ' };
    yield { type: 'text', delta: 'world' };
    yield {
      type: 'permission_prompt',
      id: 'p1',
      tool: 'Bash',
      summary: 'run rm tmp',
      options: [
        { id: 'approve', label: 'OK' },
        { id: 'deny', label: 'No' },
      ],
    };
    yield { type: 'agent_status', kind: 'done' };
  }
  async approve(sessionId: string, promptId: string, optionId: string): Promise<boolean> {
    this.approvals.push({ sessionId, promptId, optionId });
    return true;
  }
}

async function withServer<T>(
  router: (req: any, res: any) => Promise<void>,
  fn: (port: number) => Promise<T>
): Promise<T> {
  const server: Server = createServer((req, res) => {
    router(req, res).catch(() => res.end());
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(port);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

describe('router', () => {
  it('GET /healthz returns adapter kind', async () => {
    const adapter = new FakeAdapter();
    const router = makeRouter({ config: BASE_CFG, adapter });
    await withServer(router, async (port) => {
      const r = await fetch(`http://localhost:${port}/healthz`);
      const body = await r.json();
      expect(body).toMatchObject({ ok: true, kind: 'openai' });
      expect(body.kinds).toContain('openai');
    });
  });

  it('answers CORS preflight with permissive headers', async () => {
    const adapter = new FakeAdapter();
    const router = makeRouter({ config: BASE_CFG, adapter });
    await withServer(router, async (port) => {
      const r = await fetch(`http://localhost:${port}/v1/chat/completions`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5174',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type,authorization',
        },
      });
      expect(r.status).toBe(204);
      // Echoes the requesting origin (better than wildcard for cred requests).
      expect(r.headers.get('access-control-allow-origin')).toBe(
        'http://localhost:5174'
      );
      expect(r.headers.get('access-control-allow-methods')).toContain('POST');
      expect(r.headers.get('access-control-allow-headers')).toMatch(/authorization/i);
    });
  });

  describe('CORS preflight only vouches for routes the hub serves', () => {
    const preflight = (port: number, path: string) =>
      fetch(`http://localhost:${port}${path}`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5174',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type,authorization',
        },
      });

    it.each([
      '/healthz',
      '/v1/chat/completions',
      '/v1/chat/completions/stream?session=abc',
      '/v1/audio/transcriptions',
      '/v1/sessions/abc-123/approve',
      '/v1/sessions/abc-123/cancel',
    ])('answers 204 for %s', async (path) => {
      const router = makeRouter({ config: BASE_CFG, adapter: new FakeAdapter() });
      await withServer(router, async (port) => {
        expect((await preflight(port, path)).status).toBe(204);
      });
    });

    // The glasses app decides between Chat Completions and the Responses API by
    // sending OPTIONS to /v1/responses and treating any 2xx as "supported". A
    // hub that 204s every path made that probe lie, and the first real
    // POST /v1/responses then 404'd.
    it.each(['/v1/responses', '/v1/models', '/nope', '/v1/sessions/abc/unknown'])(
      'answers 404 for %s, which the hub does not serve',
      async (path) => {
        const router = makeRouter({ config: BASE_CFG, adapter: new FakeAdapter() });
        await withServer(router, async (port) => {
          const r = await preflight(port, path);
          expect(r.status).toBe(404);
          expect(await r.json()).toEqual({ error: 'not_found' });
        });
      }
    );
  });

  it('rejects requests without bearer token when one is configured', async () => {
    const adapter = new FakeAdapter();
    const router = makeRouter({
      config: { ...BASE_CFG, authToken: 'secret' },
      adapter,
    });
    await withServer(router, async (port) => {
      const r = await fetch(`http://localhost:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(r.status).toBe(401);
    });
  });

  it('streams agent events as SSE for /v1/chat/completions', async () => {
    const adapter = new FakeAdapter();
    const router = makeRouter({ config: BASE_CFG, adapter });
    await withServer(router, async (port) => {
      const r = await fetch(`http://localhost:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'm',
          stream: true,
          messages: [{ role: 'user', content: 'hi' }],
          metadata: { session_id: 'sess-1' },
        }),
      });
      expect(r.status).toBe(200);
      const text = await r.text();
      expect(text).toContain('event: agent_status');
      expect(text).toContain('"kind":"thinking"');
      expect(text).toContain('"content":"hello "');
      expect(text).toContain('event: permission_prompt');
      expect(text).toContain('"id":"p1"');
      expect(text).toContain('data: [DONE]');
    });
  });

  it('routes approve POST to the adapter', async () => {
    const adapter = new FakeAdapter();
    const router = makeRouter({ config: BASE_CFG, adapter });
    await withServer(router, async (port) => {
      // First, bind the session by running a chat request.
      await fetch(`http://localhost:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'm',
          stream: true,
          messages: [{ role: 'user', content: 'hi' }],
          metadata: { session_id: 'sess-2' },
        }),
      }).then((r) => r.text());

      const r = await fetch(
        `http://localhost:${port}/v1/sessions/sess-2/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt_id: 'p1', option_id: 'approve' }),
        }
      );
      expect(r.status).toBe(200);
      expect(adapter.approvals).toEqual([
        { sessionId: 'sess-2', promptId: 'p1', optionId: 'approve' },
      ]);
    });
  });

  it('honors stream:false with a JSON Chat Completion response', async () => {
    const adapter = new FakeAdapter();
    const router = makeRouter({ config: BASE_CFG, adapter });
    await withServer(router, async (port) => {
      const r = await fetch(`http://localhost:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'm',
          stream: false,
          messages: [{ role: 'user', content: 'hi' }],
          metadata: { session_id: 'sess-stream-false' },
        }),
      });
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toMatch(/application\/json/);
      const body = await r.json() as {
        choices: Array<{ message: { content: string } }>;
      };
      expect(body.choices[0]?.message.content).toBe('hello world');
    });
  });

  it('multiplexes: selects the adapter by metadata.agent_kind, else default', async () => {
    // Two labelled fake adapters in a registry.
    class Tagged implements Adapter {
      constructor(readonly kind: BackendKind, private tag: string) {}
      async *run(): AsyncIterable<AgentEvent> {
        yield { type: 'text', delta: this.tag };
      }
    }
    const registry = new Map<BackendKind, Adapter>([
      ['local-llm', new Tagged('local-llm', 'from-ollama')],
      ['hermes', new Tagged('hermes', 'from-hermes')],
      ['memory', new Tagged('memory', 'from-memory')],
    ]);
    const router = makeRouter({ config: BASE_CFG, registry, defaultKind: 'local-llm' });
    await withServer(router, async (port) => {
      const call = async (agent_kind?: string) => {
        const r = await fetch(`http://localhost:${port}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'm',
            stream: false,
            messages: [{ role: 'user', content: 'hi' }],
            metadata: agent_kind ? { agent_kind } : {},
          }),
        });
        return (await r.json()).choices[0].message.content as string;
      };
      expect(await call('hermes')).toBe('from-hermes');
      expect(await call('memory')).toBe('from-memory');
      expect(await call()).toBe('from-ollama'); // default
      expect(await call('nonexistent')).toBe('from-ollama'); // unknown → default
    });

    // healthz lists every registered target.
    await withServer(router, async (port) => {
      const body = await (await fetch(`http://localhost:${port}/healthz`)).json();
      expect(body.kinds).toEqual(expect.arrayContaining(['local-llm', 'hermes', 'memory']));
    });
  });

  describe('auto intent routing', () => {
    /** Adapter that records the requests it receives and echoes the last user message. */
    class Capture implements Adapter {
      requests: ChatRequest[] = [];
      constructor(readonly kind: BackendKind) {}
      async *run(req: ChatRequest): AsyncIterable<AgentEvent> {
        this.requests.push(req);
        yield {
          type: 'text',
          delta: `${this.kind}:${req.messages[req.messages.length - 1]?.content}`,
        };
      }
    }

    it('routes agent_kind=auto to the addressed target with the prefix stripped', async () => {
      const local = new Capture('local-llm');
      const hermes = new Capture('hermes');
      const registry = new Map<BackendKind, Adapter>([
        ['local-llm', local],
        ['hermes', hermes],
      ]);
      const router = makeRouter({ config: BASE_CFG, registry, defaultKind: 'local-llm' });
      await withServer(router, async (port) => {
        const r = await fetch(`http://localhost:${port}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'm',
            stream: true,
            messages: [{ role: 'user', content: 'ask hermes what time is it' }],
            metadata: { agent_kind: 'auto' },
          }),
        });
        const text = await r.text();
        // The routing decision is surfaced on the HUD before the stream…
        expect(text).toContain('event: agent_status');
        expect(text).toContain('"label":"→ hermes"');
        // …and the addressed adapter received the stripped utterance.
        expect(hermes.requests).toHaveLength(1);
        expect(hermes.requests[0]!.messages.at(-1)?.content).toBe('what time is it');
        expect(text).toContain('hermes:what time is it');
        expect(local.requests).toHaveLength(0);
      });
    });

    it('falls back to defaultKind (original text intact) when the target is unregistered', async () => {
      const local = new Capture('local-llm');
      const registry = new Map<BackendKind, Adapter>([['local-llm', local]]);
      const router = makeRouter({ config: BASE_CFG, registry, defaultKind: 'local-llm' });
      await withServer(router, async (port) => {
        const r = await fetch(`http://localhost:${port}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'm',
            stream: true,
            messages: [{ role: 'user', content: 'ask codex fix the flaky test' }],
            metadata: { agent_kind: 'auto' },
          }),
        });
        const text = await r.text();
        expect(text).toContain('"label":"→ local-llm"');
        // Registry miss → no prefix stripping; the fallback sees the raw text.
        expect(local.requests[0]!.messages.at(-1)?.content).toBe(
          'ask codex fix the flaky test'
        );
      });
    });

    it('AGENT_KIND=auto as default: classifies requests that omit agent_kind', async () => {
      const local = new Capture('local-llm');
      const memory = new Capture('memory');
      const registry = new Map<BackendKind, Adapter>([
        ['local-llm', local],
        ['memory', memory],
      ]);
      const router = makeRouter({ config: BASE_CFG, registry, defaultKind: 'auto' });
      await withServer(router, async (port) => {
        const call = (content: string) =>
          fetch(`http://localhost:${port}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'm',
              stream: true,
              messages: [{ role: 'user', content }],
              metadata: {},
            }),
          }).then((r) => r.text());
        await call('what did I eat yesterday');
        expect(memory.requests).toHaveLength(1);
        // Memory queries are NOT stripped — the utterance is the recall query.
        expect(memory.requests[0]!.messages.at(-1)?.content).toBe(
          'what did I eat yesterday'
        );
        await call('tell me a joke');
        expect(local.requests).toHaveLength(1);
      });
    });

    it('defaultKind=auto with no local-llm registered falls back to the first registered kind', async () => {
      const hermes = new Capture('hermes');
      const registry = new Map<BackendKind, Adapter>([['hermes', hermes]]);
      const router = makeRouter({ config: BASE_CFG, registry, defaultKind: 'auto' });
      await withServer(router, async (port) => {
        const text = await fetch(`http://localhost:${port}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'm',
            stream: true,
            messages: [{ role: 'user', content: 'hello there' }],
            metadata: { agent_kind: 'auto' },
          }),
        }).then((r) => r.text());
        expect(text).toContain('"label":"→ hermes"');
        expect(hermes.requests).toHaveLength(1);
      });
    });

    it('stream:false routes but skips the agent_status routing event', async () => {
      const hermes = new Capture('hermes');
      const registry = new Map<BackendKind, Adapter>([
        ['local-llm', new Capture('local-llm')],
        ['hermes', hermes],
      ]);
      const router = makeRouter({ config: BASE_CFG, registry, defaultKind: 'local-llm' });
      await withServer(router, async (port) => {
        const r = await fetch(`http://localhost:${port}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'm',
            stream: false,
            messages: [{ role: 'user', content: 'hermes, ping' }],
            metadata: { agent_kind: 'auto' },
          }),
        });
        const body = await r.json();
        expect(body.choices[0].message.content).toBe('hermes:ping');
        expect(hermes.requests[0]!.messages.at(-1)?.content).toBe('ping');
      });
    });
  });

  it('accepts a valid CI-Portal JWT when OIDC verification is enabled', async () => {
    const { privateKey, publicKey } = await generateKeyPair('EdDSA');
    const verifier = new PortalTokenVerifier(
      {
        enabled: true,
        issuer: 'https://hub.ci.computer',
        jwksUri: 'https://unused/jwks',
        audience: 'ci-hub',
      },
      publicKey
    );
    const token = await new SignJWT({ email: 'ada@ci.co' })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer('https://hub.ci.computer')
      .setAudience('ci-hub')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

    const adapter = new FakeAdapter();
    const router = makeRouter({ config: BASE_CFG, adapter, verifier });
    await withServer(router, async (port) => {
      // No credential → rejected.
      const denied = await fetch(`http://localhost:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'm', stream: false, messages: [] }),
      });
      expect(denied.status).toBe(401);

      // Valid Portal JWT → accepted.
      const ok = await fetch(`http://localhost:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model: 'm',
          stream: false,
          messages: [{ role: 'user', content: 'hi' }],
          metadata: { session_id: 'jwt-sess' },
        }),
      });
      expect(ok.status).toBe(200);
    });
  });

  /** Adapter whose turn pauses mid-stream until the test calls `release()`. */
  class SteppableAdapter implements Adapter {
    readonly kind = 'openai' as const;
    wasAborted = false;
    private waiters: Array<() => void> = [];

    async *run(_req: ChatRequest, ctx: SessionContext): AsyncIterable<AgentEvent> {
      ctx.signal.addEventListener('abort', () => {
        this.wasAborted = true;
        // Unblock any pending wait, same as a real adapter killing its
        // subprocess on abort and thereby resolving a pending dequeue.
        this.waiters.splice(0).forEach((w) => w());
      });
      yield { type: 'text', delta: 'first ' };
      await new Promise<void>((resolve) => this.waiters.push(resolve));
      if (ctx.signal.aborted) return;
      yield { type: 'text', delta: 'second' };
      yield { type: 'agent_status', kind: 'done' };
    }

    get hasWaiter(): boolean {
      return this.waiters.length > 0;
    }

    release(): void {
      this.waiters.shift()?.();
    }
  }

  /** Read the stream until the first blank-line-terminated SSE frame arrives. */
  async function readFirstFrame(response: Response): Promise<string> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (!buf.includes('\n\n')) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    return buf;
  }

  describe('streaming resume', () => {
    it('replays only events after the given cursor on reconnect', async () => {
      const adapter = new SteppableAdapter();
      const router = makeRouter({ config: BASE_CFG, adapter });
      await withServer(router, async (port) => {
        const first = await fetch(`http://localhost:${port}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'm',
            stream: true,
            messages: [{ role: 'user', content: 'hi' }],
            metadata: { session_id: 'resume-1' },
          }),
        });
        // Consume exactly the first event (seq 0: "first "), then abandon
        // this response without closing it — simulating a client that
        // stops reading (backgrounded WebView, dropped wifi) mid-turn.
        const frame = await readFirstFrame(first);
        expect(frame).toContain('"first "');

        adapter.release();
        // Let the adapter's continuation (text "second" + done) reach the
        // buffer and finish the turn before reconnecting.
        await new Promise((r) => setTimeout(r, 20));

        const replay = await fetch(
          `http://localhost:${port}/v1/chat/completions/stream?session_id=resume-1&after=0`
        );
        const text = await replay.text();
        expect(text).not.toContain('"first "');
        expect(text).toContain('"second"');
        expect(text).toContain('data: [DONE]');
      });
    });

    it('404s a reconnect for a session with no buffered turn', async () => {
      const adapter = new SteppableAdapter();
      const router = makeRouter({ config: BASE_CFG, adapter });
      await withServer(router, async (port) => {
        const r = await fetch(
          `http://localhost:${port}/v1/chat/completions/stream?session_id=never-started&after=-1`
        );
        expect(r.status).toBe(404);
      });
    });

    /** Adapter that floods past the 200-event ring buffer once released. */
    class FloodingAdapter implements Adapter {
      readonly kind = 'openai' as const;
      private waiters: Array<() => void> = [];

      async *run(_req: ChatRequest, _ctx: SessionContext): AsyncIterable<AgentEvent> {
        yield { type: 'text', delta: 'first' };
        await new Promise<void>((resolve) => this.waiters.push(resolve));
        for (let i = 0; i < 250; i++) {
          yield { type: 'text', delta: `e${i}` };
        }
        yield { type: 'agent_status', kind: 'done' };
      }

      release(): void {
        this.waiters.shift()?.();
      }
    }

    it('410s a reconnect whose cursor was evicted from the ring buffer', async () => {
      const adapter = new FloodingAdapter();
      const router = makeRouter({ config: BASE_CFG, adapter });
      await withServer(router, async (port) => {
        const first = await fetch(`http://localhost:${port}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'm',
            stream: true,
            messages: [{ role: 'user', content: 'hi' }],
            metadata: { session_id: 'resume-gap' },
          }),
        });
        await readFirstFrame(first);
        adapter.release();
        // Let all 250+ events flow through and evict the early ones from
        // the 200-entry ring buffer before reconnecting.
        await new Promise((r) => setTimeout(r, 50));

        const r = await fetch(
          `http://localhost:${port}/v1/chat/completions/stream?session_id=resume-gap&after=0`
        );
        expect(r.status).toBe(410);
      });
    });
  });

  describe('session cancel', () => {
    it('POST .../cancel aborts an in-flight turn and completes its stream', async () => {
      const adapter = new SteppableAdapter();
      const router = makeRouter({ config: BASE_CFG, adapter });
      await withServer(router, async (port) => {
        const streamPromise = fetch(`http://localhost:${port}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'm',
            stream: true,
            messages: [{ role: 'user', content: 'hi' }],
            metadata: { session_id: 'cancel-1' },
          }),
        }).then((r) => r.text());

        await vi.waitFor(() => expect(adapter.hasWaiter).toBe(true));

        const cancelRes = await fetch(
          `http://localhost:${port}/v1/sessions/cancel-1/cancel`,
          { method: 'POST' }
        );
        expect(cancelRes.status).toBe(200);
        expect(await cancelRes.json()).toEqual({ ok: true });

        const text = await streamPromise;
        expect(text).toContain('data: [DONE]');
        expect(text).not.toContain('"second"');
        expect(adapter.wasAborted).toBe(true);
      });
    });

    it('returns ok:false for a session with no in-flight turn', async () => {
      const adapter = new SteppableAdapter();
      const router = makeRouter({ config: BASE_CFG, adapter });
      await withServer(router, async (port) => {
        const r = await fetch(`http://localhost:${port}/v1/sessions/nope/cancel`, {
          method: 'POST',
        });
        expect(r.status).toBe(200);
        expect(await r.json()).toEqual({ ok: false });
      });
    });
  });

  it('approve returns 404 for unknown session', async () => {
    const adapter = new FakeAdapter();
    const router = makeRouter({ config: BASE_CFG, adapter });
    await withServer(router, async (port) => {
      const r = await fetch(
        `http://localhost:${port}/v1/sessions/nope/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt_id: 'p1', option_id: 'approve' }),
        }
      );
      expect(r.status).toBe(404);
    });
  });
});
