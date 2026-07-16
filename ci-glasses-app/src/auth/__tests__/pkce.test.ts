import { describe, it, expect } from 'vitest';
import {
  base64UrlEncode,
  base64UrlDecode,
  randomUrlToken,
  s256Challenge,
  createPkcePair,
  decodeJwtClaims,
} from '../pkce.ts';

describe('pkce / base64url helpers', () => {
  it('round-trips base64url encode/decode', () => {
    const text = 'hello, world! 🙂';
    const bytes = new TextEncoder().encode(text);
    const enc = base64UrlEncode(bytes);
    expect(enc).not.toMatch(/[+/=]/); // url-safe, unpadded
    expect(base64UrlDecode(enc)).toBe(
      String.fromCharCode(...bytes)
    );
  });

  it('produces the RFC 7636 Appendix B S256 challenge', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = await s256Challenge(verifier);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('createPkcePair verifier hashes to its challenge', async () => {
    const { verifier, challenge } = await createPkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(await s256Challenge(verifier)).toBe(challenge);
  });

  it('randomUrlToken is url-safe and non-repeating', () => {
    const a = randomUrlToken(16);
    const b = randomUrlToken(16);
    expect(a).not.toMatch(/[+/=]/);
    expect(a).not.toBe(b);
  });

  it('decodeJwtClaims reads the payload without verifying', () => {
    const payload = { sub: 'user-1', email: 'a@b.co', name: 'Ada' };
    const seg = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
    const jwt = `h.${seg}.sig`;
    expect(decodeJwtClaims(jwt)).toEqual(payload);
  });

  it('decodeJwtClaims returns null for garbage', () => {
    expect(decodeJwtClaims('not-a-jwt')).toBeNull();
  });
});
