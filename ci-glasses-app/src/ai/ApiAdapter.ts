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
  }

  clearHistory(): void {
    this.chatCompletions.clearHistory();
    this.responsesApi.clearContext();
  }

  async *sendMessage(userText: string): AsyncGenerator<string> {
    const useResponses = await this.shouldUseResponsesApi();

    if (useResponses) {
      yield* this.responsesApi.send(userText);
    } else {
      yield* this.chatCompletions.send(userText);
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
    } catch {
      // Responses API not available
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
        if (this.responsesApiSupported === undefined) {
          this.responsesApiSupported = await this.probeResponsesApi();
        }
        return this.responsesApiSupported;
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
