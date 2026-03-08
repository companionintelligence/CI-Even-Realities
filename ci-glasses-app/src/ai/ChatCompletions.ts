/**
 * ChatCompletions.ts
 *
 * Handles OpenAI-compatible Chat Completions API (POST /v1/chat/completions).
 * Manages client-side conversation history.
 */

import type { BackendConfig } from '../config/Settings.ts';
import { parseSSEStream } from './StreamParser.ts';

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

  async *send(userText: string, signal?: AbortSignal): AsyncGenerator<string> {
    // Push user message after confirming the request succeeds so that a
    // network or API error does not leave an orphaned message in history
    // that would corrupt the conversation context on the next call.
    const userMessage: Message = { role: 'user', content: userText };

    const messages: Message[] = [
      { role: 'system', content: this.config.systemPrompt },
      ...this.history,
      userMessage,
    ];

    const response = await fetch(
      `${this.config.baseUrl}/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          stream: this.config.streaming,
        }),
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

    if (this.config.streaming) {
      let assistantContent = '';
      for await (const chunk of parseSSEStream(response)) {
        assistantContent += chunk;
        yield chunk;
      }
      this.history.push({ role: 'assistant', content: assistantContent });
    } else {
      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
      };
      const content = data.choices[0]?.message?.content ?? '';
      this.history.push({ role: 'assistant', content });
      yield content;
    }

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
