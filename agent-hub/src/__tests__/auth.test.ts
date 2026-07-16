import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, SignJWT, exportJWK, type KeyLike } from 'jose';
import { PortalTokenVerifier } from '../auth.ts';

const ISSUER = 'https://hub.ci.computer';

let privateKey: KeyLike;
let publicKey: KeyLike;

async function mint(
  claims: Record<string, unknown>,
  opts: { issuer?: string; audience?: string; expiresIn?: string } = {}
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? 'ci-hub')
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '5m')
    .sign(privateKey);
}

function verifier(over: Partial<{ enabled: boolean; issuer: string; audience: string }> = {}) {
  return new PortalTokenVerifier(
    {
      enabled: over.enabled ?? true,
      issuer: over.issuer ?? ISSUER,
      jwksUri: 'https://unused.example/jwks',
      audience: over.audience ?? 'ci-hub,ci-even,ci-server',
    },
    publicKey // key override — no network
  );
}

describe('PortalTokenVerifier', () => {
  beforeAll(async () => {
    const kp = await generateKeyPair('EdDSA');
    privateKey = kp.privateKey;
    publicKey = kp.publicKey;
    // sanity: public JWK is exportable (mirrors Portal publishing JWKS)
    await exportJWK(publicKey);
  });

  it('accepts a valid EdDSA token with an allowed audience', async () => {
    const token = await mint({ email: 'ada@ci.co' });
    const res = await verifier().verify(token);
    expect(res.ok).toBe(true);
    expect(res.email).toBe('ada@ci.co');
  });

  it('rejects a token with the wrong issuer', async () => {
    const token = await mint({}, { issuer: 'https://evil.example' });
    const res = await verifier().verify(token);
    expect(res.ok).toBe(false);
  });

  it('rejects a token whose audience is not allowed', async () => {
    const token = await mint({}, { audience: 'some-other-app' });
    const res = await verifier().verify(token);
    expect(res.ok).toBe(false);
  });

  it('accepts any of the comma-separated audiences', async () => {
    const token = await mint({}, { audience: 'ci-even' });
    const res = await verifier().verify(token);
    expect(res.ok).toBe(true);
  });

  it('rejects an expired token', async () => {
    const token = await mint({}, { expiresIn: '-1m' });
    const res = await verifier().verify(token);
    expect(res.ok).toBe(false);
  });

  it('reports not-ok (no throw) when disabled', async () => {
    const token = await mint({});
    const res = await verifier({ enabled: false }).verify(token);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('oidc_disabled');
  });
});
