/**
 * ResponsesApi.ts
 *
 * Handles the OpenAI Responses API (POST /v1/responses).
 * Supports server-side conversation context via previous_response_id.
 */

import type { BackendConfig } from '../config/Settings.ts';
import { parseSSEStream } from './StreamParser.ts';

export class ResponsesApi {
  private previousResponseId?: string;

  constructor(private config: BackendConfig) {}

  updateConfig(config: BackendConfig): void {
    this.config = config;
  }

  clearContext(): void {
    this.previousResponseId = undefined;
  }

  async *send(userText: string): AsyncGenerator<string> {
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

    const response = await fetch(`${this.config.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

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
}
