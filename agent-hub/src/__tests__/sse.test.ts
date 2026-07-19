import { describe, it, expect, vi } from 'vitest';
import { writeSSEHead, writeAgentEvent, writeDone } from '../sse.ts';
import type { ServerResponse } from 'node:http';
import type { AgentEvent } from '../events.ts';

/** Minimal fake ServerResponse that records write()/end()/writeHead() calls. */
function fakeResponse() {
  const writes: string[] = [];
  const res = {
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => {
      writes.push(chunk);
      return true;
    }),
    end: vi.fn(),
  };
  return { res: res as unknown as ServerResponse, writes };
}

describe('writeSSEHead', () => {
  it('writes standard SSE headers and flushes them', () => {
    const { res } = fakeResponse();
    writeSSEHead(res);
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    expect((res as any).flushHeaders).toHaveBeenCalled();
  });

  it('does not throw when flushHeaders is unavailable (older Node http)', () => {
    const { res } = fakeResponse();
    delete (res as any).flushHeaders;
    expect(() => writeSSEHead(res)).not.toThrow();
  });
});

describe('writeAgentEvent', () => {
  it('writes a text event as a default (event-less) chat-completions chunk', () => {
    const { res, writes } = fakeResponse();
    writeAgentEvent(res, { type: 'text', delta: 'hello' }, 'gpt-test');
    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toContain('event:');
    expect(writes[0]).toMatch(/^data: /);
    const parsed = JSON.parse(writes[0]!.slice('data: '.length).trim());
    expect(parsed).toMatchObject({
      object: 'chat.completion.chunk',
      model: 'gpt-test',
      choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: null }],
    });
  });

  it('writes an agent_status event as a named SSE event with kind + label', () => {
    const { res, writes } = fakeResponse();
    writeAgentEvent(res, { type: 'agent_status', kind: 'thinking', label: 'recalling' }, 'm');
    expect(writes[0]).toBe('event: agent_status\n');
    const data = JSON.parse(writes[1]!.slice('data: '.length).trim());
    expect(data).toEqual({ kind: 'thinking', label: 'recalling' });
  });

  it('writes an agent_status event with label undefined when none is given', () => {
    const { res, writes } = fakeResponse();
    writeAgentEvent(res, { type: 'agent_status', kind: 'done' }, 'm');
    const data = JSON.parse(writes[1]!.slice('data: '.length).trim());
    expect(data).toEqual({ kind: 'done', label: undefined });
  });

  it('writes a permission_prompt event with id/tool/summary/options', () => {
    const { res, writes } = fakeResponse();
    const evt: AgentEvent = {
      type: 'permission_prompt',
      id: 'p1',
      tool: 'Bash',
      summary: 'rm tmp/',
      options: [
        { id: 'approve', label: 'Approve' },
        { id: 'deny', label: 'Deny' },
      ],
    };
    writeAgentEvent(res, evt, 'm');
    expect(writes[0]).toBe('event: permission_prompt\n');
    const data = JSON.parse(writes[1]!.slice('data: '.length).trim());
    expect(data).toEqual({
      id: 'p1',
      tool: 'Bash',
      summary: 'rm tmp/',
      options: [
        { id: 'approve', label: 'Approve' },
        { id: 'deny', label: 'Deny' },
      ],
    });
  });

  it('writes an error event with just a message', () => {
    const { res, writes } = fakeResponse();
    writeAgentEvent(res, { type: 'error', message: 'boom' }, 'm');
    expect(writes[0]).toBe('event: error\n');
    const data = JSON.parse(writes[1]!.slice('data: '.length).trim());
    expect(data).toEqual({ message: 'boom' });
  });

  it('every frame is terminated with a blank line (double newline)', () => {
    const { res, writes } = fakeResponse();
    writeAgentEvent(res, { type: 'text', delta: 'x' }, 'm');
    expect(writes[0]!.endsWith('\n\n')).toBe(true);
  });
});

describe('writeDone', () => {
  it('writes the [DONE] sentinel and ends the response', () => {
    const { res, writes } = fakeResponse();
    writeDone(res);
    expect(writes).toEqual(['data: [DONE]\n\n']);
    expect((res as any).end).toHaveBeenCalled();
  });
});
