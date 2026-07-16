import { describe, it, expect, vi } from 'vitest';
import { OidcClient, type OidcConfig } from '../OidcClient.ts';
import type { StoragePort } from '../StoragePort.ts';

function memStorage(): StoragePort {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => {
      m.set(k, v);
    },
    remove: async (k) => {
      m.delete(k);
    },
  };
}

const CONFIG: OidcConfig = {
  issuer: 'https://hub.ci.computer/api/auth',
  clientId: 'ci-hub',
  scope: 'openid email profile offline_access',
  redirectUri: 'https://app.local/',
};

const DISCOVERY = {
  issuer: 'https://hub.ci.computer',
  authorization_endpoint: 'https://hub.ci.computer/api/auth/oauth2/authorize',
  token_endpoint: 'https://hub.ci.computer/api/auth/oauth2/token',
  userinfo_endpoint: 'https://hub.ci.computer/api/auth/oauth2/userinfo',
  jwks_uri: 'https://hub.ci.computer/api/auth/jwks',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('OidcClient', () => {
  it('discovers endpoints from the well-known document', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('/.well-known/openid-configuration');
      return jsonResponse(DISCOVERY);
    });
    const client = new OidcClient(CONFIG, memStorage(), fetchMock as unknown as typeof fetch);
    const eps = await client.discover();
    expect(eps.authorization_endpoint).toBe(DISCOVERY.authorization_endpoint);
    expect(eps.token_endpoint).toBe(DISCOVERY.token_endpoint);
  });

  it('falls back to Better-Auth route layout when discovery fails', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 404 }));
    const client = new OidcClient(CONFIG, memStorage(), fetchMock as unknown as typeof fetch);
    const eps = await client.discover();
    expect(eps.authorization_endpoint).toBe(
      'https://hub.ci.computer/api/auth/oauth2/authorize'
    );
    expect(eps.token_endpoint).toBe('https://hub.ci.computer/api/auth/oauth2/token');
  });

  it('builds an authorize URL with PKCE + state and persists the pending record', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(DISCOVERY));
    const storage = memStorage();
    const client = new OidcClient(CONFIG, storage, fetchMock as unknown as typeof fetch);

    const url = new URL(await client.createAuthorizeUrl());
    expect(url.origin + url.pathname).toBe(DISCOVERY.authorization_endpoint);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('ci-hub');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.local/');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    const state = url.searchParams.get('state')!;
    expect(state).toBeTruthy();

    const pending = JSON.parse((await storage.get('ci-oidc-pending'))!);
    expect(pending.state).toBe(state);
    expect(pending.codeVerifier).toBeTruthy();
  });

  it('completes login: validates state and exchanges the code', async () => {
    const tokenBody = {
      access_token: 'at-123',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'rt-123',
      id_token: 'h.e.s',
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/.well-known/')) return jsonResponse(DISCOVERY);
      if (url.includes('/oauth2/token')) {
        const body = String(init?.body ?? '');
        expect(body).toContain('grant_type=authorization_code');
        expect(body).toContain('code_verifier=');
        expect(body).toContain('code=the-code');
        return jsonResponse(tokenBody);
      }
      throw new Error(`unexpected ${url}`);
    });
    const storage = memStorage();
    const client = new OidcClient(CONFIG, storage, fetchMock as unknown as typeof fetch);

    const url = new URL(await client.createAuthorizeUrl());
    const state = url.searchParams.get('state')!;

    const tokens = await client.completeLoginFromRedirect(
      `?code=the-code&state=${state}`
    );
    expect(tokens.accessToken).toBe('at-123');
    expect(tokens.refreshToken).toBe('rt-123');
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
    // pending record consumed
    expect(await storage.get('ci-oidc-pending')).toBeNull();
  });

  it('rejects a state mismatch', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(DISCOVERY));
    const storage = memStorage();
    const client = new OidcClient(CONFIG, storage, fetchMock as unknown as typeof fetch);
    await client.createAuthorizeUrl();
    await expect(
      client.completeLoginFromRedirect('?code=x&state=WRONG')
    ).rejects.toThrow(/state mismatch/i);
  });

  it('surfaces an error response from the IdP', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(DISCOVERY));
    const storage = memStorage();
    const client = new OidcClient(CONFIG, storage, fetchMock as unknown as typeof fetch);
    await client.createAuthorizeUrl();
    await expect(
      client.completeLoginFromRedirect('?error=access_denied&error_description=nope')
    ).rejects.toThrow(/access_denied/);
  });

  it('refreshes and preserves a missing rotated refresh token', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/.well-known/')) return jsonResponse(DISCOVERY);
      if (url.includes('/oauth2/token')) {
        expect(String(init?.body)).toContain('grant_type=refresh_token');
        return jsonResponse({ access_token: 'at-new', expires_in: 3600 });
      }
      throw new Error('unexpected');
    });
    const client = new OidcClient(CONFIG, memStorage(), fetchMock as unknown as typeof fetch);
    const next = await client.refresh('rt-old');
    expect(next.accessToken).toBe('at-new');
    expect(next.refreshToken).toBe('rt-old'); // preserved
  });
});
