import { describe, it, expect, vi } from 'vitest';
import {
  authedFetch,
  StaticKeyProvider,
  type TokenProvider,
} from '../TokenProvider.ts';

describe('authedFetch', () => {
  it('sends the provider bearer', async () => {
    const provider: TokenProvider = { getBearer: async () => 'tok-1' };
    const doFetch = vi.fn(async (b?: string) => {
      expect(b).toBe('tok-1');
      return new Response('ok', { status: 200 });
    });
    const res = await authedFetch(provider, 'fallback', doFetch);
    expect(res.status).toBe(200);
    expect(doFetch).toHaveBeenCalledOnce();
  });

  it('falls back to the static key when the provider yields none', async () => {
    const provider: TokenProvider = { getBearer: async () => undefined };
    let seen: string | undefined;
    await authedFetch(provider, 'the-key', async (b) => {
      seen = b;
      return new Response(null, { status: 200 });
    });
    expect(seen).toBe('the-key');
  });

  it('refreshes once and retries on 401', async () => {
    let bearer = 'stale';
    const provider: TokenProvider = {
      getBearer: async () => bearer,
      onUnauthorized: vi.fn(async () => {
        bearer = 'fresh';
        return true;
      }),
    };
    const seen: (string | undefined)[] = [];
    const doFetch = vi.fn(async (b?: string) => {
      seen.push(b);
      return new Response(null, { status: b === 'fresh' ? 200 : 401 });
    });
    const res = await authedFetch(provider, undefined, doFetch);
    expect(res.status).toBe(200);
    expect(seen).toEqual(['stale', 'fresh']);
    expect(provider.onUnauthorized).toHaveBeenCalledOnce();
  });

  it('does not retry when refresh reports failure', async () => {
    const provider: TokenProvider = {
      getBearer: async () => 'stale',
      onUnauthorized: async () => false,
    };
    const doFetch = vi.fn(async () => new Response(null, { status: 401 }));
    const res = await authedFetch(provider, undefined, doFetch);
    expect(res.status).toBe(401);
    expect(doFetch).toHaveBeenCalledOnce();
  });

  it('does not retry a static-key provider on 401', async () => {
    const provider = new StaticKeyProvider(() => 'k');
    const doFetch = vi.fn(async () => new Response(null, { status: 401 }));
    const res = await authedFetch(provider, undefined, doFetch);
    expect(res.status).toBe(401);
    expect(doFetch).toHaveBeenCalledOnce();
  });

  it('StaticKeyProvider returns undefined for an empty key', async () => {
    expect(await new StaticKeyProvider(() => '').getBearer()).toBeUndefined();
  });
});
