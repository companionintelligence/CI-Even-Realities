/**
 * ChatCompletions.ts
 *
 * Handles OpenAI-compatible Chat Completions API (POST /v1/chat/completions).
 * Manages client-side conversation history.
 */

import type { BackendConfig } from '../config/Settings.ts';
import type { AgentEvent } from './AgentEvent.ts';
import { parseSSEEvents } from './StreamParser.ts';
import { authedFetch, type TokenProvider } from '../auth/TokenProvider.ts';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Backoff schedule between reconnect attempts, in ms; last value repeats. */
const RECONNECT_BACKOFF_MS = [500, 1500, 3000];
const MAX_RECONNECTS = RECONNECT_BACKOFF_MS.length;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ChatCompletions {
  private history: Message[] = [];

  constructor(
    private config: BackendConfig,
    private tokenProvider?: TokenProvider
  ) {}

  updateConfig(config: BackendConfig): void {
    this.config = config;
  }

  setTokenProvider(provider: TokenProvider | undefined): void {
    this.tokenProvider = provider;
  }

  clearHistory(): void {
    this.history = [];
  }

  getHistory(): ReadonlyArray<Message> {
    return this.history;
  }

  /**
   * Backwards-compatible text-only generator. Equivalent to filtering
   * `sendEvents` to text deltas; preserved so existing callers that only
   * care about text continue to work.
   */
  async *send(userText: string, signal?: AbortSignal): AsyncGenerator<string> {
    for await (const evt of this.sendEvents(userText, signal)) {
      if (evt.type === 'text' && evt.delta) yield evt.delta;
      if (evt.type === 'error') throw new Error(evt.message);
    }
  }

  /**
   * Structured event generator. Yields text deltas plus any agent_* events
   * the backend hub emits (permission prompts, status changes, etc.).
   */
  async *sendEvents(
    userText: string,
    signal?: AbortSignal,
    metadata?: Record<string, unknown>
  ): AsyncGenerator<AgentEvent> {
    // Push user message after confirming the request succeeds so that a
    // network or API error does not leave an orphaned message in history
    // that would corrupt the conversation context on the next call.
    const userMessage: Message = { role: 'user', content: userText };

    const messages: Message[] = [
      { role: 'system', content: this.config.systemPrompt },
      ...this.history,
      userMessage,
    ];

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      stream: this.config.streaming,
    };
    if (metadata) body['metadata'] = metadata;

    const response = await authedFetch(
      this.tokenProvider,
      this.config.apiKey,
      (bearer) =>
        fetch(`${this.config.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal,
        })
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(
        `Chat Completions error ${response.status}: ${errText}`
      );
    }

    // Request succeeded — commit the user message to history.
    this.history.push(userMessage);

    let assistantContent = '';
    if (this.config.streaming) {
      const sessionId =
        typeof metadata?.['session_id'] === 'string'
          ? (metadata['session_id'] as string)
          : undefined;
      for await (const evt of this.streamWithResume(response, sessionId, signal)) {
        if (evt.type === 'text') assistantContent += evt.delta;
        yield evt;
      }
    } else {
      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
      };
      assistantContent = data.choices[0]?.message?.content ?? '';
      if (assistantContent) yield { type: 'text', delta: assistantContent };
    }

    this.history.push({ role: 'assistant', content: assistantContent });

    // Trim history to stay within the configured budget. Keep an even number
    // of entries so that user/assistant turns stay paired. Oldest messages
    // are dropped first (slice from the end).
    const configuredMax = this.config.maxHistoryMessages;
    const max =
      configuredMax <= 0
        ? 0
        : configuredMax % 2 === 0
          ? configuredMax
          : configuredMax - 1;
    if (this.history.length > max) {
      this.history = this.history.slice(this.history.length - max);
    }
  }

  /**
   * Consume an SSE response, reconnecting through the agent-hub's resume
   * endpoint if the connection drops (or ends without `[DONE]`) mid-turn —
   * so a dropped wifi link or a backgrounded WebView loses at most a few
   * seconds of text instead of the whole in-flight answer. Only attempted
   * when a `sessionId` is available (hub-routed traffic); a deliberate
   * abort via `signal` is never retried. Plain OpenAI backends don't expose
   * a resume endpoint, so a reconnect attempt there just 404s once and the
   * original error surfaces — no special-casing needed.
   */
  private async *streamWithResume(
    initialResponse: Response,
    sessionId: string | undefined,
    signal: AbortSignal | undefined
  ): AsyncGenerator<AgentEvent> {
    let response: Response | null = initialResponse;
    let cursor = -1;
    let attempt = 0;

    while (response) {
      try {
        const gen = parseSSEEvents(response);
        let sawDone = false;
        while (true) {
          const next = await gen.next();
          if (next.done) {
            sawDone = next.value === true;
            break;
          }
          cursor++;
          yield next.value;
        }
        if (sawDone) return;
        throw new Error('SSE stream ended before [DONE]');
      } catch (e) {
        if (signal?.aborted) throw e;
        if (!sessionId || attempt >= MAX_RECONNECTS) throw e;
        await sleep(
          RECONNECT_BACKOFF_MS[attempt] ??
            RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1]!
        );
        attempt++;
        response = await this.reconnectStream(sessionId, cursor, signal);
        if (!response) throw e;
      }
    }
  }

  private async reconnectStream(
    sessionId: string,
    after: number,
    signal?: AbortSignal
  ): Promise<Response | null> {
    try {
      const res = await authedFetch(
        this.tokenProvider,
        this.config.apiKey,
        (bearer) =>
          fetch(
            `${this.config.baseUrl}/v1/chat/completions/stream?session_id=${encodeURIComponent(sessionId)}&after=${after}`,
            {
              headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
              signal,
            }
          )
      );
      return res.ok ? res : null;
    } catch {
      return null;
    }
  }
}
