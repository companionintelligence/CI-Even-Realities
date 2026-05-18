/**
 * openclaw.ts
 *
 * Adapter that forwards a chat-completions request to an OpenClaw Gateway.
 * Inspired by the dAAAb Cloudflare-Worker bridge but Node-resident so it
 * runs on the same hub as the other adapters — no external dependency.
 *
 * The Gateway speaks an OpenAI-compatible chat-completions endpoint, so the
 * translation is mostly: re-emit text deltas, strip code blocks / URLs that
 * the monochrome HUD can't render usefully, and surface tool-call activity as
 * `agent_status`. Permission prompts are not yet part of the Gateway's wire
 * — the adapter does not implement `approve()`.
 */

import type { Adapter, ChatRequest, SessionContext } from './Adapter.ts';
import type { AgentEvent } from '../events.ts';

export interface OpenClawOptions {
  gatewayUrl: string;
  token: string;
}

export class OpenClawAdapter implements Adapter {
  readonly kind = 'openclaw' as const;

  constructor(private opts: OpenClawOptions) {}

  async *run(req: ChatRequest, ctx: SessionContext): AsyncIterable<AgentEvent> {
    if (!this.opts.gatewayUrl) {
      yield {
        type: 'error',
        message: 'openclaw: OPENCLAW_GATEWAY_URL not configured',
      };
      return;
    }

    yield { type: 'agent_status', kind: 'thinking' };

    const res = await fetch(this.opts.gatewayUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.opts.token}`,
        'Content-Type': 'application/json',
      },
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
        message: `openclaw ${res.status}: ${text.slice(0, 200)}`,
      };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let toolBannerSeen = false;
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
              choices?: Array<{ delta?: { content?: string; tool_calls?: unknown } }>;
            };
            const ch = parsed.choices?.[0];
            const delta = ch?.delta?.content;
            if (!toolBannerSeen && ch?.delta?.tool_calls) {
              toolBannerSeen = true;
              yield {
                type: 'agent_status',
                kind: 'executing',
                label: 'tool',
              };
            }
            if (typeof delta === 'string' && delta.length > 0) {
              const stripped = stripForGlasses(delta);
              if (stripped) yield { type: 'text', delta: stripped };
            }
          } catch {
            // skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    yield { type: 'agent_status', kind: 'done' };
  }
}

/**
 * Light cleaning to keep the monochrome HUD readable: drop fenced code
 * blocks (they look terrible on a 488px green-on-black display) and trim
 * obvious markdown link clutter `[text](url)` to just `text`.
 *
 * Deliberately conservative — over-stripping would mangle short answers.
 */
function stripForGlasses(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]+\)/g, '$1');
}
