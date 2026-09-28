/**
 * Sign in with Companion Intelligence — Authorization Code + PKCE against
 * CI-Portal, mirroring ci-glasses-app/src/auth/OidcClient.ts. See README.md
 * for the CLIENT_ID registration prerequisite.
 */
import { createPkcePair, randomUrlToken, decodeJwtClaims } from './pkce';

export const ISSUER = 'https://hub.ci.computer/api/auth';
export const CLIENT_ID = 'ci-er-connect';
export const SCOPE = 'openid email profile offline_access';

const TOKENS_KEY = 'er-connect:oidc-tokens';
const PENDING_KEY = 'er-connect:oidc-pending';

export interface TokenSet {
  accessToken: string;
  tokenType: string;
  expiresAt: number;
  refreshToken?: string;
  idToken?: string;
}

export interface Identity {
  email?: string;
  name?: string;
}

interface Endpoints {
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint?: string;
}

let endpointsCache: Endpoints | null = null;

async function discover(): Promise<Endpoints> {
  if (endpointsCache) return endpointsCache;
  const base = ISSUER.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/.well-known/openid-configuration`, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const doc = await res.json();
      if (doc.authorization_endpoint && doc.token_endpoint) {
        endpointsCache = {
          authorization_endpoint: doc.authorization_endpoint,
          token_endpoint: doc.token_endpoint,
          revocation_endpoint: doc.revocation_endpoint,
        };
        return endpointsCache;
      }
    }
  } catch {
    // fall through to conventional layout
  }
  endpointsCache = {
    authorization_endpoint: `${base}/oauth2/authorize`,
    token_endpoint: `${base}/oauth2/token`,
  };
  return endpointsCache;
}

function redirectUri(): string {
  return `${location.origin}${location.pathname}`;
}

export async function beginSignIn(): Promise<void> {
  const endpoints = await discover();
  const pair = await createPkcePair();
  const state = randomUrlToken(16);
  sessionStorage.setItem(
    PENDING_KEY,
    JSON.stringify({ state, codeVerifier: pair.verifier, redirectUri: redirectUri() }),
  );

  const url = new URL(endpoints.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', pair.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  location.assign(url.toString());
}

export function isCallback(): boolean {
  const p = new URLSearchParams(location.search);
  return p.has('code') && p.has('state');
}

async function tokenRequest(endpoint: string, body: URLSearchParams): Promise<TokenSet> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token endpoint ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error('Token response missing access_token');
  return {
    accessToken: json.access_token,
    tokenType: json.token_type ?? 'Bearer',
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    refreshToken: json.refresh_token,
    idToken: json.id_token,
  };
}

export async function completeSignInFromCallback(): Promise<TokenSet> {
  const p = new URLSearchParams(location.search);
  if (p.get('error')) {
    throw new Error(
      `Authorization failed: ${p.get('error')}${p.get('error_description') ? ` — ${p.get('error_description')}` : ''}`,
    );
  }
  const code = p.get('code');
  const state = p.get('state');
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) throw new Error('No pending sign-in (start sign-in on this device first)');
  const pending = JSON.parse(raw) as { state: string; codeVerifier: string; redirectUri: string };
  if (pending.state !== state) throw new Error('State mismatch — aborting for safety');

  const endpoints = await discover();
  const tokens = await tokenRequest(
    endpoints.token_endpoint,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: code ?? '',
      redirect_uri: pending.redirectUri,
      client_id: CLIENT_ID,
      code_verifier: pending.codeVerifier,
    }),
  );
  sessionStorage.removeItem(PENDING_KEY);
  localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  history.replaceState(null, '', location.pathname);
  return tokens;
}

export async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  const endpoints = await discover();
  const next = await tokenRequest(
    endpoints.token_endpoint,
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT_ID }),
  );
  if (!next.refreshToken) next.refreshToken = refreshToken;
  localStorage.setItem(TOKENS_KEY, JSON.stringify(next));
  return next;
}

export function loadTokens(): TokenSet | null {
  const raw = localStorage.getItem(TOKENS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TokenSet;
  } catch {
    return null;
  }
}

export function clearTokens(): void {
  localStorage.removeItem(TOKENS_KEY);
}

export function signOut(tokens: TokenSet | null): void {
  clearTokens();
  if (!tokens?.accessToken) return;
  discover().then((endpoints) => {
    if (!endpoints.revocation_endpoint) return;
    fetch(endpoints.revocation_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: tokens.accessToken, client_id: CLIENT_ID }).toString(),
    }).catch(() => {});
  });
}

export function identityFromTokens(tokens: TokenSet | null): Identity | null {
  const claims = tokens?.idToken ? decodeJwtClaims(tokens.idToken) : null;
  if (!claims) return null;
  const email = typeof claims.email === 'string' ? claims.email : undefined;
  const name = typeof claims.name === 'string' ? claims.name : email;
  return { email, name };
}
