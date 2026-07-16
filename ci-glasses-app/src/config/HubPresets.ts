/**
 * HubPresets.ts
 *
 * Standardized CI-Hub connection presets. Rather than ask users to hand-type
 * ad-hoc URLs, we derive the canonical service endpoints from a single CI-Hub
 * base host. This mirrors how CI-Hub advertises its inference surface to apps
 * (`CI_LLM_BASE_URL = ${ollama}/v1`, `CI_LLM_API_KEY = 'ollama'`).
 *
 * Topology:
 *  - **Ollama** is the only OpenAI-compatible `/v1` endpoint, on port 11434.
 *    The app appends `/v1/...` itself, so a preset's `baseUrl` stops at the port.
 *    It may be reached directly (no secret needed).
 *  - **Hermes**, **OpenClaw**, and **Memory** are first-class agent targets
 *    reached *through the companion `agent-hub`* (default port 8787), which
 *    multiplexes by `agent_kind` and holds each target's secret server-side
 *    (Hermes APP_SEED, OpenClaw gateway token, memory API key). The glasses send
 *    one credential (their OIDC/hub bearer) and pick the target via `backendKind`.
 */

import type { BackendConfig } from './Settings.ts';

export type HubService = 'ollama' | 'hermes' | 'openclaw' | 'memory';

/** Canonical CI-Hub service ports. */
export const HUB_PORTS = {
  /** Ollama OpenAI-compatible server (`/v1`). */
  ollama: 11434,
  /** Companion agent-hub (routes `openclaw` / coding-agent kinds). */
  agentHub: 8787,
} as const;

export interface HubPreset {
  service: HubService;
  label: string;
  hint: string;
  /** Partial config to merge over the current settings. */
  patch: Partial<BackendConfig>;
}

/**
 * Normalize a Hub base URL to `scheme://host` (no port, no trailing slash).
 * Accepts bare hosts ("ci-hub.local"), full URLs, and IPs; defaults to http
 * (the CI tailnet has no HTTPS — see core-1 deploy notes).
 */
export function hubHost(hubBaseUrl: string): string {
  const trimmed = (hubBaseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return 'http://localhost';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  try {
    const u = new URL(withScheme);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return 'http://localhost';
  }
}

/** Build the standardized presets for a given Hub base host. */
export function hubPresets(hubBaseUrl: string): HubPreset[] {
  const host = hubHost(hubBaseUrl);
  const ollamaUrl = `${host}:${HUB_PORTS.ollama}`;
  const agentHubUrl = `${host}:${HUB_PORTS.agentHub}`;
  return [
    {
      service: 'ollama',
      label: 'Ollama',
      hint: `${ollamaUrl}/v1 · local model on your Hub`,
      patch: {
        baseUrl: ollamaUrl,
        backendKind: 'local-llm',
        apiKey: 'ollama',
        apiMode: 'completions',
        model: 'llama3.2',
      },
    },
    {
      service: 'hermes',
      label: 'Hermes',
      hint: `${agentHubUrl} · Hermes agent via agent-hub`,
      patch: {
        baseUrl: agentHubUrl,
        backendKind: 'hermes',
        apiMode: 'completions',
        model: 'hermes-agent',
      },
    },
    {
      service: 'openclaw',
      label: 'OpenClaw',
      hint: `${agentHubUrl} · OpenClaw agent via agent-hub`,
      patch: {
        baseUrl: agentHubUrl,
        backendKind: 'openclaw',
        apiMode: 'completions',
        model: 'openclaw/default',
      },
    },
    {
      service: 'memory',
      label: 'Memory',
      hint: `${agentHubUrl} · recall from Companion Memory (CI-Server)`,
      patch: {
        baseUrl: agentHubUrl,
        backendKind: 'memory',
        apiMode: 'completions',
        model: 'ci-memory',
      },
    },
  ];
}

/**
 * Return a new config with the chosen Hub service preset applied over `cfg`.
 * Fields not present in the preset patch (systemPrompt, streaming, auth, …) are
 * preserved.
 */
export function applyHubPreset(
  cfg: BackendConfig,
  service: HubService,
  hubBaseUrl: string
): BackendConfig {
  const preset = hubPresets(hubBaseUrl).find((p) => p.service === service);
  if (!preset) return { ...cfg };
  return { ...cfg, ...preset.patch };
}
