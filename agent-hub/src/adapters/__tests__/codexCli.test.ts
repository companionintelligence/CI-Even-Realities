import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { CodexCliAdapter } from '../codexCli.ts';
import type { ChatRequest, SessionContext } from '../Adapter.ts';
import type { AgentEvent } from '../../events.ts';

/** Minimal fake `ChildProcessWithoutNullStreams` driven by the test. */
class FakeChild extends EventEmitter {
  stdin = { write: vi.fn() };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;

  constructor() {
    super();
    (this.stdout as unknown as { setEncoding: (e: string) => void }).setEncoding = vi.fn();
    (this.stderr as unknown as { setEncoding: (e: string) => void }).setEncoding = vi.fn();
  }

  kill(): boolean {
    this.killed = true;
    this.emit('exit');
    return true;
  }

  emitLine(obj: unknown): void {
    this.stdout.emit('data', `${JSON.stringify(obj)}\n`);
  }
}

let spawned: FakeChild[] = [];

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const child = new FakeChild();
    spawned.push(child);
    return child;
  }),
}));

function req(text = 'hi'): ChatRequest {
  return { model: 'm', stream: true, messages: [{ role: 'user', content: text }] };
}

function ctx(signal: AbortSignal = new AbortController().signal): SessionContext {
  return { sessionId: 's1', signal };
}

function pump(iter: AsyncIterable<AgentEvent>): {
  events: AgentEvent[];
  done: Promise<void>;
} {
  const events: AgentEvent[] = [];
  const done = (async () => {
    for await (const evt of iter) events.push(evt);
  })();
  return { events, done };
}

describe('CodexCliAdapter', () => {
  beforeEach(() => {
    spawned = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('completes a normal turn: thinking -> text -> done', async () => {
    const adapter = new CodexCliAdapter({ binary: 'codex', cwd: '/tmp' });
    const { events, done } = pump(adapter.run(req(), ctx()));

    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    spawned[0]!.emitLine({ type: 'text', text: 'hello' });
    spawned[0]!.emitLine({ type: 'done' });
    await done;

    expect(events).toEqual([
      { type: 'agent_status', kind: 'thinking' },
      { type: 'text', delta: 'hello' },
      { type: 'agent_status', kind: 'done' },
    ]);
  });

  it('reuses the same subprocess across two turns of the same session', async () => {
    const adapter = new CodexCliAdapter({ binary: 'codex', cwd: '/tmp' });
    const first = pump(adapter.run(req('one'), ctx()));
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    spawned[0]!.emitLine({ type: 'done' });
    await first.done;

    const second = pump(adapter.run(req('two'), ctx()));
    spawned[0]!.emitLine({ type: 'done' });
    await second.done;

    expect(spawned).toHaveLength(1);
  });

  it('permission-prompt round trip: prompt surfaces, approve() writes the response', async () => {
    const adapter = new CodexCliAdapter({ binary: 'codex', cwd: '/tmp' });
    const { events, done } = pump(adapter.run(req(), ctx()));
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    const child = spawned[0]!;

    child.emitLine({
      type: 'approval_request',
      id: 'codex-req-1',
      tool: 'Bash',
      summary: 'rm -rf tmp/',
    });

    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'permission_prompt')).toBe(true)
    );
    const prompt = events.find((e) => e.type === 'permission_prompt') as Extract<
      AgentEvent,
      { type: 'permission_prompt' }
    >;

    const ok = await adapter.approve('s1', prompt.id, 'deny');
    expect(ok).toBe(true);
    const written = child.stdin.write.mock.calls.map((c) => JSON.parse(c[0] as string));
    expect(written).toContainEqual({
      type: 'permission_response',
      id: 'codex-req-1',
      approved: false,
    });

    child.emitLine({ type: 'done' });
    await done;
  });

  it('yields an error when the subprocess exits without a done status', async () => {
    const adapter = new CodexCliAdapter({ binary: 'codex', cwd: '/tmp' });
    const { events, done } = pump(adapter.run(req(), ctx()));
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    // Let the generator resume past the initial 'thinking' yield and reach
    // its dequeue() call, so the 'exit' handler has a live resolver to call.
    await new Promise((r) => setTimeout(r, 0));
    spawned[0]!.emit('exit');
    await done;

    expect(events.at(-1)).toEqual({ type: 'error', message: 'codex subprocess exited' });
  });

  it('kills the subprocess and yields an error on inactivity timeout', async () => {
    vi.useFakeTimers();
    const adapter = new CodexCliAdapter({
      binary: 'codex',
      cwd: '/tmp',
      inactivityTimeoutMs: 1_000,
      wallClockMaxMs: 60_000,
      heartbeatIntervalMs: 30_000,
    });
    const { events, done } = pump(adapter.run(req(), ctx()));

    await vi.advanceTimersByTimeAsync(0);
    expect(spawned).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_100);
    await done;

    expect(events.some((e) => e.type === 'error' && e.message.includes('inactivity'))).toBe(
      true
    );
    expect(spawned[0]!.killed).toBe(true);
  });

  it('kills the subprocess and yields an error when the wall-clock cap is hit', async () => {
    vi.useFakeTimers();
    const adapter = new CodexCliAdapter({
      binary: 'codex',
      cwd: '/tmp',
      inactivityTimeoutMs: 60_000,
      wallClockMaxMs: 1_000,
      heartbeatIntervalMs: 30_000,
    });
    const { events, done } = pump(adapter.run(req(), ctx()));

    await vi.advanceTimersByTimeAsync(0);
    const child = spawned[0]!;
    child.emitLine({ type: 'text', text: 'x' });

    await vi.advanceTimersByTimeAsync(1_100);
    await done;

    expect(
      events.some((e) => e.type === 'error' && e.message.includes('max turn duration'))
    ).toBe(true);
    expect(child.killed).toBe(true);
  });

  it('kills the subprocess when the session AbortSignal fires', async () => {
    const controller = new AbortController();
    const adapter = new CodexCliAdapter({ binary: 'codex', cwd: '/tmp' });
    const { done } = pump(adapter.run(req(), ctx(controller.signal)));
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    // Let the generator resume past the initial 'thinking' yield and
    // register the abort listener before firing it.
    await new Promise((r) => setTimeout(r, 0));

    controller.abort();
    await done;

    expect(spawned[0]!.killed).toBe(true);
  });
});
