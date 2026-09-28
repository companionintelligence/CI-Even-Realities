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
}

export async function probeHub(rawHost: string): Promise<ProbeResult> {
  const url = agentHubUrl(rawHost);
  try {
    // no-cors: the response is opaque, but a resolved fetch means the host
    // answered — a network-level failure (unreachable host, DNS, refused
    // connection) rejects instead.
    await fetch(url, { mode: 'no-cors' });
    return { ok: true, url };
  } catch {
    return { ok: false, url };
  }
}
