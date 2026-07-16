/**
 * auth.ts
 *
 * Optional CI-Portal OIDC resource-server verification. When enabled, the hub
 * accepts CI-Portal-issued JWTs (in addition to the static HUB_TOKEN) as
 * request authentication — the same trust model the rest of the platform uses
 * (Hub-side services validate Portal tokens against the Portal JWKS).
 *
 * This is a direct port of CI-Server's `PortalTokenService` verify path: `jose`
 * `createRemoteJWKSet` + `jwtVerify`, checking the `iss` and comma-split `aud`
 * (CI-Portal sets `aud === client_id`). CI-Portal signs with EdDSA.
 */

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type KeyLike } from 'jose';
import type { HubConfig } from './config.ts';

export interface VerifyResult {
  ok: boolean;
  sub?: string;
  email?: string;
  error?: string;
}

export interface PortalVerifierOptions {
  enabled: boolean;
  issuer: string;
  jwksUri: string;
  audience: string;
}

export class PortalTokenVerifier {
  private jwks?: JWTVerifyGetKey;
  private readonly audiences: string[];

  /**
   * @param keyOverride Test seam: a fixed key / resolver used instead of the
   *        remote JWKS (so unit tests can verify against a locally-generated
   *        Ed25519 key without network access).
   */
  constructor(
    private readonly opts: PortalVerifierOptions,
    private readonly keyOverride?: KeyLike | Uint8Array | JWTVerifyGetKey
  ) {
    this.audiences = (opts.audience ?? '')
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
  }

  get enabled(): boolean {
    return this.opts.enabled;
  }

  private getKey(): KeyLike | Uint8Array | JWTVerifyGetKey {
    if (this.keyOverride) return this.keyOverride;
    if (!this.jwks) this.jwks = createRemoteJWKSet(new URL(this.opts.jwksUri));
    return this.jwks;
  }

  async verify(token: string): Promise<VerifyResult> {
    if (!this.opts.enabled) return { ok: false, error: 'oidc_disabled' };
    try {
      const { payload } = await jwtVerify(token, this.getKey() as JWTVerifyGetKey, {
        issuer: this.opts.issuer,
        audience: this.audiences.length ? this.audiences : undefined,
      });
      const email =
        typeof (payload as Record<string, unknown>)['email'] === 'string'
          ? ((payload as Record<string, unknown>)['email'] as string)
          : undefined;
      return {
        ok: true,
        sub: typeof payload.sub === 'string' ? payload.sub : undefined,
        email,
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

/** Build a verifier from hub config. */
export function makePortalVerifier(cfg: HubConfig): PortalTokenVerifier {
  return new PortalTokenVerifier({
    enabled: cfg.portalOidcEnabled,
    issuer: cfg.portalIssuer,
    jwksUri: cfg.portalJwksUri,
    audience: cfg.portalAudience,
  });
}
