/**
 * ResponsesApi.ts
 *
 * Handles the OpenAI Responses API (POST /v1/responses).
 * Supports server-side conversation context via previous_response_id.
 */

import type { BackendConfig } from '../config/Settings.ts';
import type { AgentEvent } from './AgentEvent.ts';
import { parseSSEEvents } from './StreamParser.ts';
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
    let response = await this.postResponse(userText, signal);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      // Server-side context can expire (e.g. it aged out); if this looks
      // like that, drop it and retry once as a fresh turn instead of
      // surfacing a raw API error the user can't do anything about.
      if (this.isExpiredContextError(response.status, errText) && this.previousResponseId) {
        this.previousResponseId = undefined;
        response = await this.postResponse(userText, signal);
        if (!response.ok) {
          const retryErrText = await response.text().catch(() => '');
          throw new Error(`Responses API error ${response.status}: ${retryErrText}`);
        }
      } else {
        throw new Error(`Responses API error ${response.status}: ${errText}`);
      }
    }

    if (this.config.streaming) {
      for await (const evt of parseSSEEvents(response)) {
        if (evt.type === 'text' && evt.delta) yield evt.delta;
        else if (evt.type === 'response_id') this.previousResponseId = evt.id;
      }
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

  private async postResponse(userText: string, signal?: AbortSignal): Promise<Response> {
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

    return authedFetch(
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
  }

  /**
   * Heuristically detect an expired/unknown `previous_response_id` from
   * OpenAI's Responses API. There's no dedicated error code for this — it
   * surfaces as a 400 (or 404) whose message names the response id — so we
   * match on the wording OpenAI uses rather than a structured field.
   */
  private isExpiredContextError(status: number, body: string): boolean {
    if (status !== 400 && status !== 404) return false;
    return /previous_response_id|previous response/i.test(body);
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
