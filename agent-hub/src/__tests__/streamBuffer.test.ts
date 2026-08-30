import { describe, it, expect, vi } from 'vitest';
import type { ServerResponse } from 'node:http';
import { startTurn, getTurn, cancelTurn } from '../streamBuffer.ts';

/** Minimal fake ServerResponse that records write()/end() calls. */
function fakeRes() {
  const writes: string[] = [];
  let ended = false;
  const res = {
    write: vi.fn((chunk: string) => {
      writes.push(chunk);
      return true;
    }),
    end: vi.fn(() => {
      ended = true;
    }),
  };
  return { res: res as unknown as ServerResponse, writes, isEnded: () => ended };
}

describe('streamBuffer', () => {
  it('getTurn returns undefined for an id with no active turn', () => {
    expect(getTurn('nope')).toBeUndefined();
  });

  it('a fresh subscriber attached at -1 receives everything pushed so far', () => {
    const buffer = startTurn('s1', 't1', 'm', () => {});
    buffer.push({ type: 'text', delta: 'a' });
    buffer.push({ type: 'text', delta: 'b' });

    const { res, writes } = fakeRes();
    buffer.attach(res, -1);
    expect(writes.join('')).toContain('"a"');
    expect(writes.join('')).toContain('"b"');
  });

  it('a subscriber attached mid-turn only sees events after its cursor, then live events', () => {
    const buffer = startTurn('s2', 't1', 'm', () => {});
    buffer.push({ type: 'text', delta: 'a' }); // seq 0
    buffer.push({ type: 'text', delta: 'b' }); // seq 1

    const { res, writes } = fakeRes();
    buffer.attach(res, 0); // already has seq 0
    expect(writes.join('')).not.toContain('"a"');
    expect(writes.join('')).toContain('"b"');

    buffer.push({ type: 'text', delta: 'c' }); // live push while attached
    expect(writes.join('')).toContain('"c"');
  });

  it('finish() sends [DONE] to every live subscriber and stops accepting pushes', () => {
    const buffer = startTurn('s3', 't1', 'm', () => {});
    const a = fakeRes();
    const b = fakeRes();
    buffer.attach(a.res, -1);
    buffer.attach(b.res, -1);

    buffer.finish();
    expect(a.writes).toContain('data: [DONE]\n\n');
    expect(b.writes).toContain('data: [DONE]\n\n');
    expect(a.isEnded()).toBe(true);

    buffer.push({ type: 'text', delta: 'too-late' });
    expect(a.writes.join('')).not.toContain('too-late');
  });

  it('attach() after finish() immediately replays + sends [DONE]', () => {
    const buffer = startTurn('s4', 't1', 'm', () => {});
    buffer.push({ type: 'text', delta: 'a' });
    buffer.finish();

    const { res, writes } = fakeRes();
    buffer.attach(res, -1);
    expect(writes.join('')).toContain('"a"');
    expect(writes).toContain('data: [DONE]\n\n');
  });

  it('detach() removes a subscriber from future live pushes', () => {
    const buffer = startTurn('s5', 't1', 'm', () => {});
    const { res, writes } = fakeRes();
    buffer.attach(res, -1);
    buffer.detach(res);

    buffer.push({ type: 'text', delta: 'after-detach' });
    expect(writes.join('')).not.toContain('after-detach');
  });

  it('canResumeFrom is true for -1 and for a cursor still within the ring buffer', () => {
    const buffer = startTurn('s6', 't1', 'm', () => {});
    buffer.push({ type: 'text', delta: 'a' });
    expect(buffer.canResumeFrom(-1)).toBe(true);
    expect(buffer.canResumeFrom(0)).toBe(true);
  });

  it('canResumeFrom is false once the ring buffer evicts the requested cursor', () => {
    const buffer = startTurn('s7', 't1', 'm', () => {});
    for (let i = 0; i < 250; i++) buffer.push({ type: 'text', delta: `e${i}` });
    // seq 0 has long since been evicted (ring size 200).
    expect(buffer.canResumeFrom(0)).toBe(false);
    expect(buffer.canResumeFrom(-1)).toBe(true); // "from the start" is always valid
  });

  it('startTurn on an in-flight session cancels the prior turn (aborts + finishes it)', () => {
    let aborted = false;
    const first = startTurn('s8', 't1', 'm', () => {
      aborted = true;
    });
    const a = fakeRes();
    first.attach(a.res, -1);

    startTurn('s8', 't2', 'm', () => {});

    expect(aborted).toBe(true);
    expect(first.isFinished()).toBe(true);
    expect(a.writes).toContain('data: [DONE]\n\n');
    expect(getTurn('s8')).not.toBe(first);
  });

  it('cancelTurn aborts and finishes the current turn, returning true', () => {
    let aborted = false;
    const buffer = startTurn('s9', 't1', 'm', () => {
      aborted = true;
    });
    expect(cancelTurn('s9')).toBe(true);
    expect(aborted).toBe(true);
    expect(buffer.isFinished()).toBe(true);
  });

  it('cancelTurn returns false when there is no in-flight turn', () => {
    expect(cancelTurn('never-started')).toBe(false);
  });

  it('cancelTurn returns false once the turn has already finished', () => {
    const buffer = startTurn('s10', 't1', 'm', () => {});
    buffer.finish();
    expect(cancelTurn('s10')).toBe(false);
  });
});
