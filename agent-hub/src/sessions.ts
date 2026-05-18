/**
 * sessions.ts
 *
 * In-memory map of `sessionId -> Adapter`. Used by the approve endpoint to
 * route a `prompt_id` back to the adapter that emitted it. Adapters that
 * spawn long-lived processes (claude-cli, codex-cli) use this to persist
 * across multiple turns of the same conversation.
 */

import type { Adapter } from './adapters/Adapter.ts';

const sessions = new Map<string, Adapter>();

export function bindSession(sessionId: string, adapter: Adapter): void {
  sessions.set(sessionId, adapter);
}

export function getSession(sessionId: string): Adapter | undefined {
  return sessions.get(sessionId);
}

export function dropSession(sessionId: string): void {
  const a = sessions.get(sessionId);
  if (a?.dispose) void a.dispose(sessionId);
  sessions.delete(sessionId);
}
