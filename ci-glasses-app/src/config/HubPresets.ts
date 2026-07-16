/**
 * HubPresets.ts
 *
 * Standardized CI-Hub connection presets. Rather than ask users to hand-type
 * ad-hoc URLs, we derive the canonical service endpoints from a single CI-Hub
 * base host. This mirrors how CI-Hub advertises its inference surface to apps
 * (`CI_LLM_BASE_URL = ${ollama}/v1`, `CI_LLM_API_KEY = 'ollama'`).
 *
 * Topology:
 *  - **Every preset points at the companion `agent-hub`** (default port 8787).
 *    The glasses use ONE baseUrl for chat AND voice (STT posts to
 *    `${baseUrl}/v1/audio/transcriptions`), and the agent-hub now fronts both —
 *    so even the Ollama preset routes through it rather than hitting
 *    Ollama's :11434 `/v1` directly, which would leave STT unreachable.
 *  - **Assistant** is the default experience: `backendKind: 'auto'` lets the
 *    agent-hub route each request by intent (memory · Hermes · OpenClaw · chat).
 *  - **Hermes**, **OpenClaw**, and **Memory** are first-class agent targets
 *    the agent-hub multiplexes by `agent_kind`, holding each target's secret
 *    server-side (Hermes APP_SEED, OpenClaw gateway token, memory API key,
 *    Ollama downstream key). The glasses send one credential (their OIDC/hub
 *    bearer) and pick the target via `backendKind`.
 */

import type { BackendConfig } from './Settings.ts';

export type HubService = 'assistant' | 'ollama' | 'hermes' | 'openclaw' | 'memory';

/** Canonical CI-Hub service ports. */
export const HUB_PORTS = {
  /** Ollama OpenAI-compatible server (`/v1`) — reached via the agent-hub. */
  ollama: 11434,
  /** Companion agent-hub (fronts every preset, incl. STT). */
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
  const agentHubUrl = `${host}:${HUB_PORTS.agentHub}`;
  return [
    {
      // First on purpose — the "just talk to it" default for new users.
      service: 'assistant',
      label: 'Assistant',
      hint: `${agentHubUrl} · auto-routes: memory · Hermes · OpenClaw · chat`,
      patch: {
        baseUrl: agentHubUrl,
        backendKind: 'auto',
        apiMode: 'completions',
        model: 'ci-companion',
      },
    },
    {
      // Routed via agent-hub (not Ollama's :11434 directly): the glasses use
      // ONE baseUrl for chat AND voice (STT), and the agent-hub now fronts
      // both. The hub injects its own downstream Ollama key, so the preset no
      // longer needs to overwrite the user's apiKey with 'ollama'.
      service: 'ollama',
      label: 'Ollama',
      hint: `${agentHubUrl} · via agent-hub · Ollama on your Hub`,
      patch: {
        baseUrl: agentHubUrl,
        backendKind: 'local-llm',
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
