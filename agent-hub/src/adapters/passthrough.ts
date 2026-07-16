/**
 * passthrough.ts
 *
 * Adapter for any OpenAI-compatible HTTP backend — OpenAI itself, Ollama,
 * vLLM, llama.cpp's server, LM Studio, etc. Forwards the request unchanged
 * and re-emits text deltas as AgentEvents.
 *
 * No `permission_prompt` events are produced — these backends do not have
 * tool-calling with interactive approval. Token-streaming `agent_status`
 * (`thinking` -> `done`) is emitted as a convenience so the HUD stays lively.
 */

import type { Adapter, BackendKind, ChatRequest, SessionContext } from './Adapter.ts';
import type { AgentEvent } from '../events.ts';

export interface PassthroughOptions {
  baseUrl: string;
  apiKey?: string;
  /**
   * Adapter kind. Any OpenAI-compatible target uses this adapter — `openai`,
   * `local-llm` (Ollama/vLLM), and `hermes` (the Hermes gateway is OpenAI-shaped).
   */
  kind?: BackendKind;
}

export class PassthroughAdapter implements Adapter {
  readonly kind: BackendKind;

  constructor(private opts: PassthroughOptions) {
    this.kind = opts.kind ?? 'openai';
  }

  async *run(req: ChatRequest, ctx: SessionContext): AsyncIterable<AgentEvent> {
    yield { type: 'agent_status', kind: 'thinking' };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.opts.apiKey) headers['Authorization'] = `Bearer ${this.opts.apiKey}`;

    const res = await fetch(`${this.opts.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: true,
      }),
      signal: ctx.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      yield {
        type: 'error',
        message: `passthrough ${res.status}: ${text.slice(0, 200)}`,
      };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r\n|\r|\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.startsWith('data: ')
            ? trimmed.slice(6)
            : trimmed.slice(5);
          if (data === '[DONE]') {
            yield { type: 'agent_status', kind: 'done' };
            return;
          }
          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) {
              yield { type: 'text', delta };
            }
          } catch {
            // Skip malformed chunks — match the glasses-app parser.
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    yield { type: 'agent_status', kind: 'done' };
  }
}
