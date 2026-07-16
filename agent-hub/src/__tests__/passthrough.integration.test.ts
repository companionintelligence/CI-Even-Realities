/**
 * passthrough.integration.test.ts
 *
 * Exercises the full local-LLM path: fake OpenAI-shaped downstream → hub
 * passthrough adapter → hub HTTP → glasses-app parseSSEEvents consumer.
 * Mirrors what an Ollama instance produces on the wire.
 */

import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { makeRouter } from '../router.ts';
import { PassthroughAdapter } from '../adapters/passthrough.ts';
import type { HubConfig } from '../config.ts';

const BASE_CFG: HubConfig = {
  port: 0,
  bind: '127.0.0.1',
  authToken: '',
  agentKind: 'local-llm',
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

/** Spin up a fake downstream that streams the supplied chunks as SSE. */
function startFakeDownstream(deltas: string[]): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server: Server = createServer((req, res) => {
    expect(req.url).toBe('/v1/chat/completions');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
    for (const d of deltas) {
      const chunk = {
        choices: [{ delta: { content: d } }],
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        close: () =>
          new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function startHub(downstreamPort: number): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const adapter = new PassthroughAdapter({
    baseUrl: `http://localhost:${downstreamPort}`,
    kind: 'local-llm',
  });
  const router = makeRouter({ config: BASE_CFG, adapter });
  const server: Server = createServer((req, res) => {
    router(req, res).catch(() => res.end());
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe('passthrough adapter integration', () => {
  it('relays streamed deltas + wraps with agent_status thinking/done', async () => {
    const downstream = await startFakeDownstream(['Hello', ', ', 'world', '!']);
    const hub = await startHub(downstream.port);
    try {
      const res = await fetch(
        `http://localhost:${hub.port}/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'qwen-test',
            stream: true,
            messages: [{ role: 'user', content: 'hi' }],
            metadata: { session_id: 'int-1' },
          }),
        }
      );
      expect(res.status).toBe(200);
      const text = await res.text();
      const frames = text.split('\n\n').filter(Boolean);
      const events = frames.map((f) => {
        const lines = f.split('\n');
        const evt = lines.find((l) => l.startsWith('event:'))?.slice(7);
        const data = lines.find((l) => l.startsWith('data:'))?.slice(6);
        return { event: evt ?? 'message', data };
      });

      // First and last frames should be agent_status thinking/done.
      expect(events[0]).toEqual({
        event: 'agent_status',
        data: '{"kind":"thinking"}',
      });
      const last = events[events.length - 1]!;
      expect(last.data).toBe('[DONE]');
      const done = events.find(
        (e) => e.event === 'agent_status' && e.data?.includes('"done"')
      );
      expect(done).toBeDefined();

      // Text frames should preserve the input deltas verbatim.
      const textParts: string[] = [];
      for (const e of events) {
        if (e.event !== 'message' || !e.data || e.data === '[DONE]') continue;
        const parsed = JSON.parse(e.data) as {
          choices: Array<{ delta: { content?: string } }>;
        };
        const c = parsed.choices[0]?.delta.content;
        if (typeof c === 'string') textParts.push(c);
      }
      expect(textParts).toEqual(['Hello', ', ', 'world', '!']);
    } finally {
      await hub.close();
      await downstream.close();
    }
  });

  it('reports downstream errors as agent error events', async () => {
    // Server that always 500s.
    const server: Server = createServer((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('boom');
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    const hub = await startHub(port);
    try {
      const res = await fetch(
        `http://localhost:${hub.port}/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'qwen-test',
            stream: true,
            messages: [{ role: 'user', content: 'hi' }],
          }),
        }
      );
      const text = await res.text();
      expect(text).toContain('event: error');
      expect(text).toContain('passthrough 500');
      expect(text).toContain('data: [DONE]');
    } finally {
      await hub.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
