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
import type { Adapter, BackendKind, ChatRequest } from './adapters/Adapter.ts';
import { writeAgentEvent, writeDone, writeSSEHead } from './sse.ts';
import { bindSession, getSession } from './sessions.ts';
import type { HubConfig } from './config.ts';
import { makePortalVerifier, type PortalTokenVerifier } from './auth.ts';
import { wantsMemoryAugment, withMemoryAugment } from './middleware/memory.ts';

export interface RouterDeps {
  config: HubConfig;
  /**
   * Single adapter (back-compat) OR a multi-target registry. When `registry`
   * is set, each request selects its adapter by `metadata.agent_kind`, falling
   * back to `defaultKind`. This is how the glasses drive Ollama / Hermes /
   * OpenClaw / memory through one hub without restarting it.
   */
  adapter?: Adapter;
  registry?: Map<BackendKind, Adapter>;
  defaultKind?: BackendKind;
  /** Optional override (tests inject a locally-keyed verifier). */
  verifier?: PortalTokenVerifier;
}

/** Normalize deps to a registry + default kind, supporting the single-adapter form. */
function resolveRegistry(deps: RouterDeps): {
  registry: Map<BackendKind, Adapter>;
  defaultKind: BackendKind;
} {
  if (deps.registry && deps.registry.size > 0) {
    const defaultKind =
      deps.defaultKind ?? (deps.registry.keys().next().value as BackendKind);
    return { registry: deps.registry, defaultKind };
  }
  const a = deps.adapter;
  if (!a) throw new Error('RouterDeps requires either `adapter` or `registry`');
  return { registry: new Map([[a.kind, a]]), defaultKind: a.kind };
}

/** Pick the adapter for a request: metadata.agent_kind, else the default. */
function selectAdapter(
  body: ChatRequest,
  registry: Map<BackendKind, Adapter>,
  defaultKind: BackendKind
): Adapter {
  const raw = body.metadata?.['agent_kind'];
  const kind = typeof raw === 'string' ? (raw as BackendKind) : undefined;
  return (kind && registry.get(kind)) || registry.get(defaultKind)!;
}

export function makeRouter(deps: RouterDeps) {
  const verifier = deps.verifier ?? makePortalVerifier(deps.config);
  const { registry, defaultKind } = resolveRegistry(deps);
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
      res.end(
        JSON.stringify({ ok: true, kind: defaultKind, kinds: [...registry.keys()] })
      );
      return;
    }

    if (!(await authorized(req, deps.config, verifier))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    if (method === 'POST' && url === '/v1/chat/completions') {
      return handleChatCompletions(req, res, registry, defaultKind, deps.config);
    }

    const approveMatch = url.match(/^\/v1\/sessions\/([^/]+)\/approve$/);
    if (method === 'POST' && approveMatch) {
      return handleApprove(req, res, deps, decodeURIComponent(approveMatch[1]!));
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  };
}

/**
 * Authorize a request. The hub is fully open only when neither a static token
 * nor Portal OIDC is configured (loopback dev). Otherwise it accepts the static
 * `HUB_TOKEN` bearer, or — when OIDC is enabled — a valid CI-Portal JWT.
 */
async function authorized(
  req: IncomingMessage,
  cfg: HubConfig,
  verifier: PortalTokenVerifier
): Promise<boolean> {
  const header =
    typeof req.headers['authorization'] === 'string'
      ? req.headers['authorization']
      : '';
  if (!cfg.authToken && !verifier.enabled) return true;
  if (cfg.authToken && header === `Bearer ${cfg.authToken}`) return true;
  if (verifier.enabled && header.startsWith('Bearer ')) {
    const result = await verifier.verify(header.slice(7));
    if (result.ok) return true;
  }
  return false;
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
  registry: Map<BackendKind, Adapter>,
  defaultKind: BackendKind,
  cfg: HubConfig
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

  let adapter = selectAdapter(body, registry, defaultKind);

  // Memory as a layer: a request flagged `metadata.use_memory === true` gets
  // CI-Server recall prepended and its finished turn written back, whatever
  // chat backend it targets. The `memory` adapter itself is exempt — it IS
  // the recall — and unconfigured CI-Server means no augmentation.
  if (wantsMemoryAugment(body, cfg.ciServerUrl, adapter.kind)) {
    adapter = withMemoryAugment(adapter, {
      baseUrl: cfg.ciServerUrl,
      apiKey: cfg.ciServerApiKey,
      recallPath: cfg.ciServerMemoryPath,
      turnPath: cfg.ciServerTurnPath,
    });
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
