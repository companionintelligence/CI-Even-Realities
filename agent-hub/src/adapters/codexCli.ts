/**
 * codexCli.ts
 *
 * Adapter that drives the OpenAI Codex CLI in JSON-streaming mode. The Codex
 * CLI's event shape is intentionally close to Claude Code's stream-json but
 * not identical, so we have a separate translator. Permission-prompt support
 * mirrors the Claude adapter: prompts are exposed to the glasses; an
 * `approve()` call writes the response on stdin.
 *
 * Subprocess invocation:
 *
 *   codex --json --session <sessionId>   (current Codex 2026 wire)
 *
 * If the binary's CLI flags change, override via `CODEX_BIN` and a wrapper
 * script — the adapter only assumes JSON lines on stdout / stdin.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Adapter, ChatRequest, SessionContext } from './Adapter.ts';
import type { AgentEvent, PromptOption } from '../events.ts';
import { DEFAULT_PROMPT_OPTIONS } from '../events.ts';

export interface CodexCliOptions {
  binary: string;
  cwd: string;
}

interface ProcHandle {
  child: ChildProcessWithoutNullStreams;
  queue: AgentEvent[];
  resolve: ((v: { value: AgentEvent | null; done: boolean }) => void) | null;
  pendingPrompts: Map<string, string>;
}

export class CodexCliAdapter implements Adapter {
  readonly kind = 'codex-cli' as const;
  private procs = new Map<string, ProcHandle>();

  constructor(private opts: CodexCliOptions) {}

  async *run(
    req: ChatRequest,
    ctx: SessionContext
  ): AsyncIterable<AgentEvent> {
    const handle = this.ensureProc(ctx.sessionId);

    const userText = lastUserText(req);
    if (!userText) {
      yield { type: 'error', message: 'no user message' };
      return;
    }

    handle.child.stdin.write(`${JSON.stringify({ type: 'user', text: userText })}\n`);
    yield { type: 'agent_status', kind: 'thinking' };

    const abort = () => this.killProc(ctx.sessionId);
    ctx.signal.addEventListener('abort', abort, { once: true });

    try {
      while (true) {
        const next = await this.dequeue(handle);
        if (next.done) {
          yield { type: 'error', message: 'codex subprocess exited' };
          return;
        }
        const evt = next.value!;
        yield evt;
        if (evt.type === 'agent_status' && evt.kind === 'done') return;
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
    const codexRequestId = handle.pendingPrompts.get(promptId);
    if (!codexRequestId) return false;
    handle.pendingPrompts.delete(promptId);
    handle.child.stdin.write(
      `${JSON.stringify({
        type: 'permission_response',
        id: codexRequestId,
        approved: optionId === 'approve',
      })}\n`
    );
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
      ['--json', '--session', sessionId],
      { cwd: this.opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const handle: ProcHandle = {
      child,
      queue: [],
      resolve: null,
      pendingPrompts: new Map(),
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
          // skip non-JSON
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      console.warn('[codex-cli stderr]', chunk.trim());
    });
    child.on('exit', () => {
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

function translate(
  ev: Record<string, unknown>,
  handle: ProcHandle
): AgentEvent[] {
  const type = ev['type'];
  if (type === 'delta' || type === 'text') {
    const delta =
      (typeof ev['delta'] === 'string' && (ev['delta'] as string)) ||
      (typeof ev['text'] === 'string' && (ev['text'] as string)) ||
      '';
    return delta ? [{ type: 'text', delta }] : [];
  }
  if (type === 'tool_call' || type === 'tool_use') {
    const name =
      typeof ev['name'] === 'string' ? (ev['name'] as string) : 'tool';
    return [{ type: 'agent_status', kind: 'executing', label: name }];
  }
  if (type === 'approval_request' || type === 'permission_request') {
    const reqId =
      (typeof ev['id'] === 'string' && (ev['id'] as string)) || randomUUID();
    const tool =
      (typeof ev['tool'] === 'string' && (ev['tool'] as string)) || 'tool';
    const summary =
      (typeof ev['summary'] === 'string' && (ev['summary'] as string)) ||
      'Approve action?';
    const promptId = `p-${randomUUID()}`;
    handle.pendingPrompts.set(promptId, reqId);
    const options: PromptOption[] = DEFAULT_PROMPT_OPTIONS;
    return [
      { type: 'permission_prompt', id: promptId, tool, summary, options },
      { type: 'agent_status', kind: 'awaiting_input' },
    ];
  }
  if (type === 'turn_end' || type === 'done') {
    return [{ type: 'agent_status', kind: 'done' }];
  }
  if (type === 'error') {
    const msg =
      typeof ev['message'] === 'string'
        ? (ev['message'] as string)
        : 'codex error';
    return [{ type: 'error', message: msg }];
  }
  return [];
}
