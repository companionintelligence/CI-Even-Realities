/** PKCE (RFC 7636) helpers, mirroring ci-glasses-app/src/auth/pkce.ts. */

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return atob(padded + pad);
}

export function randomUrlToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

export async function s256Challenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomUrlToken(32);
  const challenge = await s256Challenge(verifier);
  return { verifier, challenge };
}

export function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(base64UrlDecode(parts[1]!)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
