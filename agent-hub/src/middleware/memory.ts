/**
 * middleware/memory.ts
 *
 * Memory as a *layer*, not a mode. `withMemoryAugment` wraps any chat adapter
 * so a request flagged `metadata.use_memory === true` gets:
 *
 *   1. recall     — the last user message queries CI-Server ("Companion
 *      Memory"); a non-empty memory block is prepended to the conversation as
 *      a system message.
 *   2. chat       — the inner adapter runs unchanged; every event is re-yielded.
 *   3. write-back — once the inner stream completes with text (and no error
 *      event), the finished turn is POSTed back to CI-Server, fire-and-forget.
 *
 * Recall and write-back reuse the memory adapter's transport conventions
 * (x-api-key auth, defensive `block` / `context` / `results[]` parsing — see
 * adapters/memory.ts) and are strictly best-effort: any failure logs a warning
 * and never blocks or fails the chat.
 */

import type {
  Adapter,
  BackendKind,
  ChatMessage,
  ChatRequest,
  SessionContext,
} from '../adapters/Adapter.ts';
import type { AgentEvent } from '../events.ts';

export interface MemoryAugmentOptions {
  /** CI-Server base URL (direct, e.g. http://<hub>:3030). */
  baseUrl: string;
  /** Memory-scoped CI-Server API key (sent as `x-api-key`). */
  apiKey: string;
  /** Recall path. Default `/memory/recall` (see adapters/memory.ts). */
  recallPath?: string;
  /** Turn write-back path. Default `/memory/turn`. */
  turnPath?: string;
  /** Max memories to recall per query. */
  maxResults?: number;
}

/**
 * Guard for the router: augment only when the request explicitly opts in
 * (`metadata.use_memory === true`, strict boolean), CI-Server is configured,
 * and the selected adapter isn't the memory adapter itself — wrapping recall
 * around recall would be meaningless.
 */
export function wantsMemoryAugment(
  body: ChatRequest,
  ciServerUrl: string,
  adapterKind: BackendKind
): boolean {
  return (
    body.metadata?.['use_memory'] === true &&
    !!ciServerUrl &&
    adapterKind !== 'memory'
  );
}

/**
 * Wrap `adapter` with CI-Server memory recall + turn write-back. The wrapper
 * keeps the inner adapter's `kind` and delegates `approve`/`dispose`, so the
 * router can bind it to a session exactly like the bare adapter.
 */
export function withMemoryAugment(
  adapter: Adapter,
  opts: MemoryAugmentOptions
): Adapter {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const recallUrl = `${base}${opts.recallPath ?? '/memory/recall'}`;
  const turnUrl = `${base}${opts.turnPath ?? '/memory/turn'}`;
  const headers = {
    'x-api-key': opts.apiKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  /** Best-effort recall; returns '' on any failure or empty result. */
  async function recall(query: string, signal: AbortSignal): Promise<string> {
    let res: Response;
    try {
      res = await fetch(recallUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, maxResults: opts.maxResults ?? 5 }),
        signal,
      });
    } catch (e) {
      console.warn(`[memory-augment] recall failed: ${(e as Error).message}`);
      return '';
    }
    if (!res.ok) {
      console.warn(
        `[memory-augment] recall ${res.status}; continuing without memories`
      );
      return '';
    }
    // Same defensive shape handling as adapters/memory.ts.
    const data = (await res.json().catch(() => ({}))) as {
      block?: string;
      context?: string;
      results?: Array<{ text?: string; content?: string; summary?: string }>;
    };
    return (
      data.block ??
      data.context ??
      (Array.isArray(data.results)
        ? data.results
            .map((r) => r.text ?? r.content ?? r.summary ?? '')
            .filter(Boolean)
            .join('\n\n')
        : '')
    );
  }

  /** Fire-and-forget turn write-back; logs failures, never throws. */
  function writeTurn(sessionId: string, user: string, assistant: string): void {
    fetch(turnUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        session_id: sessionId,
        user,
        assistant,
        source: 'ci-glasses',
      }),
    })
      .then((res) => {
        if (!res.ok) {
          console.warn(`[memory-augment] turn write-back ${res.status}`);
        }
      })
      .catch((e) => {
        console.warn(
          `[memory-augment] turn write-back failed: ${(e as Error).message}`
        );
      });
  }

  return {
    kind: adapter.kind,

    async *run(req: ChatRequest, ctx: SessionContext): AsyncIterable<AgentEvent> {
      const lastUser =
        [...req.messages].reverse().find((m) => m.role === 'user')?.content ??
        '';

      // 1. Recall — copy, never mutate the caller's message array.
      let augmented = req;
      if (lastUser.trim()) {
        const block = await recall(lastUser, ctx.signal);
        if (block) {
          const memories: ChatMessage = {
            role: 'system',
            content: `Relevant memories about the user (from Companion Memory):\n${block}`,
          };
          augmented = { ...req, messages: [memories, ...req.messages] };
        }
      }

      // 2. Chat — delegate, re-yield unchanged, accumulate the reply.
      let assistant = '';
      let errored = false;
      for await (const evt of adapter.run(augmented, ctx)) {
        if (evt.type === 'text') assistant += evt.delta;
        else if (evt.type === 'error') errored = true;
        yield evt;
      }

      // 3. Write-back — only a completed turn with actual text is memorable.
      //    Deliberately not tied to ctx.signal: the request may close right
      //    after the stream ends, and the write-back should still land.
      if (!errored && assistant) writeTurn(ctx.sessionId, lastUser, assistant);
    },

    // Delegate the optional surface so permission prompts / cleanup still
    // reach the inner adapter when the router binds the wrapped instance.
    ...(adapter.approve ? { approve: adapter.approve.bind(adapter) } : {}),
    ...(adapter.dispose ? { dispose: adapter.dispose.bind(adapter) } : {}),
  };
}
