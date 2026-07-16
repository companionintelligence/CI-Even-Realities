import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  wantsMemoryAugment,
  withMemoryAugment,
} from '../middleware/memory.ts';
import { makeRouter } from '../router.ts';
import type {
  Adapter,
  BackendKind,
  ChatMessage,
  ChatRequest,
  SessionContext,
} from '../adapters/Adapter.ts';
import type { AgentEvent } from '../events.ts';
import type { HubConfig } from '../config.ts';

const CTX: SessionContext = {
  sessionId: 'sess-mem',
  signal: new AbortController().signal,
};

/** Inner chat adapter double: records the request it saw, replays events. */
class EchoAdapter implements Adapter {
  readonly kind: BackendKind;
  seen: ChatRequest[] = [];
  constructor(
    kind: BackendKind = 'openai',
    private events: AgentEvent[] = [
      { type: 'agent_status', kind: 'thinking' },
      { type: 'text', delta: 'hi ' },
      { type: 'text', delta: 'there' },
      { type: 'agent_status', kind: 'done' },
    ]
  ) {
    this.kind = kind;
  }
  async *run(req: ChatRequest): AsyncIterable<AgentEvent> {
    this.seen.push(req);
    for (const e of this.events) yield e;
  }
}

/** Local fake CI-Server: /memory/recall + /memory/turn, both request-logged. */
interface Upstream {
  url: string;
  recallStatus: number;
  recallBody: unknown;
  recalls: Array<{ body: Record<string, unknown>; apiKey: string | undefined }>;
  turns: Array<{ body: Record<string, unknown>; apiKey: string | undefined }>;
  waitForTurn(): Promise<void>;
  close(): Promise<void>;
}

async function startUpstream(): Promise<Upstream> {
  let notifyTurn: (() => void) | undefined;
  const state = {
    recallStatus: 200,
    recallBody: { block: 'Liam prefers tea.' } as unknown,
    recalls: [] as Upstream['recalls'],
    turns: [] as Upstream['turns'],
  };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const body = chunks.length
        ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
            string,
            unknown
          >)
        : {};
      const apiKey = req.headers['x-api-key'] as string | undefined;
      if (req.url === '/memory/recall') {
        state.recalls.push({ body, apiKey });
        res.writeHead(state.recallStatus, { 'Content-Type': 'application/json' });
        res.end(
          state.recallStatus === 200 ? JSON.stringify(state.recallBody) : 'boom'
        );
      } else if (req.url === '/memory/turn') {
        state.turns.push({ body, apiKey });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
        notifyTurn?.();
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    get recallStatus() {
      return state.recallStatus;
    },
    set recallStatus(v: number) {
      state.recallStatus = v;
    },
    get recallBody() {
      return state.recallBody;
    },
    set recallBody(v: unknown) {
      state.recallBody = v;
    },
    recalls: state.recalls,
    turns: state.turns,
    waitForTurn: () =>
      state.turns.length > 0
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            const t = setTimeout(
              () => reject(new Error('turn write-back never arrived')),
              2000
            );
            notifyTurn = () => {
              clearTimeout(t);
              resolve();
            };
          }),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

function chatReq(content: string, messages?: ChatMessage[]): ChatRequest {
  return {
    model: 'm',
    stream: true,
    messages: messages ?? [
      { role: 'system', content: 'you are a HUD' },
      { role: 'user', content },
    ],
    metadata: { use_memory: true },
  };
}

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

/** Settle window for asserting a fire-and-forget request did NOT happen. */
const settle = () => new Promise((r) => setTimeout(r, 100));

describe('wantsMemoryAugment (router guard)', () => {
  const body = (metadata?: Record<string, unknown>): ChatRequest => ({
    model: 'm',
    stream: true,
    messages: [],
    metadata,
  });

  it('opts in only on use_memory === true with CI-Server configured', () => {
    expect(wantsMemoryAugment(body({ use_memory: true }), 'http://s', 'openai')).toBe(true);
    expect(wantsMemoryAugment(body({ use_memory: true }), 'http://s', 'local-llm')).toBe(true);
    expect(wantsMemoryAugment(body(), 'http://s', 'openai')).toBe(false);
    expect(wantsMemoryAugment(body({ use_memory: false }), 'http://s', 'openai')).toBe(false);
    // Strict boolean — a "true" string is not an opt-in.
    expect(wantsMemoryAugment(body({ use_memory: 'true' }), 'http://s', 'openai')).toBe(false);
  });

  it('never wraps the memory adapter itself, and needs a CI-Server URL', () => {
    expect(wantsMemoryAugment(body({ use_memory: true }), 'http://s', 'memory')).toBe(false);
    expect(wantsMemoryAugment(body({ use_memory: true }), '', 'openai')).toBe(false);
  });
});

describe('withMemoryAugment', () => {
  let up: Upstream;
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    up = await startUpstream();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(async () => {
    warn.mockRestore();
    await up.close();
  });

  it('prepends the recalled block as a system message without mutating the caller', async () => {
    const inner = new EchoAdapter();
    const wrapped = withMemoryAugment(inner, { baseUrl: up.url, apiKey: 'mk-1' });
    const original: ChatMessage[] = [
      { role: 'system', content: 'you are a HUD' },
      { role: 'user', content: 'what do I drink' },
    ];
    const req = chatReq('what do I drink', original);

    const events = await collect(wrapped.run(req, CTX));

    // Recall carried the api key and the last user message as query.
    expect(up.recalls).toHaveLength(1);
    expect(up.recalls[0]!.apiKey).toBe('mk-1');
    expect(up.recalls[0]!.body).toMatchObject({
      query: 'what do I drink',
      maxResults: 5,
    });

    // Inner adapter saw the memory system message prepended…
    expect(inner.seen[0]!.messages).toHaveLength(3);
    expect(inner.seen[0]!.messages[0]).toEqual({
      role: 'system',
      content:
        'Relevant memories about the user (from Companion Memory):\nLiam prefers tea.',
    });
    // …while the caller's array is untouched.
    expect(req.messages).toBe(original);
    expect(original).toHaveLength(2);
    expect(original[0]).toEqual({ role: 'system', content: 'you are a HUD' });

    // All inner events re-yielded unchanged, wrapper keeps the inner kind.
    expect(events.map((e) => e.type)).toEqual([
      'agent_status',
      'text',
      'text',
      'agent_status',
    ]);
    expect(wrapped.kind).toBe('openai');
  });

  it('proceeds without memories when recall fails', async () => {
    up.recallStatus = 500;
    const inner = new EchoAdapter();
    const wrapped = withMemoryAugment(inner, { baseUrl: up.url, apiKey: 'k' });

    const events = await collect(wrapped.run(chatReq('q'), CTX));

    // Chat ran, unaugmented, and the failure only warned.
    expect(inner.seen[0]!.messages).toHaveLength(2);
    expect(events.some((e) => e.type === 'text' && e.delta === 'hi ')).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('recall 500'));
  });

  it('writes the completed turn back to CI-Server', async () => {
    const inner = new EchoAdapter();
    const wrapped = withMemoryAugment(inner, { baseUrl: up.url, apiKey: 'mk-2' });

    await collect(wrapped.run(chatReq('what do I drink'), CTX));
    await up.waitForTurn();

    expect(up.turns[0]!.apiKey).toBe('mk-2');
    expect(up.turns[0]!.body).toEqual({
      session_id: 'sess-mem',
      user: 'what do I drink',
      assistant: 'hi there',
      source: 'ci-glasses',
    });
  });

  it('honors custom recall/turn paths', async () => {
    // Custom paths 404 on the fake upstream — the point is only that the
    // middleware targets them, so recall/turn logs must both stay empty.
    const inner = new EchoAdapter();
    const wrapped = withMemoryAugment(inner, {
      baseUrl: `${up.url}/`,
      apiKey: 'k',
      recallPath: '/api/memory/recall',
      turnPath: '/api/memory/turn',
    });
    await collect(wrapped.run(chatReq('q'), CTX));
    await settle();
    expect(up.recalls).toHaveLength(0);
    expect(up.turns).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('recall 404'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('write-back 404'));
  });

  it('skips write-back when the inner adapter errors', async () => {
    const inner = new EchoAdapter('openai', [
      { type: 'text', delta: 'partial' },
      { type: 'error', message: 'downstream exploded' },
    ]);
    const wrapped = withMemoryAugment(inner, { baseUrl: up.url, apiKey: 'k' });

    const events = await collect(wrapped.run(chatReq('q'), CTX));

    // Error event is re-yielded to the caller…
    expect(events.at(-1)).toMatchObject({ type: 'error' });
    // …and the broken turn is never memorised.
    await settle();
    expect(up.turns).toHaveLength(0);
  });
});

describe('router memory augmentation', () => {
  const cfg = (ciServerUrl: string): HubConfig => ({
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
    hermesGatewayUrl: '',
    hermesToken: '',
    ciServerUrl,
    ciServerApiKey: 'mk-router',
    ciServerMemoryPath: '/memory/recall',
    ciServerTurnPath: '/memory/turn',
  });

  async function withRouterServer<T>(
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

  it('augments a flagged request end-to-end (recall in, turn out)', async () => {
    const up = await startUpstream();
    const inner = new EchoAdapter();
    const router = makeRouter({
      config: cfg(up.url),
      registry: new Map<BackendKind, Adapter>([['openai', inner]]),
      defaultKind: 'openai',
    });
    try {
      await withRouterServer(router, async (port) => {
        const r = await fetch(`http://localhost:${port}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'm',
            stream: false,
            messages: [{ role: 'user', content: 'what do I drink' }],
            metadata: { session_id: 's-int', use_memory: true },
          }),
        });
        const body = (await r.json()) as {
          choices: Array<{ message: { content: string } }>;
        };
        expect(body.choices[0]!.message.content).toBe('hi there');
        // Memories were injected in front of the user's message…
        expect(inner.seen[0]!.messages[0]!.role).toBe('system');
        expect(inner.seen[0]!.messages[0]!.content).toContain('Liam prefers tea.');
        // …and the finished turn flowed back under the request's session id.
        await up.waitForTurn();
        expect(up.turns[0]!.body).toMatchObject({
          session_id: 's-int',
          assistant: 'hi there',
          source: 'ci-glasses',
        });
      });
    } finally {
      await up.close();
    }
  });

  it('does not wrap the memory adapter itself', async () => {
    const up = await startUpstream();
    const memoryLike = new EchoAdapter('memory');
    const router = makeRouter({
      config: cfg(up.url),
      registry: new Map<BackendKind, Adapter>([['memory', memoryLike]]),
      defaultKind: 'memory',
    });
    try {
      await withRouterServer(router, async (port) => {
        await fetch(`http://localhost:${port}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'm',
            stream: false,
            messages: [{ role: 'user', content: 'q' }],
            metadata: { agent_kind: 'memory', use_memory: true },
          }),
        }).then((r) => r.json());
        // No recall-around-recall, no write-back — the adapter ran bare.
        await settle();
        expect(memoryLike.seen[0]!.messages).toHaveLength(1);
        expect(up.recalls).toHaveLength(0);
        expect(up.turns).toHaveLength(0);
      });
    } finally {
      await up.close();
    }
  });
});
