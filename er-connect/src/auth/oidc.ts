/**
 * Sign in with Companion Intelligence — Authorization Code + PKCE against
 * CI-Portal, mirroring ci-glasses-app/src/auth/OidcClient.ts. See README.md
 * for the CLIENT_ID registration prerequisite.
 */
import { createPkcePair, randomUrlToken, decodeJwtClaims } from './pkce';
import { storageGet, storageRemove, storageSet } from '../lib/storage';

export const ISSUER = 'https://hub.ci.computer/api/auth';
export const CLIENT_ID = 'ci-er-connect';
// No `offline_access`: this page only shows who is signed in, so it never needs
// a long-lived refresh token sitting in the browser next to third-party analytics.
export const SCOPE = 'openid email profile';

// Tokens live in sessionStorage (this tab only), not localStorage: they are
// bearer credentials, and this origin also runs Google's tag when analytics is
// enabled. Closing the tab signs out; the Hub address is remembered separately.
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
  const stored = storageSet(
    'session',
    PENDING_KEY,
    JSON.stringify({ state, codeVerifier: pair.verifier, redirectUri: redirectUri() }),
  );
  if (!stored) {
    throw new Error(
      "This browser is blocking storage, so sign-in can't continue. Allow site data for this page and try again.",
    );
  }

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

/**
 * A redirect back from the issuer: `state` plus either `code` (success) or
 * `error` (the user denied consent, or the request was rejected). An error
 * redirect carries no `code`, so requiring one would hide the failure.
 */
export function isCallback(): boolean {
  const p = new URLSearchParams(location.search);
  return p.has('state') && (p.has('code') || p.has('error'));
}

async function tokenRequest(endpoint: string, body: URLSearchParams): Promise<TokenSet> {
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    });
  } catch {
    // fetch() rejects with an opaque TypeError for offline, DNS, TLS and blocked-by-CORS alike.
    throw new Error(
      "Couldn't reach the Companion Intelligence sign-in service from this page. Check your connection and try again. If it keeps failing, ask on Discord.",
    );
  }
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
  const error = p.get('error');
  const code = p.get('code');
  const state = p.get('state');
  const raw = storageGet('session', PENDING_KEY);

  // Whatever happens next, the one-time code, state and error must not stay in
  // the address bar (a reload would replay them), and the PKCE material is spent.
  history.replaceState(null, '', location.pathname);
  storageRemove('session', PENDING_KEY);

  if (error) {
    const description = p.get('error_description');
    throw new Error(`Authorization failed: ${error}${description ? ` — ${description}` : ''}`);
  }
  if (!raw) throw new Error('No pending sign-in (start sign-in on this device first)');
  let pending: { state: string; codeVerifier: string; redirectUri: string };
  try {
    pending = JSON.parse(raw);
  } catch {
    throw new Error('Sign-in state was unreadable. Start sign-in again.');
  }
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
  storageSet('session', TOKENS_KEY, JSON.stringify(tokens));
  return tokens;
}

export async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  const endpoints = await discover();
  const next = await tokenRequest(
    endpoints.token_endpoint,
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT_ID }),
  );
  if (!next.refreshToken) next.refreshToken = refreshToken;
  storageSet('session', TOKENS_KEY, JSON.stringify(next));
  return next;
}

export function loadTokens(): TokenSet | null {
  const raw = storageGet('session', TOKENS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TokenSet;
  } catch {
    return null;
  }
}

export function clearTokens(): void {
  storageRemove('session', TOKENS_KEY);
  // Tokens used to live in localStorage; drop any left behind by an earlier version.
  storageRemove('local', TOKENS_KEY);
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
