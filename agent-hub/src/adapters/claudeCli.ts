/**
 * claudeCli.ts
 *
 * Adapter that drives Claude Code in headless stream-json mode:
 *
 *   claude -p --input-format stream-json --output-format stream-json \
 *          --session-id <sessionId>
 *
 * One subprocess per session — re-used across turns of the same conversation.
 * Stdin receives user turns + permission responses as JSON lines; stdout
 * yields stream-json events that we translate to AgentEvents.
 *
 * The stream-json wire shape evolves between Claude releases. We treat
 * unknown event types as soft-skip rather than throw, so the adapter degrades
 * gracefully rather than breaking the HUD outright when the CLI updates.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Adapter, ChatRequest, SessionContext } from './Adapter.ts';
import type { AgentEvent, PromptOption } from '../events.ts';
import { DEFAULT_PROMPT_OPTIONS } from '../events.ts';

export interface ClaudeCliOptions {
  binary: string;
  cwd: string;
  /**
   * Kill the subprocess if no event arrives on stdout for this long (ms).
   * Guards against a hung CLI leaving the HUD stuck on "thinking…" forever.
   * Default 45s.
   */
  inactivityTimeoutMs?: number;
  /** Hard ceiling on a turn's total duration regardless of activity (ms). Default 5min. */
  wallClockMaxMs?: number;
  /**
   * While waiting with no new event but before either hard deadline above,
   * emit a heartbeat status at this interval so the HUD doesn't look frozen
   * during a slow tool call (ms). Default 5s.
   */
  heartbeatIntervalMs?: number;
}

const DEFAULT_INACTIVITY_TIMEOUT_MS = 45_000;
const DEFAULT_WALL_CLOCK_MAX_MS = 300_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;

interface ProcHandle {
  child: ChildProcessWithoutNullStreams;
  /** Queue of events waiting to be consumed by the in-flight run() iterator. */
  queue: AgentEvent[];
  /** Resolver for a consumer waiting for the next event. */
  resolve: ((v: { value: AgentEvent | null; done: boolean }) => void) | null;
  /** Map of promptId -> claude's internal request id (for approve replies). */
  pendingPrompts: Map<string, string>;
  /** Set once the current turn produces a `done` status — gates run() return. */
  turnComplete: boolean;
}

export class ClaudeCliAdapter implements Adapter {
  readonly kind = 'claude-cli' as const;
  private procs = new Map<string, ProcHandle>();

  constructor(private opts: ClaudeCliOptions) {}

  async *run(
    req: ChatRequest,
    ctx: SessionContext
  ): AsyncIterable<AgentEvent> {
    const handle = this.ensureProc(ctx.sessionId);
    handle.turnComplete = false;

    const userText = lastUserText(req);
    if (!userText) {
      yield { type: 'error', message: 'no user message' };
      return;
    }

    // Write the user turn. Format matches the stream-json input the
    // claude CLI consumes; field names tracked against the public Claude
    // Agent SDK shape.
    writeJsonLine(handle.child, {
      type: 'user',
      message: { role: 'user', content: userText },
    });

    yield { type: 'agent_status', kind: 'thinking' };

    const abort = () => this.killProc(ctx.sessionId);
    ctx.signal.addEventListener('abort', abort, { once: true });

    const inactivityTimeoutMs =
      this.opts.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS;
    const wallClockMaxMs = this.opts.wallClockMaxMs ?? DEFAULT_WALL_CLOCK_MAX_MS;
    const heartbeatIntervalMs =
      this.opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    const turnStart = Date.now();
    let lastActivity = turnStart;

    try {
      while (true) {
        const wallClockRemaining = wallClockMaxMs - (Date.now() - turnStart);
        if (wallClockRemaining <= 0) {
          this.killProc(ctx.sessionId);
          yield { type: 'error', message: 'claude subprocess exceeded max turn duration' };
          return;
        }
        const inactivityRemaining =
          inactivityTimeoutMs - (Date.now() - lastActivity);
        if (inactivityRemaining <= 0) {
          this.killProc(ctx.sessionId);
          yield { type: 'error', message: 'claude subprocess inactivity timeout' };
          return;
        }
        const waitMs = Math.max(
          1,
          Math.min(heartbeatIntervalMs, inactivityRemaining, wallClockRemaining)
        );

        const next = await this.dequeueWithTimeout(handle, waitMs);
        if (next.timedOut) {
          // Only a genuine heartbeat (well before either hard deadline) gets
          // a status ping. When the timeout fired because a hard deadline
          // itself just elapsed, skip straight to the top-of-loop checks
          // above, which will kill the process and yield the real error —
          // no point flashing "still working" the instant before that.
          const stillInactive = Date.now() - lastActivity < inactivityTimeoutMs;
          const stillWithinWallClock = Date.now() - turnStart < wallClockMaxMs;
          if (stillInactive && stillWithinWallClock) {
            yield { type: 'agent_status', kind: 'executing' };
          }
          continue;
        }
        if (next.done) {
          yield {
            type: 'error',
            message: 'claude subprocess exited unexpectedly',
          };
          return;
        }
        lastActivity = Date.now();
        const evt = next.value!;
        yield evt;
        if (evt.type === 'agent_status' && evt.kind === 'done') {
          handle.turnComplete = true;
          return;
        }
      }
    } finally {
      ctx.signal.removeEventListener('abort', abort);
    }
  }

  async approve(
    sessionId: string,
    promptId: string,
    optionId: string
  ): Promise<boolean> {
    const handle = this.procs.get(sessionId);
    if (!handle) return false;
    const claudeRequestId = handle.pendingPrompts.get(promptId);
    if (!claudeRequestId) return false;
    handle.pendingPrompts.delete(promptId);
    writeJsonLine(handle.child, {
      type: 'permission_response',
      request_id: claudeRequestId,
      approved: optionId === 'approve',
    });
    return true;
  }

  async dispose(sessionId: string): Promise<void> {
    this.killProc(sessionId);
  }

  // ──────────────────────────────────────────────────────────────────────────

  private ensureProc(sessionId: string): ProcHandle {
    const existing = this.procs.get(sessionId);
    if (existing && !existing.child.killed) return existing;

    const child = spawn(
      this.opts.binary,
      [
        '-p',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--session-id',
        sessionId,
      ],
      { cwd: this.opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const handle: ProcHandle = {
      child,
      queue: [],
      resolve: null,
      pendingPrompts: new Map(),
      turnComplete: false,
    };

    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          for (const evt of translate(parsed, handle)) {
            this.enqueue(handle, evt);
          }
        } catch {
          // skip non-JSON output
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      console.warn('[claude-cli stderr]', chunk.trim());
    });

    child.on('exit', () => {
      // Signal end-of-stream to any waiter.
      const r = handle.resolve;
      handle.resolve = null;
      r?.({ value: null, done: true });
      this.procs.delete(sessionId);
    });

    this.procs.set(sessionId, handle);
    return handle;
  }

  private enqueue(handle: ProcHandle, evt: AgentEvent): void {
    if (handle.resolve) {
      const r = handle.resolve;
      handle.resolve = null;
      r({ value: evt, done: false });
    } else {
      handle.queue.push(evt);
    }
  }

  private dequeue(
    handle: ProcHandle
  ): Promise<{ value: AgentEvent | null; done: boolean }> {
    if (handle.queue.length > 0) {
      return Promise.resolve({ value: handle.queue.shift()!, done: false });
    }
    return new Promise((resolve) => {
      handle.resolve = resolve;
    });
  }

  /**
   * Race `dequeue()` against a timer. On timeout, the original dequeue
   * promise is simply abandoned — the next call to `dequeue()` replaces
   * `handle.resolve` with a fresh resolver, so a later event still reaches
   * whichever dequeue call is current when it arrives.
   */
  private dequeueWithTimeout(
    handle: ProcHandle,
    timeoutMs: number
  ): Promise<{ value: AgentEvent | null; done: boolean; timedOut: boolean }> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ value: null, done: false, timedOut: true });
      }, timeoutMs);
      this.dequeue(handle).then((r) => {
        clearTimeout(timer);
        resolve({ ...r, timedOut: false });
      });
    });
  }

  private killProc(sessionId: string): void {
    const handle = this.procs.get(sessionId);
    if (!handle) return;
    handle.child.kill('SIGTERM');
    const r = handle.resolve;
    handle.resolve = null;
    r?.({ value: null, done: true });
    this.procs.delete(sessionId);
  }
}

function lastUserText(req: ChatRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i];
    if (m && m.role === 'user') return m.content;
  }
  return '';
}

function writeJsonLine(
  child: ChildProcessWithoutNullStreams,
  obj: unknown
): void {
  child.stdin.write(`${JSON.stringify(obj)}\n`);
}

/**
 * Translate one stream-json line from the claude CLI to zero or more
 * AgentEvents. Side-effect: records pending prompt ids on the handle so
 * approve() can correlate the reply.
 */
function translate(
  ev: Record<string, unknown>,
  handle: ProcHandle
): AgentEvent[] {
  const type = ev['type'];

  if (type === 'assistant' || type === 'text_delta') {
    const delta = extractDelta(ev);
    return delta ? [{ type: 'text', delta }] : [];
  }
  if (type === 'tool_use') {
    const name = typeof ev['name'] === 'string' ? (ev['name'] as string) : 'tool';
    return [{ type: 'agent_status', kind: 'executing', label: name }];
  }
  if (type === 'permission_request' || type === 'permission_prompt') {
    const requestId =
      (typeof ev['request_id'] === 'string' && (ev['request_id'] as string)) ||
      (typeof ev['id'] === 'string' && (ev['id'] as string)) ||
      randomUUID();
    const tool =
      (typeof ev['tool_name'] === 'string' && (ev['tool_name'] as string)) ||
      (typeof ev['tool'] === 'string' && (ev['tool'] as string)) ||
      'tool';
    const summary =
      (typeof ev['summary'] === 'string' && (ev['summary'] as string)) ||
      (typeof ev['input'] === 'string' && (ev['input'] as string)) ||
      'Approve tool call?';
    const promptId = `p-${randomUUID()}`;
    handle.pendingPrompts.set(promptId, requestId);
    const options: PromptOption[] = DEFAULT_PROMPT_OPTIONS;
    return [
      {
        type: 'permission_prompt',
        id: promptId,
        tool,
        summary,
        options,
      },
      { type: 'agent_status', kind: 'awaiting_input' },
    ];
  }
  if (type === 'result' || type === 'done' || type === 'turn_complete') {
    return [{ type: 'agent_status', kind: 'done' }];
  }
  if (type === 'error') {
    const msg =
      (typeof ev['message'] === 'string' && (ev['message'] as string)) ||
      'claude error';
    return [{ type: 'error', message: msg }];
  }
  return [];
}

function extractDelta(ev: Record<string, unknown>): string {
  if (typeof ev['delta'] === 'string') return ev['delta'] as string;
  const msg = ev['message'];
  if (typeof msg === 'object' && msg !== null) {
    const content = (msg as Record<string, unknown>)['content'];
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const buf: string[] = [];
      for (const part of content) {
        if (typeof part === 'string') buf.push(part);
        else if (
          typeof part === 'object' &&
          part !== null &&
          typeof (part as Record<string, unknown>)['text'] === 'string'
        ) {
          buf.push((part as Record<string, unknown>)['text'] as string);
        }
      }
      return buf.join('');
    }
  }
  if (typeof ev['text'] === 'string') return ev['text'] as string;
  return '';
}
