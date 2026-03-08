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
    const useResponses = await this.shouldUseResponsesApi();

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

  private async shouldUseResponsesApi(): Promise<boolean> {
    switch (this.config.apiMode) {
      case 'responses':
        return true;
      case 'completions':
        return false;
      case 'auto':
        if (this.responsesApiSupported !== undefined) {
          return this.responsesApiSupported;
        }
        // Cache the in-flight promise so that concurrent callers all await the
        // same OPTIONS probe instead of each launching a redundant request.
        if (!this.responsesApiProbe) {
          this.responsesApiProbe = this.probeResponsesApi().then((result) => {
            this.responsesApiSupported = result;
            return result;
          });
        }
        return this.responsesApiProbe;
    }
  }

  private async probeResponsesApi(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.baseUrl}/v1/responses`, {
        method: 'OPTIONS',
        signal: AbortSignal.timeout(3000),
      });
      return res.ok || res.status === 405;
    } catch {
      return false;
    }
  }
}
