/**
 * ResponsesApi.ts
 *
 * Handles the OpenAI Responses API (POST /v1/responses).
 * Supports server-side conversation context via previous_response_id.
 */

import type { BackendConfig } from '../config/Settings.ts';
import type { AgentEvent } from './AgentEvent.ts';
import { parseSSEStream } from './StreamParser.ts';
import { authedFetch, type TokenProvider } from '../auth/TokenProvider.ts';

export class ResponsesApi {
  private previousResponseId?: string;

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

  clearContext(): void {
    this.previousResponseId = undefined;
  }

  async *send(userText: string, signal?: AbortSignal): AsyncGenerator<string> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      input: userText,
      instructions: this.config.systemPrompt,
      stream: this.config.streaming,
    };

    if (this.config.storeContext) {
      body['store'] = true;
      if (this.previousResponseId) {
        body['previous_response_id'] = this.previousResponseId;
      }
    }

    const response = await authedFetch(
      this.tokenProvider,
      this.config.apiKey,
      (bearer) =>
        fetch(`${this.config.baseUrl}/v1/responses`, {
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
      throw new Error(`Responses API error ${response.status}: ${errText}`);
    }

    if (this.config.streaming) {
      yield* parseSSEStream(response);
      // Note: response ID for server-side context is not available in streaming
      // mode from the SSE events alone. When store: true, the server tracks it.
    } else {
      const data = await response.json() as {
        id?: string;
        output_text?: string;
      };
      if (data.id) {
        this.previousResponseId = data.id;
      }
      yield data.output_text ?? '';
    }
  }

  /**
   * Structured-event wrapper for symmetry with ChatCompletions.sendEvents.
   * The OpenAI Responses API does not emit agent_* events itself, so this is
   * just a text→event lift; the hub never routes Responses-shape traffic.
   */
  async *sendEvents(
    userText: string,
    signal?: AbortSignal
  ): AsyncGenerator<AgentEvent> {
    for await (const delta of this.send(userText, signal)) {
      if (delta) yield { type: 'text', delta };
    }
  }
}
