import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bindSession, getSession, dropSession } from '../sessions.ts';
import type { Adapter, ChatRequest, SessionContext } from '../adapters/Adapter.ts';
import type { AgentEvent } from '../events.ts';

function fakeAdapter(overrides: Partial<Adapter> = {}): Adapter {
  return {
    kind: 'openai',
    async *run(_req: ChatRequest, _ctx: SessionContext): AsyncIterable<AgentEvent> {},
    ...overrides,
  };
}

describe('sessions', () => {
  // The module holds a single shared Map — use unique session ids per test
  // rather than resetting module state between tests.
  let idCounter = 0;
  function uniqueId(): string {
    return `sess-${idCounter++}-${Math.random().toString(36).slice(2)}`;
  }

  it('getSession returns undefined for an unbound session id', () => {
    expect(getSession(uniqueId())).toBeUndefined();
  });

  it('bindSession then getSession returns the same adapter instance', () => {
    const id = uniqueId();
    const adapter = fakeAdapter();
    bindSession(id, adapter);
    expect(getSession(id)).toBe(adapter);
  });

  it('re-binding a session id overwrites the previous adapter', () => {
    const id = uniqueId();
    const first = fakeAdapter({ kind: 'openai' });
    const second = fakeAdapter({ kind: 'openclaw' });
    bindSession(id, first);
    bindSession(id, second);
    expect(getSession(id)).toBe(second);
  });

  it('dropSession removes the binding', () => {
    const id = uniqueId();
    bindSession(id, fakeAdapter());
    dropSession(id);
    expect(getSession(id)).toBeUndefined();
  });

  it('dropSession calls dispose(sessionId) on an adapter that implements it', () => {
    const id = uniqueId();
    const dispose = vi.fn(async () => undefined);
    bindSession(id, fakeAdapter({ dispose }));
    dropSession(id);
    expect(dispose).toHaveBeenCalledWith(id);
  });

  it('dropSession does not throw for an adapter without dispose', () => {
    const id = uniqueId();
    bindSession(id, fakeAdapter()); // no dispose
    expect(() => dropSession(id)).not.toThrow();
  });

  it('dropSession on an unbound session id is a no-op (no throw)', () => {
    expect(() => dropSession(uniqueId())).not.toThrow();
  });

  it('dropSession does not await dispose (fire-and-forget)', () => {
    const id = uniqueId();
    let resolved = false;
    const dispose = vi.fn(
      () => new Promise<void>((r) => setTimeout(() => { resolved = true; r(); }, 50))
    );
    bindSession(id, fakeAdapter({ dispose }));
    dropSession(id);
    // Session is gone immediately, even though dispose() hasn't resolved yet.
    expect(getSession(id)).toBeUndefined();
    expect(resolved).toBe(false);
  });

  it('different session ids do not interfere with each other', () => {
    const a = uniqueId();
    const b = uniqueId();
    const adapterA = fakeAdapter({ kind: 'openai' });
    const adapterB = fakeAdapter({ kind: 'memory' });
    bindSession(a, adapterA);
    bindSession(b, adapterB);
    expect(getSession(a)).toBe(adapterA);
    expect(getSession(b)).toBe(adapterB);
    dropSession(a);
    expect(getSession(a)).toBeUndefined();
    expect(getSession(b)).toBe(adapterB);
  });
});
