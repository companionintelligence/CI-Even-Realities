/**
 * CI-Hub quick-connect, mirroring ci-glasses-app/src/config/HubPresets.ts.
 * Every service routes through the same agent-hub endpoint (:8787) — presets
 * differ only by the backendKind/model sent in requests, not the URL.
 */

export const HUB_PORT = 8787;

export const PRESETS = [
  { label: 'Assistant', kind: 'auto', model: 'ci-companion' },
  { label: 'Ollama', kind: 'local-llm', model: 'llama3.2' },
  { label: 'Hermes', kind: 'hermes', model: 'hermes-agent' },
  { label: 'OpenClaw', kind: 'openclaw', model: 'openclaw/default' },
  { label: 'Memory', kind: 'memory', model: 'ci-memory' },
] as const;

export const HUB_URL_KEY = 'er-connect:hub-url';

export function hubHost(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return 'http://localhost';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const u = new URL(withScheme);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return 'http://localhost';
  }
}

export function agentHubUrl(raw: string): string {
  return `${hubHost(raw)}:${HUB_PORT}`;
}

export interface ProbeResult {
  ok: boolean;
  url: string;
  /**
   * True when a failure says nothing about the hub: the browser refuses (or gates)
   * plain-http requests from an https page, so "couldn't fetch" ≠ "unreachable".
   */
  blocked?: boolean;
}

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i;

/** Is this a plain-http target being fetched from an https page? */
export function isMixedContent(url: string, pageProtocol: string): boolean {
  if (pageProtocol !== 'https:') return false;
  try {
    return new URL(url).protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * An agent-hub on a LAN / Tailscale / `.local` address is plain http on :8787, and browsers
 * refuse plain-http requests from an https page (mixed content) — so from
 * https://er.ci.computer "unreachable" and "reachable but forbidden" look identical.
 * Measured 2026-09-28 against the live site with a server answering on every address: the
 * same `fetch(..., {mode:'no-cors'})` resolved from an http page, and rejected from
 * er.ci.computer for a LAN IP, 127.0.0.1 and localhost alike (loopback is exempt from
 * mixed-content rules, but Chrome's Local Network Access gate can still deny it).
 * So: non-loopback http is never fetched; loopback is tried and only a *success* is
 * trusted. Everything else is reported as unverified, not as an error.
 */
export async function probeHub(
  rawHost: string,
  pageProtocol: string = window.location.protocol,
): Promise<ProbeResult> {
  const url = agentHubUrl(rawHost);
  const mixed = isMixedContent(url, pageProtocol);
  if (mixed && !LOOPBACK.test(new URL(url).hostname)) return { ok: false, url, blocked: true };
  try {
    // no-cors: the response is opaque, but a resolved fetch means the host
    // answered — a network-level failure (unreachable host, DNS, refused
    // connection) rejects instead.
    await fetch(url, { mode: 'no-cors' });
    return { ok: true, url };
  } catch {
    return { ok: false, url, blocked: mixed };
  }
}
