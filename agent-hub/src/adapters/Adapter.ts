/**
 * Adapter.ts
 *
 * Contract every backend adapter implements. Adapters translate a Chat-
 * Completions-shaped request into a stream of `AgentEvent`s.
 */

import type { AgentEvent } from '../events.ts';

export type BackendKind =
  | 'openai'
  | 'local-llm'
  | 'claude-cli'
  | 'codex-cli'
  | 'openclaw'
  | 'hermes'
  | 'memory'
  /**
   * Virtual kind: the router resolves it per-request by classifying the last
   * user message (see routing/intent.ts). Never registered as an adapter.
   */
  | 'auto';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  /** Optional metadata block forwarded by the glasses app. */
  metadata?: Record<string, unknown>;
}

export interface SessionContext {
  /** Stable id for this conversation; used to correlate approvals. */
  sessionId: string;
  /**
   * Abort signal for this turn. Fires on an explicit cancel
   * (`POST /v1/sessions/:id/cancel`) or when a new turn supersedes this one
   * on the same session — NOT merely when the originating HTTP connection
   * closes, since a dropped connection can reconnect and resume via
   * `GET /v1/chat/completions/stream` (see streamBuffer.ts). A turn that
   * outlives its original response is expected to keep running.
   */
  signal: AbortSignal;
}

export interface Adapter {
  readonly kind: BackendKind;

  /**
   * Execute one user turn. The returned async iterable should yield events as
   * they arrive (text deltas, status, prompts). It must terminate on its own
   * once the turn is complete or `ctx.signal` fires.
   */
  run(req: ChatRequest, ctx: SessionContext): AsyncIterable<AgentEvent>;

  /**
   * Resolve an outstanding permission prompt. Only adapters that surface
   * prompts implement this; the router validates the prompt id belongs to the
   * given session before calling.
   */
  approve?(sessionId: string, promptId: string, optionId: string): Promise<boolean>;

  /** Optional cleanup hook called when the session is dropped. */
  dispose?(sessionId: string): Promise<void>;
}
