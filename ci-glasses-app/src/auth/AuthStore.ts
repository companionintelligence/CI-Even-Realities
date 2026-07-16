/**
 * AuthStore.ts
 *
 * Owns the persisted OIDC session for the glasses app: the current token set
 * plus the signed-in identity derived from the id_token. Persists through a
 * swappable {@link StoragePort} so tokens survive app relaunches (bridge
 * storage on-device, localStorage in browser/simulator mode).
 *
 * `getValidAccessToken()` transparently refreshes when the access token is
 * near expiry, de-duplicating concurrent refreshes so a burst of requests
 * triggers a single token call.
 */

import type { OidcClient, TokenSet } from './OidcClient.ts';
import type { StoragePort } from './StoragePort.ts';
import { decodeJwtClaims } from './pkce.ts';

export interface Identity {
  sub?: string;
  email?: string;
  name?: string;
}

const TOKENS_KEY = 'ci-oidc-tokens';
/** Refresh this many ms before the hard expiry to avoid edge races. */
const REFRESH_SKEW_MS = 60_000;

export class AuthStore {
  private tokens?: TokenSet;
  private identity: Identity = {};
  private loaded = false;
  private refreshInFlight?: Promise<string | undefined>;

  constructor(
    private client: OidcClient,
    private storage: StoragePort
  ) {}

  /**
   * Point the store at a different backing store. If a session is already
   * loaded it is written through; otherwise we (re)load from the new store —
   * this is how an on-device launch picks up tokens saved to bridge storage on
   * a previous run after starting on localStorage.
   */
  async useStorage(storage: StoragePort): Promise<void> {
    this.storage = storage;
    if (this.tokens) {
      await this.persist();
    } else {
      this.loaded = false;
      await this.load();
    }
  }

  /** Load persisted tokens (idempotent). */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const raw = await this.storage.get(TOKENS_KEY);
    if (!raw) return;
    try {
      this.tokens = JSON.parse(raw) as TokenSet;
      this.deriveIdentity();
    } catch {
      this.tokens = undefined;
    }
  }

  isSignedIn(): boolean {
    return !!this.tokens;
  }

  getIdentity(): Identity {
    return { ...this.identity };
  }

  /** Adopt a freshly-obtained token set (e.g. after the redirect exchange). */
  async signIn(tokens: TokenSet): Promise<void> {
    this.tokens = tokens;
    this.loaded = true;
    this.deriveIdentity();
    await this.persist();
  }

  async signOut(): Promise<void> {
    const token = this.tokens?.accessToken;
    this.tokens = undefined;
    this.identity = {};
    await this.storage.remove(TOKENS_KEY);
    if (token) await this.client.revoke(token);
  }

  /**
   * Return a usable access token, refreshing first when it is expired or within
   * the skew window. Returns undefined when signed out or refresh fails.
   */
  async getValidAccessToken(): Promise<string | undefined> {
    await this.load();
    if (!this.tokens) return undefined;
    if (Date.now() < this.tokens.expiresAt - REFRESH_SKEW_MS) {
      return this.tokens.accessToken;
    }
    return this.forceRefresh();
  }

  /**
   * Force a refresh (used on a 401). De-dupes concurrent callers. Returns the
   * new access token, or undefined if no refresh token / refresh failed (in
   * which case the session is cleared so the UI can prompt re-login).
   */
  async forceRefresh(): Promise<string | undefined> {
    // Guard BEFORE any await so concurrent callers share one refresh. The
    // load() below only awaits on a cold store, by which point the guard has
    // already been re-checked.
    if (this.refreshInFlight) return this.refreshInFlight;
    if (!this.loaded) await this.load();
    if (this.refreshInFlight) return this.refreshInFlight;
    const refreshToken = this.tokens?.refreshToken;
    if (!refreshToken) return undefined;

    this.refreshInFlight = (async () => {
      try {
        const next = await this.client.refresh(refreshToken);
        this.tokens = next;
        this.deriveIdentity();
        await this.persist();
        return next.accessToken;
      } catch {
        // Refresh failed — treat the session as dead.
        this.tokens = undefined;
        this.identity = {};
        await this.storage.remove(TOKENS_KEY);
        return undefined;
      } finally {
        this.refreshInFlight = undefined;
      }
    })();
    return this.refreshInFlight;
  }

  private deriveIdentity(): void {
    const claims = this.tokens?.idToken ? decodeJwtClaims(this.tokens.idToken) : null;
    if (!claims) {
      this.identity = {};
      return;
    }
    this.identity = {
      sub: typeof claims['sub'] === 'string' ? claims['sub'] : undefined,
      email: typeof claims['email'] === 'string' ? claims['email'] : undefined,
      name:
        (typeof claims['name'] === 'string' && claims['name']) ||
        (typeof claims['email'] === 'string' && claims['email']) ||
        undefined,
    };
  }

  private async persist(): Promise<void> {
    if (!this.tokens) return;
    await this.storage.set(TOKENS_KEY, JSON.stringify(this.tokens));
  }
}
