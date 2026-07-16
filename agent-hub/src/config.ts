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
  /**
   * Interface to bind on. When the user hasn't set HUB_BIND explicitly we
   * default to `127.0.0.1` for safety: an empty `HUB_TOKEN` would otherwise
   * leave the hub exposed to any client on the LAN. Set `HUB_BIND=0.0.0.0`
   * (or a specific interface) once you've configured `HUB_TOKEN` to use the
   * hub over the network / Tailscale.
   */
  bind: string;
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

  // ── CI-Portal OIDC resource-server ────────────────────────────────────────
  /** When true, accept CI-Portal-issued JWTs (verified via JWKS) as auth. */
  portalOidcEnabled: boolean;
  /** Expected `iss` claim, e.g. `https://hub.ci.computer`. */
  portalIssuer: string;
  /** JWKS endpoint used to verify token signatures (EdDSA). */
  portalJwksUri: string;
  /** Comma-separated allowed `aud` values (CI-Portal sets aud === client_id). */
  portalAudience: string;
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
  const authToken = env['HUB_TOKEN'] ?? '';
  // Safe default: bind loopback when no token is set. Caller can opt in to
  // LAN/Tailscale exposure with HUB_BIND once a token is configured.
  const explicitBind = env['HUB_BIND'];
  const bind = explicitBind ?? (authToken ? '0.0.0.0' : '127.0.0.1');

  // Canonical CI-Hub inference env vars (see CI-Hub inference-env-resolver):
  // `CI_LLM_BASE_URL` is `${ollama}/v1`; the passthrough adapter appends
  // `/v1/...` itself, so strip a trailing `/v1` when using it as downstream.
  const ciLlmBase = env['CI_LLM_BASE_URL'];
  const downstreamUrl =
    env['DOWNSTREAM_URL'] ??
    (ciLlmBase ? ciLlmBase.replace(/\/v1\/?$/, '') : 'http://localhost:11434');
  const downstreamApiKey =
    env['DOWNSTREAM_API_KEY'] ?? env['CI_LLM_API_KEY'] ?? '';

  // Portal OIDC verification. Issuer/JWKS default to CI-Portal prod and match
  // CI-Server's PortalTokenService defaults so tokens verify identically.
  const portalIssuer =
    env['PORTAL_OIDC_ISSUER'] ?? env['CI_CLOUD_URL'] ?? 'https://hub.ci.computer';
  const portalJwksUri =
    env['PORTAL_OIDC_JWKS_URI'] ??
    `${portalIssuer.replace(/\/+$/, '')}/api/auth/jwks`;

  return {
    port: Number(env['HUB_PORT'] ?? 8787),
    bind,
    authToken,
    agentKind: parseKind(env['AGENT_KIND']),
    downstreamUrl,
    downstreamApiKey,
    claudeBinary: env['CLAUDE_BIN'] ?? 'claude',
    codexBinary: env['CODEX_BIN'] ?? 'codex',
    openclawGatewayUrl: env['OPENCLAW_GATEWAY_URL'] ?? '',
    openclawToken: env['OPENCLAW_TOKEN'] ?? '',
    agentCwd: env['AGENT_CWD'] ?? process.cwd(),
    portalOidcEnabled: (env['PORTAL_OIDC_ENABLED'] ?? '').toLowerCase() === 'true',
    portalIssuer,
    portalJwksUri,
    portalAudience:
      env['PORTAL_OIDC_AUDIENCE'] ?? 'ci-hub,ci-even,ci-server',
  };
}
