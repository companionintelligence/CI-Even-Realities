import { describe, it, expect } from 'vitest';
import { hubHost, hubPresets, applyHubPreset, HUB_PORTS } from '../HubPresets.ts';
import type { BackendConfig } from '../Settings.ts';

const BASE: BackendConfig = {
  baseUrl: 'http://localhost:8080',
  apiKey: 'old-key',
  model: 'old-model',
  backendKind: 'openai',
  apiMode: 'auto',
  systemPrompt: 'stay',
  streaming: true,
  storeContext: true,
  sttProvider: 'whisper',
  ttsEnabled: false,
  maxHistoryMessages: 20,
  authMode: 'apiKey',
  oidcIssuer: 'https://hub.ci.computer/api/auth',
  oidcClientId: 'ci-hub',
  oidcScope: 'openid email profile offline_access',
  hubBaseUrl: 'http://ci-hub.local',
  useMemory: false,
};

describe('hubHost', () => {
  it('normalizes bare hosts, URLs, ports, and trailing slashes', () => {
    expect(hubHost('ci-hub.local')).toBe('http://ci-hub.local');
    expect(hubHost('http://ci-hub.local/')).toBe('http://ci-hub.local');
    expect(hubHost('http://ci-hub.local:5002')).toBe('http://ci-hub.local');
    expect(hubHost('https://hub.ci.computer')).toBe('https://hub.ci.computer');
    expect(hubHost('100.124.211.75')).toBe('http://100.124.211.75');
    expect(hubHost('')).toBe('http://localhost');
  });
});

describe('hubPresets', () => {
  it('derives canonical Assistant / Ollama / Hermes / OpenClaw endpoints', () => {
    const presets = hubPresets('http://ci-hub.local');
    const byService = Object.fromEntries(presets.map((p) => [p.service, p]));

    // Assistant — the auto-routing default, listed first.
    expect(presets[0].service).toBe('assistant');
    expect(byService.assistant.label).toBe('Assistant');
    expect(byService.assistant.patch.baseUrl).toBe(`http://ci-hub.local:${HUB_PORTS.agentHub}`);
    expect(byService.assistant.patch.backendKind).toBe('auto');
    expect(byService.assistant.patch.apiMode).toBe('completions');
    expect(byService.assistant.patch.model).toBe('ci-companion');

    // Ollama — one baseUrl for chat AND voice, so it too routes via agent-hub.
    // The hub injects its own downstream Ollama key; the preset must not
    // clobber the user's apiKey with 'ollama' anymore.
    expect(byService.ollama.patch.baseUrl).toBe(`http://ci-hub.local:${HUB_PORTS.agentHub}`);
    expect(byService.ollama.patch.backendKind).toBe('local-llm');
    expect(byService.ollama.patch.model).toBe('llama3.2');
    expect(byService.ollama.patch.apiKey).toBeUndefined();

    // Hermes — real agent, brokered by agent-hub.
    expect(byService.hermes.patch.baseUrl).toBe(`http://ci-hub.local:${HUB_PORTS.agentHub}`);
    expect(byService.hermes.patch.backendKind).toBe('hermes');
    expect(byService.hermes.patch.model).toBe('hermes-agent');

    // OpenClaw — agent gateway via agent-hub; model is the agent target.
    expect(byService.openclaw.patch.baseUrl).toBe(`http://ci-hub.local:${HUB_PORTS.agentHub}`);
    expect(byService.openclaw.patch.backendKind).toBe('openclaw');
    expect(byService.openclaw.patch.model).toBe('openclaw/default');

    // Memory — CI-Server recall via agent-hub.
    expect(byService.memory.patch.baseUrl).toBe(`http://ci-hub.local:${HUB_PORTS.agentHub}`);
    expect(byService.memory.patch.backendKind).toBe('memory');
  });
});

describe('applyHubPreset', () => {
  it('merges the preset over config, preserving unrelated fields', () => {
    const next = applyHubPreset(BASE, 'ollama', 'http://ci-hub.local');
    expect(next.baseUrl).toBe('http://ci-hub.local:8787');
    expect(next.backendKind).toBe('local-llm');
    // preserved — agent-hub injects its own downstream Ollama key
    expect(next.apiKey).toBe('old-key');
    expect(next.systemPrompt).toBe('stay');
    expect(next.oidcClientId).toBe('ci-hub');
  });

  it('applies the Assistant preset (auto-routing via agent-hub)', () => {
    const next = applyHubPreset(BASE, 'assistant', 'http://ci-hub.local');
    expect(next.baseUrl).toBe('http://ci-hub.local:8787');
    expect(next.backendKind).toBe('auto');
    expect(next.apiMode).toBe('completions');
    expect(next.model).toBe('ci-companion');
    // preserved
    expect(next.apiKey).toBe('old-key');
    expect(next.useMemory).toBe(false);
  });

  it('preserves the API key for the OpenClaw preset (routed via agent-hub)', () => {
    const next = applyHubPreset(BASE, 'openclaw', 'http://ci-hub.local');
    expect(next.backendKind).toBe('openclaw');
    expect(next.apiKey).toBe('old-key');
  });
});
