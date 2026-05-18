/**
 * config.ts
 *
 * Reads hub configuration from environment variables. One process serves one
 * adapter kind — switch by re-launching with a different `AGENT_KIND`.
 */

import type { BackendKind } from './adapters/Adapter.ts';

export interface HubConfig {
  /** Port the HTTP server binds to. */
  port: number;
  /** Bearer token required on requests. Skipped when empty. */
  authToken: string;
  /** Which adapter to load. */
  agentKind: BackendKind;
  /** Downstream URL for `openai` / `local-llm` adapters. */
  downstreamUrl: string;
  /** Downstream auth, if any. */
  downstreamApiKey: string;
  /** Binary name for claude-cli adapter (allows nvm-style overrides). */
  claudeBinary: string;
  /** Binary name for codex-cli adapter. */
  codexBinary: string;
  /** OpenClaw Gateway URL (for openclaw adapter). */
  openclawGatewayUrl: string;
  /** OpenClaw Gateway token. */
  openclawToken: string;
  /** Working directory passed to coding-agent subprocesses. */
  agentCwd: string;
}

const KINDS = new Set<BackendKind>([
  'openai',
  'local-llm',
  'claude-cli',
  'codex-cli',
  'openclaw',
]);

function parseKind(raw: string | undefined): BackendKind {
  if (raw && KINDS.has(raw as BackendKind)) return raw as BackendKind;
  return 'openai';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
  return {
    port: Number(env['HUB_PORT'] ?? 8787),
    authToken: env['HUB_TOKEN'] ?? '',
    agentKind: parseKind(env['AGENT_KIND']),
    downstreamUrl: env['DOWNSTREAM_URL'] ?? 'http://localhost:11434',
    downstreamApiKey: env['DOWNSTREAM_API_KEY'] ?? '',
    claudeBinary: env['CLAUDE_BIN'] ?? 'claude',
    codexBinary: env['CODEX_BIN'] ?? 'codex',
    openclawGatewayUrl: env['OPENCLAW_GATEWAY_URL'] ?? '',
    openclawToken: env['OPENCLAW_TOKEN'] ?? '',
    agentCwd: env['AGENT_CWD'] ?? process.cwd(),
  };
}
