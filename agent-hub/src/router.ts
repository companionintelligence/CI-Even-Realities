/**
 * router.ts
 *
 * Dispatches HTTP requests to the right handler. Implements:
 *
 *   POST /v1/chat/completions          — OpenAI-shaped, returns SSE
 *   GET  /v1/chat/completions/stream   — Reattach to an in-flight/just-finished turn's SSE
 *   POST /v1/audio/transcriptions      — Whisper-compatible STT proxy (stt.ts)
 *   POST /v1/sessions/:id/approve      — Approve/deny an outstanding prompt
 *   POST /v1/sessions/:id/cancel       — Cancel a session's in-flight turn
 *   GET  /healthz                      — Liveness
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Adapter, BackendKind, ChatRequest } from './adapters/Adapter.ts';
import { writeSSEHead } from './sse.ts';
import { bindSession, getSession } from './sessions.ts';
import { startTurn, getTurn, cancelTurn } from './streamBuffer.ts';
import type { HubConfig } from './config.ts';
import { makePortalVerifier, type PortalTokenVerifier } from './auth.ts';
import { classifyIntent } from './routing/intent.ts';
import { wantsMemoryAugment, withMemoryAugment } from './middleware/memory.ts';
import { handleTranscription } from './stt.ts';

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

interface AdapterSelection {
  adapter: Adapter;
  /** Possibly a copy of the request ('auto' routing may strip an address prefix). */
  body: ChatRequest;
  /** Set when the virtual 'auto' kind resolved this request; drives the HUD status event. */
  autoRoutedKind?: BackendKind;
}

/**
 * Fallback chain when 'auto' classification lands on an unregistered target:
 * defaultKind when it is a real registered kind, else 'local-llm', else the
 * first registered kind (the registry is never empty, see resolveRegistry).
 */
function autoFallback(
  registry: Map<BackendKind, Adapter>,
  defaultKind: BackendKind
): BackendKind {
  if (defaultKind !== 'auto' && registry.has(defaultKind)) return defaultKind;
  if (registry.has('local-llm')) return 'local-llm';
  return registry.keys().next().value as BackendKind;
}

/**
 * Pick the adapter for a request: metadata.agent_kind, else the default.
 * The virtual 'auto' kind (requested or as default) is resolved here by
 * classifying the last user message (routing/intent.ts). When the classifier
 * strips an explicit address prefix ("ask hermes …"), the returned body is a
 * COPY with that message's content replaced — the parsed request is never
 * mutated in place.
 */
function selectAdapter(
  body: ChatRequest,
  registry: Map<BackendKind, Adapter>,
  defaultKind: BackendKind
): AdapterSelection {
  const raw = body.metadata?.['agent_kind'];
  const requested = typeof raw === 'string' ? (raw as BackendKind) : undefined;
  const kind =
    requested && (requested === 'auto' || registry.has(requested))
      ? requested
      : defaultKind;

  if (kind !== 'auto') {
    const adapter =
      registry.get(kind) ?? (registry.values().next().value as Adapter);
    return { adapter, body };
  }

  // 'auto' — classify the last user message to pick a registered target.
  const messages = Array.isArray(body.messages) ? body.messages : [];
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  const utterance = lastUserIdx >= 0 ? messages[lastUserIdx]!.content : '';
  const intent = classifyIntent(utterance);

  let resolved: BackendKind;
  let routedBody = body;
  if (registry.has(intent.kind)) {
    resolved = intent.kind;
    if (intent.cleanedText !== undefined && lastUserIdx >= 0) {
      routedBody = {
        ...body,
        messages: messages.map((m, i) =>
          i === lastUserIdx ? { ...m, content: intent.cleanedText! } : m
        ),
      };
    }
  } else {
    resolved = autoFallback(registry, defaultKind);
  }
  return {
    adapter: registry.get(resolved)!,
    body: routedBody,
    autoRoutedKind: resolved,
  };
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

    if (method === 'GET' && url.startsWith('/v1/chat/completions/stream')) {
      return handleResumeStream(req, res);
    }

    if (method === 'POST' && url === '/v1/audio/transcriptions') {
      return handleTranscription(req, res, deps.config);
    }

    const approveMatch = url.match(/^\/v1\/sessions\/([^/]+)\/approve$/);
    if (method === 'POST' && approveMatch) {
      return handleApprove(req, res, deps, decodeURIComponent(approveMatch[1]!));
    }

    const cancelMatch = url.match(/^\/v1\/sessions\/([^/]+)\/cancel$/);
    if (method === 'POST' && cancelMatch) {
      const ok = cancelTurn(decodeURIComponent(cancelMatch[1]!));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok }));
      return;
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

  const selection = selectAdapter(body, registry, defaultKind);
  let adapter = selection.adapter;
  body = selection.body;

  // Memory as a layer: a request flagged `metadata.use_memory === true` gets
  // CI-Server recall prepended and its finished turn written back, whatever
  // chat backend it targets ('auto' included — the wrap applies to the resolved
  // target and the routed body). The `memory` adapter itself is exempt — it IS
  // the recall — and an unconfigured CI-Server means no augmentation.
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

  // Honor the client's `stream` flag. When false, buffer all text deltas and
  // return a single OpenAI Chat Completions response — matches what
  // ChatCompletions.sendEvents expects in non-streaming mode and keeps
  // hub-routed kinds usable without SSE.
  if (body.stream === false) {
    // No reconnect concept for a single synchronous response — a dropped
    // connection here really does mean "give up".
    req.on('close', () => ac.abort());
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

  // Streaming: route events through a per-session TurnBuffer instead of
  // writing straight to `res`, so a client that reconnects after a dropped
  // connection (WebView backgrounded, wifi hiccup) can replay what it missed
  // via GET /v1/chat/completions/stream instead of losing the in-flight
  // answer. A dropped connection alone no longer aborts the adapter run —
  // only an explicit cancel (POST .../cancel) or a new turn superseding this
  // one on the same session does (see streamBuffer.ts).
  writeSSEHead(res);
  const turnId = randomUUID();
  const buffer = startTurn(sessionId, turnId, body.model, () => ac.abort());
  buffer.attach(res, -1);
  req.on('close', () => buffer.detach(res));

  // Surface the 'auto' routing decision on the HUD before the adapter stream.
  // (No representation in the non-streaming schema, so stream:false skips it.)
  if (selection.autoRoutedKind) {
    buffer.push({
      type: 'agent_status',
      kind: 'thinking',
      label: `→ ${selection.autoRoutedKind}`,
    });
  }

  try {
    for await (const evt of adapter.run(body, {
      sessionId,
      signal: ac.signal,
    })) {
      buffer.push(evt);
    }
  } catch (e) {
    buffer.push({ type: 'error', message: (e as Error).message });
  } finally {
    buffer.finish();
  }
}

/**
 * GET /v1/chat/completions/stream?session_id=...&after=<cursor>
 *
 * Reattach to an in-flight or just-finished turn's SSE, replaying any
 * buffered events after `after` (a cursor is just a count of events already
 * consumed; -1 or omitted means "from the start"). 404 when no turn is
 * buffered for that session (never started, or evicted after completion);
 * 410 when the requested cursor is older than what the ring buffer
 * retained — either way the client's only recourse is a fresh POST.
 */
async function handleResumeStream(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const parsed = new URL(req.url ?? '', 'http://internal');
  const sessionId = parsed.searchParams.get('session_id') ?? '';
  const afterRaw = parsed.searchParams.get('after');
  const afterNum = afterRaw !== null ? Number(afterRaw) : NaN;
  const after = Number.isFinite(afterNum) ? afterNum : -1;

  const buffer = sessionId ? getTurn(sessionId) : undefined;
  if (!buffer) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'no_active_turn' }));
    return;
  }
  if (!buffer.canResumeFrom(after)) {
    res.writeHead(410, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ error: 'gap', message: 'resume point no longer buffered' })
    );
    return;
  }

  writeSSEHead(res);
  buffer.attach(res, after);
  req.on('close', () => buffer.detach(res));
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
