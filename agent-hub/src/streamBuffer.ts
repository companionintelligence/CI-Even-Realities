/**
 * streamBuffer.ts
 *
 * Buffers the SSE events of one in-flight or just-finished chat turn per
 * session, so a client whose connection drops mid-stream can reconnect and
 * replay what it missed instead of losing the partial answer. Modeled on
 * cos-glasses-server's display-bus ring buffer, adapted to a single
 * (usually) subscriber per turn rather than a broadcast bus.
 *
 * A POST to /v1/chat/completions starts a turn (`startTurn`) and attaches its
 * own response as the first subscriber. If that connection drops before the
 * turn finishes, the adapter keeps running in the background — the turn is
 * NOT aborted by a dropped connection — and a client that reconnects via
 * GET /v1/chat/completions/stream can replay from its last-seen cursor and
 * keep receiving live events. Explicit cancellation (double-tap to clear,
 * or a new turn superseding an old one on the same session) goes through
 * `cancelTurn` / `startTurn`, not connection teardown.
 */

import type { ServerResponse } from 'node:http';
import type { AgentEvent } from './events.ts';
import { writeAgentEvent, writeDone } from './sse.ts';

const RING_SIZE = 200;

interface BufferedEvent {
  seq: number;
  event: AgentEvent;
}

export class TurnBuffer {
  private events: BufferedEvent[] = [];
  private nextSeq = 0;
  private finished = false;
  private subscribers = new Set<ServerResponse>();

  constructor(
    public readonly sessionId: string,
    public readonly turnId: string,
    private readonly model: string,
    /** Aborts the adapter run backing this turn (explicit cancel only). */
    private readonly abortRun: () => void
  ) {}

  push(event: AgentEvent): void {
    if (this.finished) return;
    const seq = this.nextSeq++;
    this.events.push({ seq, event });
    if (this.events.length > RING_SIZE) this.events.shift();
    for (const res of this.subscribers) writeAgentEvent(res, event, this.model);
  }

  /** Mark the turn complete: sends [DONE] to every live subscriber. */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    for (const res of this.subscribers) writeDone(res);
    this.subscribers.clear();
  }

  /** Cancel the turn: stop the adapter and finish the buffer immediately. */
  cancel(): void {
    this.abortRun();
    this.finish();
  }

  isFinished(): boolean {
    return this.finished;
  }

  /**
   * Whether a client can resume from `afterSeq` (a seq of -1 means "from the
   * start"). False when the ring buffer has already evicted the events the
   * client would need — nothing more granular to offer without re-running
   * the whole turn, so the caller should tell the client to start over.
   */
  canResumeFrom(afterSeq: number): boolean {
    if (afterSeq < 0) return true;
    const earliestSeq = this.events[0]?.seq ?? this.nextSeq;
    return afterSeq + 1 >= earliestSeq;
  }

  /**
   * Attach a response as a live subscriber: replay buffered events after
   * `afterSeq`, then (unless already finished) keep it registered for
   * subsequent `push()`/`finish()` calls. Caller must have already checked
   * `canResumeFrom(afterSeq)`.
   */
  attach(res: ServerResponse, afterSeq: number): void {
    for (const { seq, event } of this.events) {
      if (seq > afterSeq) writeAgentEvent(res, event, this.model);
    }
    if (this.finished) {
      writeDone(res);
      return;
    }
    this.subscribers.add(res);
  }

  detach(res: ServerResponse): void {
    this.subscribers.delete(res);
  }
}

const turns = new Map<string, TurnBuffer>();

/**
 * Start a fresh turn for a session. Any prior unfinished turn on the same
 * session is cancelled first — a new POST always supersedes whatever the
 * session was doing (mirrors the old req-close-aborts-the-adapter behavior,
 * just triggered by "a new turn started" instead of "the old connection
 * dropped", since a dropped connection alone no longer cancels a turn).
 */
export function startTurn(
  sessionId: string,
  turnId: string,
  model: string,
  abortRun: () => void
): TurnBuffer {
  const existing = turns.get(sessionId);
  if (existing && !existing.isFinished()) existing.cancel();
  const buffer = new TurnBuffer(sessionId, turnId, model, abortRun);
  turns.set(sessionId, buffer);
  return buffer;
}

export function getTurn(sessionId: string): TurnBuffer | undefined {
  return turns.get(sessionId);
}

/** Explicitly cancel a session's in-flight turn (e.g. double-tap to clear). Returns false if none is in flight. */
export function cancelTurn(sessionId: string): boolean {
  const existing = turns.get(sessionId);
  if (!existing || existing.isFinished()) return false;
  existing.cancel();
  return true;
}
