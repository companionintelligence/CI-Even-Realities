/**
 * ApiAdapter.ts
 *
 * Unified adapter layer that speaks both Chat Completions and the Responses API
 * to any OpenAI-compatible backend. Handles auto-detection of supported API shape.
 */

import type { BackendConfig } from '../config/Settings.ts';
import type { AgentEvent } from './AgentEvent.ts';
import { ChatCompletions } from './ChatCompletions.ts';
import { ResponsesApi } from './ResponsesApi.ts';
import { authedFetch, type TokenProvider } from '../auth/TokenProvider.ts';

/**
 * Backend kinds that must route through the agent-hub (which speaks Chat
 * Completions). The Responses API is OpenAI-hosted and incompatible with the
 * hub's custom event surface.
 */
const HUB_ROUTED_KINDS = new Set<BackendConfig['backendKind']>([
  'claude-cli',
  'codex-cli',
  'openclaw',
  'local-llm',
  'hermes',
  'memory',
  'auto',
]);

export class ApiAdapter {
  private chatCompletions: ChatCompletions;
  private responsesApi: ResponsesApi;
  private responsesApiSupported?: boolean;
  /** In-flight probe promise, cached so concurrent callers share one request. */
  private responsesApiProbe?: Promise<boolean>;

  constructor(
    private config: BackendConfig,
    private tokenProvider?: TokenProvider
  ) {
    this.chatCompletions = new ChatCompletions(config, tokenProvider);
    this.responsesApi = new ResponsesApi(config, tokenProvider);
  }

  updateConfig(config: BackendConfig): void {
    this.config = config;
    this.chatCompletions.updateConfig(config);
    this.responsesApi.updateConfig(config);
    // Reset cached capability when URL or mode changes
    this.responsesApiSupported = undefined;
    this.responsesApiProbe = undefined;
  }

  /** Swap the auth strategy (e.g. after sign-in / sign-out). */
  setTokenProvider(provider: TokenProvider | undefined): void {
    this.tokenProvider = provider;
    this.chatCompletions.setTokenProvider(provider);
    this.responsesApi.setTokenProvider(provider);
  }

  clearHistory(): void {
    this.chatCompletions.clearHistory();
    this.responsesApi.clearContext();
  }

  async *sendMessage(userText: string, signal?: AbortSignal): AsyncGenerator<string> {
    for await (const evt of this.sendMessageEvents(userText, signal)) {
      if (evt.type === 'text' && evt.delta) yield evt.delta;
      if (evt.type === 'error') throw new Error(evt.message);
    }
  }

  /**
   * Structured-event variant of {@link sendMessage}. Yields text deltas and
   * any agent_* events (permission prompts, status) emitted by the hub.
   *
   * Hub-routed backend kinds (claude-cli, codex-cli, openclaw, local-llm)
   * always use Chat Completions regardless of the configured API mode — the
   * hub does not speak the Responses API and the custom SSE event surface
   * lives on the chat completions endpoint.
   */
  async *sendMessageEvents(
    userText: string,
    signal?: AbortSignal,
    metadata?: Record<string, unknown>
  ): AsyncGenerator<AgentEvent> {
    const forceCompletions = HUB_ROUTED_KINDS.has(this.config.backendKind);
    const useResponses = forceCompletions
      ? false
      : await this.shouldUseResponsesApi(signal);

    // Throw immediately if the signal was aborted while waiting on the probe.
    signal?.throwIfAborted();

    if (useResponses) {
      yield* this.responsesApi.sendEvents(userText, signal);
    } else {
      const meta = {
        ...(metadata ?? {}),
        agent_kind: this.config.backendKind,
      };
      yield* this.chatCompletions.sendEvents(userText, signal, meta);
    }
  }

  /**
   * Send an approval (or denial) for a `permission_prompt` event to the hub.
   *
   * Returns true if the hub acknowledged the approval. Non-hub backend kinds
   * (`openai`) never emit prompts, so this is a no-op.
   */
  async approvePrompt(
    sessionId: string,
    promptId: string,
    optionId: string,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (!HUB_ROUTED_KINDS.has(this.config.backendKind)) return false;
    const res = await authedFetch(
      this.tokenProvider,
      this.config.apiKey,
      (bearer) =>
        fetch(
          `${this.config.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/approve`,
          {
            method: 'POST',
            headers: {
              ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prompt_id: promptId, option_id: optionId }),
            signal,
          }
        )
    );
    return res.ok;
  }

  /**
   * Cancel the hub's in-flight turn for this session — e.g. the user is
   * about to start a new turn (which would otherwise race the old turn's
   * subprocess/session) or double-tapped to clear the conversation. A
   * dropped client connection no longer cancels a turn on its own (it may
   * reconnect and resume — see {@link sendMessageEvents}), so callers must
   * call this explicitly wherever the app itself decides a turn is done.
   * Best-effort: failures are swallowed since the hub's own inactivity/
   * wall-clock timeouts still bound an abandoned turn's lifetime. Non-hub
   * backend kinds (`openai`) have no server-side turn to cancel.
   */
  async cancelSession(sessionId: string, signal?: AbortSignal): Promise<void> {
    if (!HUB_ROUTED_KINDS.has(this.config.backendKind)) return;
    try {
      await authedFetch(
        this.tokenProvider,
        this.config.apiKey,
        (bearer) =>
          fetch(
            `${this.config.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/cancel`,
            {
              method: 'POST',
              headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
              signal,
            }
          )
      );
    } catch {
      // Best-effort — see doc comment above.
    }
  }

  /**
   * Test whether the configured backend is reachable.
   * Returns an object describing success/failure and which APIs are supported.
   */
  async testConnection(): Promise<{
    reachable: boolean;
    supportsCompletions: boolean;
    supportsResponses: boolean;
    error?: string;
  }> {
    let supportsCompletions = false;
    let supportsResponses = false;
    let error: string | undefined;

    try {
      // Probe Chat Completions
      const completionsRes = await fetch(
        `${this.config.baseUrl}/v1/chat/completions`,
        { method: 'OPTIONS', signal: AbortSignal.timeout(5000) }
      );
      supportsCompletions = completionsRes.ok || completionsRes.status === 405;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    try {
      // Probe Responses API
      const responsesRes = await fetch(
        `${this.config.baseUrl}/v1/responses`,
        { method: 'OPTIONS', signal: AbortSignal.timeout(5000) }
      );
      supportsResponses = responsesRes.ok || responsesRes.status === 405;
    } catch (e) {
      // Surface the responses probe error only when the completions probe
      // did not already set one, so partial failures are visible to the user.
      if (!error) {
        error = e instanceof Error ? e.message : String(e);
      }
    }

    return {
      reachable: supportsCompletions || supportsResponses,
      supportsCompletions,
      supportsResponses,
      error,
    };
  }

  private async shouldUseResponsesApi(signal?: AbortSignal): Promise<boolean> {
    switch (this.config.apiMode) {
      case 'responses':
        return true;
      case 'completions':
        return false;
      case 'auto':
        if (this.responsesApiSupported !== undefined) {
          return this.responsesApiSupported;
        }
        // Short-circuit if the caller already aborted before the probe starts.
        signal?.throwIfAborted();
        // Cache the in-flight promise so that concurrent callers all await the
        // same OPTIONS probe instead of each launching a redundant request.
        // If the probe rejects (e.g. aborted or network error), clear the cache
        // so the next call can start a fresh probe.
        if (!this.responsesApiProbe) {
          this.responsesApiProbe = this.probeResponsesApi(signal).then(
            (result) => {
              this.responsesApiSupported = result;
              return result;
            },
            (err: unknown) => {
              // Clear the cached probe so a subsequent caller can retry.
              this.responsesApiProbe = undefined;
              throw err;
            }
          );
        }
        return this.responsesApiProbe;
    }
  }

  private async probeResponsesApi(signal?: AbortSignal): Promise<boolean> {
    try {
      // Combine the caller's AbortSignal with an internal timeout so the probe
      // is cancelled immediately when the user aborts (e.g. double-tap to
      // clear), rather than waiting for the full 3-second timeout to expire.
      const timeout = AbortSignal.timeout(3000);
      const combinedSignal =
        signal
          ? AbortSignal.any([signal, timeout])
          : timeout;
      const res = await fetch(`${this.config.baseUrl}/v1/responses`, {
        method: 'OPTIONS',
        signal: combinedSignal,
      });
      return res.ok || res.status === 405;
    } catch (e) {
      // Re-throw AbortErrors so the caller can distinguish a user-initiated
      // cancellation from a plain network failure.
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      return false;
    }
  }
}
