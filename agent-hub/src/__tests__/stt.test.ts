import { describe, it, expect } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { makeRouter } from '../router.ts';
import type { Adapter, ChatRequest, SessionContext } from '../adapters/Adapter.ts';
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
  hermesGatewayUrl: '',
  hermesToken: '',
  ciServerUrl: '',
  ciServerApiKey: '',
  ciServerMemoryPath: '/memory/recall',
  sttUrl: '',
  sttApiKey: '',
};

/** Router needs at least one adapter; STT never touches it. */
class NoopAdapter implements Adapter {
  readonly kind = 'openai' as const;
  async *run(_req: ChatRequest, _ctx: SessionContext): AsyncIterable<AgentEvent> {
    yield { type: 'text', delta: 'unused' };
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

interface CapturedRequest {
  url: string;
  contentType: string | undefined;
  authorization: string | undefined;
  body: Buffer;
}

/** Real local Whisper-shaped upstream that records exactly what it received. */
async function withUpstream<T>(
  respond: { status: number; body: string },
  fn: (port: number, captured: CapturedRequest[]) => Promise<T>
): Promise<T> {
  const captured: CapturedRequest[] = [];
  const server: Server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      captured.push({
        url: req.url ?? '',
        contentType: req.headers['content-type'],
        authorization: req.headers['authorization'],
        body: Buffer.concat(chunks),
      });
      res.writeHead(respond.status, { 'Content-Type': 'application/json' });
      res.end(respond.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(port, captured);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

/** A multipart payload with binary-ish bytes, as WhisperSTT would send. */
const BOUNDARY = '----vitest-boundary-7MA4YWxkTrZu0gW';
const MULTIPART_BODY = Buffer.concat([
  Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="clip.wav"\r\nContent-Type: audio/wav\r\n\r\n`
  ),
  Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x01, 0xff, 0xfe, 0x80, 0x7f]),
  Buffer.from(`\r\n--${BOUNDARY}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--${BOUNDARY}--\r\n`),
]);
const MULTIPART_TYPE = `multipart/form-data; boundary=${BOUNDARY}`;

describe('stt proxy', () => {
  it('forwards body + content-type byte-for-byte and pipes the upstream JSON back', async () => {
    await withUpstream(
      { status: 200, body: JSON.stringify({ text: 'hello glasses' }) },
      async (upstreamPort, captured) => {
        const router = makeRouter({
          config: { ...BASE_CFG, sttUrl: `http://localhost:${upstreamPort}` },
          adapter: new NoopAdapter(),
        });
        await withServer(router, async (port) => {
          const r = await fetch(`http://localhost:${port}/v1/audio/transcriptions`, {
            method: 'POST',
            headers: { 'Content-Type': MULTIPART_TYPE },
            body: MULTIPART_BODY,
          });
          expect(r.status).toBe(200);
          expect(await r.json()).toEqual({ text: 'hello glasses' });

          expect(captured).toHaveLength(1);
          expect(captured[0]!.url).toBe('/v1/audio/transcriptions');
          // Boundary survives untouched…
          expect(captured[0]!.contentType).toBe(MULTIPART_TYPE);
          // …and the multipart body arrives byte-for-byte.
          expect(captured[0]!.body.equals(MULTIPART_BODY)).toBe(true);
          // No STT_API_KEY configured → no Authorization invented.
          expect(captured[0]!.authorization).toBeUndefined();
        });
      }
    );
  });

  it('injects the upstream key as a bearer and passes non-200 statuses verbatim', async () => {
    await withUpstream(
      { status: 400, body: JSON.stringify({ error: 'bad audio' }) },
      async (upstreamPort, captured) => {
        const router = makeRouter({
          config: {
            ...BASE_CFG,
            sttUrl: `http://localhost:${upstreamPort}`,
            sttApiKey: 'whisper-secret',
          },
          adapter: new NoopAdapter(),
        });
        await withServer(router, async (port) => {
          const r = await fetch(`http://localhost:${port}/v1/audio/transcriptions`, {
            method: 'POST',
            headers: { 'Content-Type': MULTIPART_TYPE },
            body: MULTIPART_BODY,
          });
          expect(r.status).toBe(400);
          expect(await r.json()).toEqual({ error: 'bad audio' });
          expect(captured[0]!.authorization).toBe('Bearer whisper-secret');
        });
      }
    );
  });

  it('returns 501 stt_not_configured when STT_URL is unset', async () => {
    const router = makeRouter({ config: BASE_CFG, adapter: new NoopAdapter() });
    await withServer(router, async (port) => {
      const r = await fetch(`http://localhost:${port}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: { 'Content-Type': MULTIPART_TYPE },
        body: MULTIPART_BODY,
      });
      expect(r.status).toBe(501);
      expect(await r.json()).toEqual({
        error: 'stt_not_configured',
        message: 'Set STT_URL to a Whisper-compatible server',
      });
    });
  });

  it('returns 502 when the upstream refuses the connection', async () => {
    // Grab a port that is definitely free by binding and releasing it.
    const probe: Server = createServer();
    await new Promise<void>((r) => probe.listen(0, r));
    const deadPort = (probe.address() as AddressInfo).port;
    await new Promise<void>((r) => probe.close(() => r()));

    const router = makeRouter({
      config: { ...BASE_CFG, sttUrl: `http://localhost:${deadPort}` },
      adapter: new NoopAdapter(),
    });
    await withServer(router, async (port) => {
      const r = await fetch(`http://localhost:${port}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: { 'Content-Type': MULTIPART_TYPE },
        body: MULTIPART_BODY,
      });
      expect(r.status).toBe(502);
      const body = await r.json();
      expect(body.error).toBe('stt_upstream_unreachable');
    });
  });

  it('sits behind the same auth gate: 401 without credentials when HUB_TOKEN is set', async () => {
    const router = makeRouter({
      config: { ...BASE_CFG, authToken: 'secret' },
      adapter: new NoopAdapter(),
    });
    await withServer(router, async (port) => {
      const denied = await fetch(`http://localhost:${port}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: { 'Content-Type': MULTIPART_TYPE },
        body: MULTIPART_BODY,
      });
      expect(denied.status).toBe(401);

      // With the bearer the gate opens (501 here since no STT_URL configured).
      const allowed = await fetch(`http://localhost:${port}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: {
          'Content-Type': MULTIPART_TYPE,
          Authorization: 'Bearer secret',
        },
        body: MULTIPART_BODY,
      });
      expect(allowed.status).toBe(501);
    });
  });
});
