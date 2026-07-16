/**
 * pkce.ts
 *
 * PKCE (RFC 7636) helpers plus small base64url / JWT-decode utilities, built
 * on Web Crypto so they run in the Even Hub WebView, the simulator, and jsdom
 * (Node's `crypto.subtle` / `crypto.getRandomValues`) without dependencies.
 */

/** Base64url-encode raw bytes (no padding). */
export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Base64url-decode to a UTF-8 string. */
export function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return atob(padded + pad);
}

/** Cryptographically-random base64url string from `bytes` random bytes. */
export function randomUrlToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

/** SHA-256 → base64url, i.e. the S256 code_challenge for a verifier. */
export async function s256Challenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

/** Generate a `{ verifier, challenge }` PKCE pair (S256). */
export async function createPkcePair(): Promise<{
  verifier: string;
  challenge: string;
}> {
  const verifier = randomUrlToken(32);
  const challenge = await s256Challenge(verifier);
  return { verifier, challenge };
}

/**
 * Decode (WITHOUT verifying) the payload claims of a JWT. Used only to display
 * the signed-in identity (name / email) from an id_token; the access token is
 * verified server-side by the resource server (agent-hub / CI-Server), never
 * here.
 */
export function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(base64UrlDecode(parts[1]!)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
