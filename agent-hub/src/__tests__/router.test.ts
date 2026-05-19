import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { makeRouter } from '../router.ts';
import type { Adapter, ChatRequest, SessionContext } from '../adapters/Adapter.ts';
import type { AgentEvent } from '../events.ts';
import type { HubConfig } from '../config.ts';

const BASE_CFG: HubConfig = {
  port: 0,
  authToken: '',
  agentKind: 'openai',
  downstreamUrl: '',
  downstreamApiKey: '',
  claudeBinary: 'claude',
  codexBinary: 'codex',
  openclawGatewayUrl: '',
  openclawToken: '',
  agentCwd: process.cwd(),
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
      expect(body).toEqual({ ok: true, kind: 'openai' });
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
