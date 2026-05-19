/**
 * StreamParser.ts
 *
 * Parses Server-Sent Events (SSE) streams from both OpenAI Chat Completions
 * and the Responses API, yielding text chunks as they arrive.
 *
 * Also parses the agent-hub's extended SSE protocol — `event:` lines for
 * `agent_status` and `permission_prompt` — into structured `AgentEvent`s.
 * See `architecture.md` §3 for the wire contract.
 */

import type { AgentEvent } from './AgentEvent.ts';

/**
 * Parse an SSE stream response and yield text delta chunks.
 * Compatible with:
 *  - Chat Completions: choices[0].delta.content
 *  - Responses API:    delta.text  or  output_text increments
 */
export async function* parseSSEStream(
  response: Response
): AsyncGenerator<string> {
  for await (const evt of parseSSEEvents(response)) {
    if (evt.type === 'text' && evt.delta) yield evt.delta;
  }
}

/**
 * Parse an SSE stream and yield structured `AgentEvent`s.
 *
 * Recognises three SSE event flavours:
 *  - default (no `event:` line, or `event: message`) — OpenAI text delta
 *  - `event: agent_status`     — emits `{ type: 'agent_status', ... }`
 *  - `event: permission_prompt`— emits `{ type: 'permission_prompt', ... }`
 *
 * Unknown event types are silently skipped so the parser is forward-compatible
 * with future hub additions.
 */
export async function* parseSSEEvents(
  response: Response
): AsyncGenerator<AgentEvent> {
  if (!response.body) {
    throw new Error('Response body is null');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  /** Event name carried over until a blank-line delimiter resets it. */
  let pendingEventName: string | null = null;

  /** Set when a `data: [DONE]` is seen; outer loop terminates next iteration. */
  let streamFinished = false;

  function* dispatch(
    eventName: string | null,
    dataLine: string
  ): Generator<AgentEvent> {
    if (dataLine === '[DONE]') {
      streamFinished = true;
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(dataLine);
    } catch {
      return;
    }

    const name = eventName ?? 'message';
    // OpenAI Responses API streaming uses named events like
    // `response.output_text.delta` instead of the default `message` event.
    // Treat any name that *looks like* a text-delta event as text, plus
    // anything we don't otherwise recognise but that contains a text
    // payload — recoverable forward-compat for downstream gateways.
    if (
      name === 'message' ||
      name === 'response.output_text.delta' ||
      name === 'response.output_text.done' ||
      name === 'response.text.delta'
    ) {
      const delta = extractContent(parsed);
      if (delta) yield { type: 'text', delta };
      return;
    }
    if (name === 'agent_status') {
      const evt = parseAgentStatus(parsed);
      if (evt) yield evt;
      return;
    }
    if (name === 'permission_prompt') {
      const evt = parsePermissionPrompt(parsed);
      if (evt) yield evt;
      return;
    }
    if (name === 'error') {
      const msg =
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as Record<string, unknown>)['message'] === 'string'
          ? ((parsed as Record<string, unknown>)['message'] as string)
          : 'agent error';
      yield { type: 'error', message: msg };
      return;
    }
    // Unknown event — ignore.
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      // SSE-spec line terminators: \r\n, \r, or \n. Check \r\n first.
      const lines = buffer.split(/\r\n|\r|\n/);
      // Keep the last (potentially incomplete) line in the buffer.
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        // Blank line = end of one SSE event; reset the carried event name.
        if (line === '') {
          pendingEventName = null;
          continue;
        }
        if (line.startsWith('event:')) {
          pendingEventName = line.slice(6).trim();
          continue;
        }
        if (line.startsWith('data:')) {
          // Allow `data:` or `data: …` per the SSE spec.
          const data = line.startsWith('data: ') ? line.slice(6) : line.slice(5);
          yield* dispatch(pendingEventName, data.trimStart());
          if (streamFinished) return;
        }
        // Other field lines (id:, retry:, comments starting with `:`) are ignored.
      }
      if (streamFinished) return;
    }

    // Flush any final buffered data line (no trailing newline).
    if (buffer.startsWith('data:')) {
      const data = (buffer.startsWith('data: ')
        ? buffer.slice(6)
        : buffer.slice(5)
      ).trim();
      if (data) yield* dispatch(pendingEventName, data);
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Extract text content from a parsed default-event SSE data object.
 * Handles both Chat Completions and Responses API shapes.
 */
function extractContent(parsed: unknown): string {
  if (typeof parsed !== 'object' || parsed === null) return '';

  const obj = parsed as Record<string, unknown>;

  // Chat Completions: { choices: [{ delta: { content: "..." } }] }
  const choices = obj['choices'];
  if (Array.isArray(choices) && choices.length > 0) {
    const delta = (choices[0] as Record<string, unknown>)['delta'];
    if (typeof delta === 'object' && delta !== null) {
      const content = (delta as Record<string, unknown>)['content'];
      if (typeof content === 'string') return content;
    }
  }

  // Responses API streaming: { delta: { text: "..." } }
  const delta = obj['delta'];
  if (typeof delta === 'object' && delta !== null) {
    const text = (delta as Record<string, unknown>)['text'];
    if (typeof text === 'string') return text;
  }

  // Fallback: some proxy implementations send delta as a plain string
  if (typeof delta === 'string') return delta;

  return '';
}

function parseAgentStatus(parsed: unknown): AgentEvent | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const kind = obj['kind'];
  if (
    kind !== 'thinking' &&
    kind !== 'executing' &&
    kind !== 'awaiting_input' &&
    kind !== 'done'
  ) {
    return null;
  }
  const label = typeof obj['label'] === 'string' ? (obj['label'] as string) : undefined;
  return { type: 'agent_status', kind, label };
}

function parsePermissionPrompt(parsed: unknown): AgentEvent | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const id = obj['id'];
  const tool = obj['tool'];
  const summary = obj['summary'];
  if (typeof id !== 'string' || typeof tool !== 'string' || typeof summary !== 'string') {
    return null;
  }
  const optsRaw = obj['options'];
  const options =
    Array.isArray(optsRaw)
      ? optsRaw
          .filter(
            (o): o is { id: string; label: string } =>
              typeof o === 'object' &&
              o !== null &&
              typeof (o as Record<string, unknown>)['id'] === 'string' &&
              typeof (o as Record<string, unknown>)['label'] === 'string'
          )
          .map((o) => ({ id: o.id, label: o.label }))
      : [
          { id: 'approve', label: 'Approve' },
          { id: 'deny', label: 'Deny' },
        ];
  return { type: 'permission_prompt', id, tool, summary, options };
}
