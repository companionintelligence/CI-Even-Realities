import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithTimeout } from '../fetchWithTimeout.ts';

describe('fetchWithTimeout', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('resolves normally when the response arrives before the timeout', async () => {
    fetchMock.mockResolvedValue(new Response('ok'));
    const res = await fetchWithTimeout('http://x', {}, 5_000);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('aborts and throws a labeled timeout error when nothing responds in time', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    );

    const promise = fetchWithTimeout('http://x', {}, 50);
    const assertion = expect(promise).rejects.toThrow('request timed out after 50ms');
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });

  it('propagates a non-timeout fetch failure unchanged', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(fetchWithTimeout('http://x', {}, 5_000)).rejects.toThrow('network down');
  });

  it('aborts immediately when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          if (init.signal?.aborted) {
            reject(new DOMException('aborted', 'AbortError'));
            return;
          }
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    );

    await expect(
      fetchWithTimeout('http://x', {}, 5_000, controller.signal)
    ).rejects.toThrow(/aborted/);
  });

  it('propagates abort when the caller signal fires before the timeout', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    );

    const promise = fetchWithTimeout('http://x', {}, 5_000, controller.signal);
    const assertion = expect(promise).rejects.toThrow(/aborted/);
    controller.abort();
    await assertion;
  });
});
