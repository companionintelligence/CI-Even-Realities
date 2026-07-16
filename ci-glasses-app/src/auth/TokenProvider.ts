/**
 * TokenProvider.ts
 *
 * Abstracts "what bearer token do I send?" so the AI/STT clients don't care
 * whether auth is a static API key or a live OIDC session. `authedFetch`
 * resolves the bearer, performs the request, and — for providers that support
 * it — refreshes once and retries on a 401.
 */

import type { AuthStore } from './AuthStore.ts';

export interface TokenProvider {
  /** The bearer to send, or undefined to send no Authorization header. */
  getBearer(): Promise<string | undefined>;
  /**
   * Called after a 401. Returns true if a fresh bearer is now available and the
   * request is worth retrying. Optional — static keys can't refresh.
   */
  onUnauthorized?(): Promise<boolean>;
}

/** Static API-key provider (legacy "paste your key" mode). */
export class StaticKeyProvider implements TokenProvider {
  constructor(private getKey: () => string) {}
  async getBearer(): Promise<string | undefined> {
    const key = this.getKey();
    return key ? key : undefined;
  }
}

/** OIDC provider backed by the {@link AuthStore} (auto-refreshing). */
export class OidcTokenProvider implements TokenProvider {
  constructor(private store: AuthStore) {}
  async getBearer(): Promise<string | undefined> {
    return this.store.getValidAccessToken();
  }
  async onUnauthorized(): Promise<boolean> {
    const token = await this.store.forceRefresh();
    return !!token;
  }
}

/**
 * Perform an authorized request. `doFetch` receives the resolved bearer (or
 * undefined) and must build + send the request; on a 401 the provider is asked
 * to refresh and, if it can, `doFetch` is retried exactly once.
 */
export async function authedFetch(
  provider: TokenProvider | undefined,
  fallbackKey: string | undefined,
  doFetch: (bearer: string | undefined) => Promise<Response>
): Promise<Response> {
  let bearer = (await provider?.getBearer()) ?? (fallbackKey || undefined);
  const res = await doFetch(bearer);
  if (res.status !== 401 || !provider?.onUnauthorized) return res;
  const refreshed = await provider.onUnauthorized();
  if (!refreshed) return res;
  bearer = (await provider.getBearer()) ?? bearer;
  return doFetch(bearer);
}
