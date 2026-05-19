/**
 * router.ts
 *
 * Dispatches HTTP requests to the right handler. Implements two endpoints:
 *
 *   POST /v1/chat/completions     — OpenAI-shaped, returns SSE
 *   POST /v1/sessions/:id/approve — Approve/deny an outstanding prompt
 *   GET  /healthz                 — Liveness
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Adapter, ChatRequest } from './adapters/Adapter.ts';
import { writeAgentEvent, writeDone, writeSSEHead } from './sse.ts';
import { bindSession, getSession } from './sessions.ts';
import type { HubConfig } from './config.ts';

export interface RouterDeps {
  config: HubConfig;
  adapter: Adapter;
}

export function makeRouter(deps: RouterDeps) {
  return async function route(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // Permissive CORS so the glasses app (running in the Even Hub WebView,
    // a Tauri WKWebView simulator, or any browser) can call the hub from a
    // different origin. The hub is LAN-only; security comes from the bearer
    // token, not from origin restrictions.
    const origin = req.headers['origin'];
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type'
    );

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (method === 'GET' && url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, kind: deps.adapter.kind }));
      return;
    }

    if (!authorized(req, deps.config)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    if (method === 'POST' && url === '/v1/chat/completions') {
      return handleChatCompletions(req, res, deps);
    }

    const approveMatch = url.match(/^\/v1\/sessions\/([^/]+)\/approve$/);
    if (method === 'POST' && approveMatch) {
      return handleApprove(req, res, deps, decodeURIComponent(approveMatch[1]!));
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  };
}

function authorized(req: IncomingMessage, cfg: HubConfig): boolean {
  if (!cfg.authToken) return true;
  const header = req.headers['authorization'];
  return typeof header === 'string' && header === `Bearer ${cfg.authToken}`;
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

async function handleChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  { adapter }: RouterDeps
): Promise<void> {
  let body: ChatRequest;
  try {
    body = await readJsonBody<ChatRequest>(req);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ error: 'bad_request', message: (e as Error).message })
    );
    return;
  }

  const metaSessionId =
    typeof body.metadata?.['session_id'] === 'string'
      ? (body.metadata['session_id'] as string)
      : null;
  const sessionId = metaSessionId ?? randomUUID();
  bindSession(sessionId, adapter);

  const ac = new AbortController();
  req.on('close', () => ac.abort());

  // Honor the client's `stream` flag. When false, buffer all text deltas and
  // return a single OpenAI Chat Completions response — matches what
  // ChatCompletions.sendEvents expects in non-streaming mode and keeps
  // hub-routed kinds usable without SSE.
  if (body.stream === false) {
    let text = '';
    let errorMessage: string | undefined;
    try {
      for await (const evt of adapter.run(body, {
        sessionId,
        signal: ac.signal,
      })) {
        if (evt.type === 'text') text += evt.delta;
        else if (evt.type === 'error') {
          errorMessage = evt.message;
          break;
        }
        // status / permission_prompt events have no representation in the
        // non-streaming Chat Completions schema; they're silently dropped.
      }
    } catch (e) {
      errorMessage = (e as Error).message;
    }
    if (errorMessage) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: errorMessage } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: 'stop',
      }],
    }));
    return;
  }

  writeSSEHead(res);

  try {
    for await (const evt of adapter.run(body, {
      sessionId,
      signal: ac.signal,
    })) {
      writeAgentEvent(res, evt, body.model);
    }
  } catch (e) {
    writeAgentEvent(
      res,
      { type: 'error', message: (e as Error).message },
      body.model
    );
  } finally {
    writeDone(res);
  }
}

async function handleApprove(
  req: IncomingMessage,
  res: ServerResponse,
  _deps: RouterDeps,
  sessionId: string
): Promise<void> {
  let body: { prompt_id?: string; option_id?: string };
  try {
    body = await readJsonBody(req);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'bad_request', message: (e as Error).message }));
    return;
  }

  const adapter = getSession(sessionId);
  if (!adapter) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'no_session' }));
    return;
  }
  if (!adapter.approve) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unsupported_for_adapter' }));
    return;
  }
  if (typeof body.prompt_id !== 'string' || typeof body.option_id !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing_fields' }));
    return;
  }
  const ok = await adapter.approve(sessionId, body.prompt_id, body.option_id);
  res.writeHead(ok ? 200 : 409, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok }));
}
