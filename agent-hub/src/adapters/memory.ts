/**
 * memory.ts
 *
 * Adapter that "exercises" CI-Server ("Companion Memory") from the glasses.
 * Unlike the chat adapters, CI-Server memory is a bespoke REST surface, not an
 * OpenAI-compatible endpoint, and `/memory/*` is API-key-gated (it rejects the
 * glasses' Portal JWT). So agent-hub brokers it with a memory-scoped CI-Server
 * API key held server-side (`CI_SERVER_API_KEY`), never shipped to the WebView.
 *
 * On a turn, the last user message is used as the recall query; the returned
 * memory block is streamed straight back as text for the HUD. Response shape is
 * parsed defensively (`block` / `context` / `results[]`) so it tolerates minor
 * CI-Server surface drift.
 */

import type { Adapter, ChatRequest, SessionContext } from './Adapter.ts';
import type { AgentEvent } from '../events.ts';
import { fetchWithTimeout } from '../fetchWithTimeout.ts';

const DEFAULT_TIMEOUT_MS = 8_000;

export interface MemoryOptions {
  /** CI-Server base URL (direct, e.g. http://<hub>:3030). */
  baseUrl: string;
  /** Memory-scoped CI-Server API key (sent as `x-api-key`). */
  apiKey: string;
  /**
   * Recall path. Default `/memory/recall` (CI-Server direct — no global `/api`
   * prefix). Set to `/api/memory/recall` when fronting via the Hub/Traefik
   * proxy, which strips `/api` before reaching CI-Server.
   */
  recallPath?: string;
  /** Max memories to recall per query. */
  maxResults?: number;
  /** Abort the recall call after this long (ms). Default 8000. */
  timeoutMs?: number;
}

export class MemoryAdapter implements Adapter {
  readonly kind = 'memory' as const;

  constructor(private opts: MemoryOptions) {}

  async *run(req: ChatRequest, ctx: SessionContext): AsyncIterable<AgentEvent> {
    if (!this.opts.baseUrl) {
      yield { type: 'error', message: 'memory: CI_SERVER_URL not configured' };
      return;
    }
    const query =
      [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    if (!query.trim()) {
      yield { type: 'error', message: 'memory: empty query' };
      return;
    }

    yield { type: 'agent_status', kind: 'thinking', label: 'recalling' };

    const path = this.opts.recallPath ?? '/memory/recall';
    const url = `${this.opts.baseUrl.replace(/\/+$/, '')}${path}`;
    let res: Response;
    try {
      res = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: {
            'x-api-key': this.opts.apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            query,
            maxResults: this.opts.maxResults ?? 5,
          }),
        },
        this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ctx.signal
      );
    } catch (e) {
      yield { type: 'error', message: `memory: ${(e as Error).message}` };
      return;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      yield {
        type: 'error',
        message: `memory ${res.status}: ${text.slice(0, 160)}`,
      };
      return;
    }

    const data = (await res.json().catch(() => ({}))) as {
      block?: string;
      context?: string;
      resultCount?: number;
      results?: Array<{ text?: string; content?: string; summary?: string }>;
    };
    const block =
      data.block ??
      data.context ??
      (Array.isArray(data.results)
        ? data.results
            .map((r) => r.text ?? r.content ?? r.summary ?? '')
            .filter(Boolean)
            .join('\n\n')
        : '');
    const count = data.resultCount ?? data.results?.length ?? 0;

    yield {
      type: 'text',
      delta: block || `No memories found for "${query}".`,
    };
    yield { type: 'agent_status', kind: 'done', label: `${count} recalled` };
  }
}
