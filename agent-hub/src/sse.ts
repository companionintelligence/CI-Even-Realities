/**
 * sse.ts
 *
 * Helpers for serialising AgentEvents to the OpenAI-compatible SSE wire
 * format used by the glasses app.
 */

import type { ServerResponse } from 'node:http';
import type { AgentEvent } from './events.ts';

/** Send standard SSE headers + flush. */
export function writeSSEHead(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Disable proxy buffering (nginx, etc).
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
}

/**
 * Serialise an AgentEvent to an SSE frame. Text events emit a default
 * (event-less) chat-completions chunk; structured events use named SSE events
 * so the glasses-app StreamParser can dispatch on them.
 */
export function writeAgentEvent(
  res: ServerResponse,
  evt: AgentEvent,
  model: string
): void {
  switch (evt.type) {
    case 'text': {
      const chunk = {
        id: 'chatcmpl-stream',
        object: 'chat.completion.chunk',
        model,
        choices: [{ index: 0, delta: { content: evt.delta }, finish_reason: null }],
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      return;
    }
    case 'agent_status': {
      res.write(`event: agent_status\n`);
      res.write(`data: ${JSON.stringify({ kind: evt.kind, label: evt.label })}\n\n`);
      return;
    }
    case 'permission_prompt': {
      res.write(`event: permission_prompt\n`);
      res.write(
        `data: ${JSON.stringify({
          id: evt.id,
          tool: evt.tool,
          summary: evt.summary,
          options: evt.options,
        })}\n\n`
      );
      return;
    }
    case 'error': {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ message: evt.message })}\n\n`);
      return;
    }
  }
}

/** Terminate the stream with `[DONE]` and close. */
export function writeDone(res: ServerResponse): void {
  res.write('data: [DONE]\n\n');
  res.end();
}
