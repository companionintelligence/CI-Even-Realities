/**
 * ChatCompletions.ts
 *
 * Handles OpenAI-compatible Chat Completions API (POST /v1/chat/completions).
 * Manages client-side conversation history.
 */

import type { BackendConfig } from '../config/Settings.ts';
import type { AgentEvent } from './AgentEvent.ts';
import { parseSSEEvents } from './StreamParser.ts';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class ChatCompletions {
  private history: Message[] = [];

  constructor(private config: BackendConfig) {}

  updateConfig(config: BackendConfig): void {
    this.config = config;
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

    const response = await fetch(
      `${this.config.baseUrl}/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      }
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
      for await (const evt of parseSSEEvents(response)) {
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
}
