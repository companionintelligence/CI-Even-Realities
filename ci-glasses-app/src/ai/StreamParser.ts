/**
 * StreamParser.ts
 *
 * Parses Server-Sent Events (SSE) streams from both OpenAI Chat Completions
 * and the Responses API, yielding text chunks as they arrive.
 */

/**
 * Parse an SSE stream response and yield text delta chunks.
 * Compatible with:
 *  - Chat Completions: choices[0].delta.content
 *  - Responses API:    delta.text  or  output_text increments
 */
export async function* parseSSEStream(
  response: Response
): AsyncGenerator<string> {
  if (!response.body) {
    throw new Error('Response body is null');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trimEnd();
        if (!trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed: unknown = JSON.parse(data);
          const content = extractContent(parsed);
          if (content) yield content;
        } catch {
          // Skip malformed JSON chunks
        }
      }
    }

    // Flush any remaining data
    if (buffer.startsWith('data: ')) {
      const data = buffer.slice(6).trim();
      if (data && data !== '[DONE]') {
        try {
          const parsed: unknown = JSON.parse(data);
          const content = extractContent(parsed);
          if (content) yield content;
        } catch {
          // Ignore
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Extract text content from a parsed SSE data object.
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
