/**
 * ApiAdapter.ts
 *
 * Unified adapter layer that speaks both Chat Completions and the Responses API
 * to any OpenAI-compatible backend. Handles auto-detection of supported API shape.
 */

import type { BackendConfig } from '../config/Settings.ts';
import { ChatCompletions } from './ChatCompletions.ts';
import { ResponsesApi } from './ResponsesApi.ts';

export class ApiAdapter {
  private chatCompletions: ChatCompletions;
  private responsesApi: ResponsesApi;
  private responsesApiSupported?: boolean;
  /** In-flight probe promise, cached so concurrent callers share one request. */
  private responsesApiProbe?: Promise<boolean>;

  constructor(private config: BackendConfig) {
    this.chatCompletions = new ChatCompletions(config);
    this.responsesApi = new ResponsesApi(config);
  }

  updateConfig(config: BackendConfig): void {
    this.config = config;
    this.chatCompletions.updateConfig(config);
    this.responsesApi.updateConfig(config);
    // Reset cached capability when URL or mode changes
    this.responsesApiSupported = undefined;
    this.responsesApiProbe = undefined;
  }

  clearHistory(): void {
    this.chatCompletions.clearHistory();
    this.responsesApi.clearContext();
  }

  async *sendMessage(userText: string, signal?: AbortSignal): AsyncGenerator<string> {
    const useResponses = await this.shouldUseResponsesApi(signal);

    // Throw immediately if the signal was aborted while waiting on the probe.
    signal?.throwIfAborted();

    if (useResponses) {
      yield* this.responsesApi.send(userText, signal);
    } else {
      yield* this.chatCompletions.send(userText, signal);
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
