/**
 * OidcClient.ts
 *
 * Issuer-agnostic OpenID Connect client for the "Sign in with Companion
 * Intelligence" flow. CI-Portal is a Better-Auth `oidcProvider` (PKCE
 * mandatory, EdDSA-signed JWTs). Because the Even Hub SDK cannot open an
 * external browser, we run the Authorization-Code + PKCE flow *inside the phone
 * WebView* via a full-page redirect, then complete the code exchange when the
 * app reloads at the redirect URI with `?code=&state=`.
 *
 * Endpoints are resolved from the provider's discovery document
 * (`/.well-known/openid-configuration`); if discovery is unreachable we fall
 * back to Better-Auth's well-known route layout under the configured base URL.
 *
 * The client holds no secret (public client) — safe for a shippable web
 * bundle. See notes/even-realities-resources.md §"Security model".
 */

import { createPkcePair, randomUrlToken } from './pkce.ts';
import type { StoragePort } from './StoragePort.ts';

export interface OidcConfig {
  /**
   * Provider base URL. For CI-Portal this is the Better-Auth mount, e.g.
   * `https://hub.ci.computer/api/auth`. Discovery + endpoint fallbacks are
   * derived from it.
   */
  issuer: string;
  clientId: string;
  scope: string;
  /** Redirect URI; defaults to the app's own origin+path at call time. */
  redirectUri?: string;
}

export interface OidcEndpoints {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
  end_session_endpoint?: string;
  revocation_endpoint?: string;
}

export interface TokenSet {
  accessToken: string;
  tokenType: string;
  /** Absolute expiry (epoch ms), derived from `expires_in`. */
  expiresAt: number;
  refreshToken?: string;
  idToken?: string;
  scope?: string;
}

/** Transient record persisted across the authorize redirect. */
interface PendingAuth {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
}

const PENDING_KEY = 'ci-oidc-pending';

export class OidcClient {
  private endpoints?: OidcEndpoints;

  constructor(
    private config: OidcConfig,
    private storage: StoragePort,
    private fetchImpl: typeof fetch = (...a) => fetch(...a)
  ) {}

  updateConfig(config: OidcConfig): void {
    this.config = config;
    this.endpoints = undefined; // re-discover against the new issuer
  }

  /** Default redirect URI = the app's own URL without query/hash. */
  private defaultRedirectUri(): string {
    if (typeof location === 'undefined') return this.config.redirectUri ?? '';
    return this.config.redirectUri ?? `${location.origin}${location.pathname}`;
  }

  /**
   * Resolve the provider endpoints from the discovery document, caching the
   * result. Falls back to Better-Auth's conventional route layout when the
   * document can't be fetched (e.g. offline dev against a bare mount).
   */
  async discover(): Promise<OidcEndpoints> {
    if (this.endpoints) return this.endpoints;
    const base = this.config.issuer.replace(/\/+$/, '');
    const url = `${base}/.well-known/openid-configuration`;
    try {
      const res = await this.fetchImpl(url, {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const doc = (await res.json()) as Partial<OidcEndpoints>;
        if (doc.authorization_endpoint && doc.token_endpoint) {
          this.endpoints = {
            issuer: doc.issuer ?? base,
            authorization_endpoint: doc.authorization_endpoint,
            token_endpoint: doc.token_endpoint,
            userinfo_endpoint: doc.userinfo_endpoint,
            jwks_uri: doc.jwks_uri,
            end_session_endpoint: doc.end_session_endpoint,
            revocation_endpoint: doc.revocation_endpoint,
          };
          return this.endpoints;
        }
      }
    } catch {
      // fall through to conventional layout
    }
    this.endpoints = {
      issuer: base,
      authorization_endpoint: `${base}/oauth2/authorize`,
      token_endpoint: `${base}/oauth2/token`,
      userinfo_endpoint: `${base}/oauth2/userinfo`,
      jwks_uri: `${base}/jwks`,
    };
    return this.endpoints;
  }

  /**
   * Begin login: persist a PKCE + state record and return the authorize URL.
   * Callers navigate the WebView to it (see {@link redirectToLogin}).
   */
  async createAuthorizeUrl(): Promise<string> {
    const endpoints = await this.discover();
    const { verifier, challenge } = await createPkcePair();
    const state = randomUrlToken(16);
    const redirectUri = this.defaultRedirectUri();

    const pending: PendingAuth = {
      state,
      codeVerifier: verifier,
      redirectUri,
      createdAt: Date.now(),
    };
    await this.storage.set(PENDING_KEY, JSON.stringify(pending));

    const url = new URL(endpoints.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', this.config.scope);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  /** Convenience: begin login and navigate the current WebView to the IdP. */
  async redirectToLogin(): Promise<void> {
    const url = await this.createAuthorizeUrl();
    if (typeof location !== 'undefined') location.assign(url);
  }

  /** True when the current URL looks like an OIDC redirect callback. */
  static isCallback(search: string): boolean {
    const p = new URLSearchParams(search);
    return p.has('code') && p.has('state');
  }

  /**
   * Complete login from a redirect. Accepts a raw query string, a full URL, or
   * an already-parsed `{ code, state }`. Validates state against the persisted
   * PKCE record and exchanges the code for tokens.
   */
  async completeLoginFromRedirect(
    input: string | { code: string; state: string }
  ): Promise<TokenSet> {
    let code: string | null;
    let state: string | null;
    if (typeof input === 'string') {
      const qs = input.includes('?') ? input.slice(input.indexOf('?') + 1) : input;
      const p = new URLSearchParams(qs);
      if (p.get('error')) {
        throw new Error(
          `Authorization failed: ${p.get('error')}${
            p.get('error_description') ? ` — ${p.get('error_description')}` : ''
          }`
        );
      }
      code = p.get('code');
      state = p.get('state');
    } else {
      code = input.code;
      state = input.state;
    }
    if (!code || !state) throw new Error('Missing code/state in redirect');

    const raw = await this.storage.get(PENDING_KEY);
    if (!raw) throw new Error('No pending login (start sign-in on this device first)');
    const pending = JSON.parse(raw) as PendingAuth;
    if (pending.state !== state) throw new Error('State mismatch — aborting for safety');

    const tokens = await this.exchangeCode(code, pending.codeVerifier, pending.redirectUri);
    await this.storage.remove(PENDING_KEY);
    return tokens;
  }

  private async exchangeCode(
    code: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<TokenSet> {
    const endpoints = await this.discover();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: this.config.clientId,
      code_verifier: codeVerifier,
    });
    return this.tokenRequest(endpoints.token_endpoint, body);
  }

  /** Exchange a refresh token for a fresh token set. */
  async refresh(refreshToken: string): Promise<TokenSet> {
    const endpoints = await this.discover();
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
    });
    const next = await this.tokenRequest(endpoints.token_endpoint, body);
    // Providers may omit a rotated refresh token; keep the old one if so.
    if (!next.refreshToken) next.refreshToken = refreshToken;
    return next;
  }

  private async tokenRequest(
    endpoint: string,
    body: URLSearchParams
  ): Promise<TokenSet> {
    const res = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Token endpoint ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      access_token: string;
      token_type?: string;
      expires_in?: number;
      refresh_token?: string;
      id_token?: string;
      scope?: string;
    };
    if (!json.access_token) throw new Error('Token response missing access_token');
    const expiresInMs = (json.expires_in ?? 3600) * 1000;
    return {
      accessToken: json.access_token,
      tokenType: json.token_type ?? 'Bearer',
      expiresAt: Date.now() + expiresInMs,
      refreshToken: json.refresh_token,
      idToken: json.id_token,
      scope: json.scope,
    };
  }

  /** Fetch OIDC userinfo with the given access token. */
  async fetchUserInfo(accessToken: string): Promise<Record<string, unknown> | null> {
    const endpoints = await this.discover();
    if (!endpoints.userinfo_endpoint) return null;
    try {
      const res = await this.fetchImpl(endpoints.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (!res.ok) return null;
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /** Best-effort token revocation; ignores provider errors. */
  async revoke(token: string): Promise<void> {
    const endpoints = await this.discover();
    if (!endpoints.revocation_endpoint) return;
    try {
      await this.fetchImpl(endpoints.revocation_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token, client_id: this.config.clientId }).toString(),
      });
    } catch {
      // ignore
    }
  }
}
