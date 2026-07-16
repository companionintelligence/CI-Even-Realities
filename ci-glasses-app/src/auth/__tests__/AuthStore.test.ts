import { describe, it, expect, vi } from 'vitest';
import { AuthStore } from '../AuthStore.ts';
import type { OidcClient, TokenSet } from '../OidcClient.ts';
import type { StoragePort } from '../StoragePort.ts';
import { base64UrlEncode } from '../pkce.ts';

function memStorage(): StoragePort & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => {
      map.set(k, v);
    },
    remove: async (k) => {
      map.delete(k);
    },
  };
}

function idToken(claims: Record<string, unknown>): string {
  const seg = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  return `h.${seg}.s`;
}

function tokens(overrides: Partial<TokenSet> = {}): TokenSet {
  return {
    accessToken: 'at-1',
    tokenType: 'Bearer',
    expiresAt: Date.now() + 3_600_000,
    refreshToken: 'rt-1',
    idToken: idToken({ sub: 'u1', email: 'ada@ci.co', name: 'Ada' }),
    ...overrides,
  };
}

function fakeClient(over: Partial<OidcClient> = {}): OidcClient {
  return {
    refresh: vi.fn(),
    revoke: vi.fn(async () => undefined),
    ...over,
  } as unknown as OidcClient;
}

describe('AuthStore', () => {
  it('signs in, derives identity, and persists', async () => {
    const storage = memStorage();
    const store = new AuthStore(fakeClient(), storage);
    await store.signIn(tokens());
    expect(store.isSignedIn()).toBe(true);
    expect(store.getIdentity()).toEqual({ sub: 'u1', email: 'ada@ci.co', name: 'Ada' });
    expect(storage.map.get('ci-oidc-tokens')).toBeTruthy();
  });

  it('restores a persisted session on load', async () => {
    const storage = memStorage();
    storage.map.set('ci-oidc-tokens', JSON.stringify(tokens()));
    const store = new AuthStore(fakeClient(), storage);
    await store.load();
    expect(store.isSignedIn()).toBe(true);
  });

  it('returns the current token while fresh (no refresh)', async () => {
    const refresh = vi.fn();
    const store = new AuthStore(fakeClient({ refresh }), memStorage());
    await store.signIn(tokens());
    expect(await store.getValidAccessToken()).toBe('at-1');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes when the token is within the skew window', async () => {
    const refresh = vi.fn(async () => tokens({ accessToken: 'at-2', expiresAt: Date.now() + 3_600_000 }));
    const store = new AuthStore(fakeClient({ refresh }), memStorage());
    await store.signIn(tokens({ expiresAt: Date.now() + 1_000 })); // ~expired
    expect(await store.getValidAccessToken()).toBe('at-2');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('de-dupes concurrent refreshes into one call', async () => {
    // Deferred created up-front so `resolve` exists before refresh is invoked.
    let resolve!: (t: TokenSet) => void;
    const deferred = new Promise<TokenSet>((r) => {
      resolve = r;
    });
    const refresh = vi.fn(() => deferred);
    const store = new AuthStore(fakeClient({ refresh }), memStorage());
    await store.signIn(tokens({ expiresAt: Date.now() - 1 }));

    const p1 = store.getValidAccessToken();
    const p2 = store.getValidAccessToken();
    resolve(tokens({ accessToken: 'at-shared' }));
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe('at-shared');
    expect(b).toBe('at-shared');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('clears the session when refresh fails', async () => {
    const refresh = vi.fn(async () => {
      throw new Error('refresh boom');
    });
    const storage = memStorage();
    const store = new AuthStore(fakeClient({ refresh }), storage);
    await store.signIn(tokens({ expiresAt: Date.now() - 1 }));
    expect(await store.forceRefresh()).toBeUndefined();
    expect(store.isSignedIn()).toBe(false);
    expect(storage.map.get('ci-oidc-tokens')).toBeUndefined();
  });

  it('signOut clears storage and revokes', async () => {
    const revoke = vi.fn(async () => undefined);
    const storage = memStorage();
    const store = new AuthStore(fakeClient({ revoke }), storage);
    await store.signIn(tokens());
    await store.signOut();
    expect(store.isSignedIn()).toBe(false);
    expect(revoke).toHaveBeenCalledWith('at-1');
    expect(storage.map.get('ci-oidc-tokens')).toBeUndefined();
  });

  it('useStorage loads a session from the newly-attached store', async () => {
    const store = new AuthStore(fakeClient(), memStorage());
    await store.load(); // empty
    expect(store.isSignedIn()).toBe(false);

    const bridge = memStorage();
    bridge.map.set('ci-oidc-tokens', JSON.stringify(tokens()));
    await store.useStorage(bridge);
    expect(store.isSignedIn()).toBe(true);
  });
});
