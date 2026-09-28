#!/usr/bin/env node
/**
 * server.ts
 *
 * Entry point. Reads config, builds the configured adapter, mounts the router
 * on a plain Node HTTP server. Kept dependency-free on purpose — the hub
 * should run with just Node + tsx.
 */

import { createServer } from 'node:http';
import { loadConfig, type HubConfig } from './config.ts';
import { makeRouter } from './router.ts';
import type { Adapter, BackendKind } from './adapters/Adapter.ts';
import { PassthroughAdapter } from './adapters/passthrough.ts';
import { ClaudeCliAdapter } from './adapters/claudeCli.ts';
import { CodexCliAdapter } from './adapters/codexCli.ts';
import { OpenClawAdapter } from './adapters/openclaw.ts';
import { MemoryAdapter } from './adapters/memory.ts';

/**
 * Build the target registry. The hub multiplexes every configured backend at
 * once; each request picks its adapter by `metadata.agent_kind`. This is what
 * lets the glasses drive Ollama, Hermes, OpenClaw, and CI-Server memory through
 * one hub without restarting per target. `AGENT_KIND` only sets the default
 * when a request omits `agent_kind`.
 */
function buildRegistry(cfg: HubConfig): Map<BackendKind, Adapter> {
  const m = new Map<BackendKind, Adapter>();

  // OpenAI-compatible chat targets.
  m.set('openai', new PassthroughAdapter({
    baseUrl: cfg.downstreamUrl,
    apiKey: cfg.downstreamApiKey,
    kind: 'openai',
  }));
  m.set('local-llm', new PassthroughAdapter({
    baseUrl: cfg.downstreamUrl,
    apiKey: cfg.downstreamApiKey,
    kind: 'local-llm',
  }));

  // Coding-agent CLIs (permission prompts). Timeouts guard against a hung
  // subprocess leaving the HUD stuck on "thinking…" forever.
  const cliTimeouts = {
    inactivityTimeoutMs: cfg.agentInactivityTimeoutMs,
    wallClockMaxMs: cfg.agentWallClockMaxMs,
    heartbeatIntervalMs: cfg.agentHeartbeatIntervalMs,
  };
  m.set('claude-cli', new ClaudeCliAdapter({
    binary: cfg.claudeBinary,
    cwd: cfg.agentCwd,
    ...cliTimeouts,
  }));
  m.set('codex-cli', new CodexCliAdapter({
    binary: cfg.codexBinary,
    cwd: cfg.agentCwd,
    ...cliTimeouts,
  }));

  // OpenClaw gateway (OpenAI-compatible; content stripped for the HUD).
  m.set('openclaw', new OpenClawAdapter({
    gatewayUrl: cfg.openclawGatewayUrl,
    token: cfg.openclawToken,
  }));

  // Hermes agent — its gateway is OpenAI-shaped, so it reuses passthrough.
  // Only registered when configured (keeps unconfigured targets from 500ing).
  if (cfg.hermesGatewayUrl) {
    m.set('hermes', new PassthroughAdapter({
      baseUrl: cfg.hermesGatewayUrl,
      apiKey: cfg.hermesToken,
      kind: 'hermes',
    }));
  }

  // CI-Server memory recall (bespoke REST, api-key held server-side).
  if (cfg.ciServerUrl) {
    m.set('memory', new MemoryAdapter({
      baseUrl: cfg.ciServerUrl,
      apiKey: cfg.ciServerApiKey,
      recallPath: cfg.ciServerMemoryPath,
      timeoutMs: cfg.ciServerTimeoutMs,
    }));
  }

  return m;
}

function main(): void {
  const cfg = loadConfig();
  const registry = buildRegistry(cfg);
  const router = makeRouter({ config: cfg, registry, defaultKind: cfg.agentKind });
  const server = createServer((req, res) => {
    router(req, res).catch((e) => {
      console.error('[hub] handler crash:', e);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal' }));
      } else {
        res.end();
      }
    });
  });
  server.listen(cfg.port, cfg.bind, () => {
    const exposureNote =
      cfg.bind === '127.0.0.1'
        ? '  (loopback only — set HUB_TOKEN + HUB_BIND=0.0.0.0 for LAN)'
        : !cfg.authToken
          ? '  ⚠ exposed without HUB_TOKEN — set one before production use'
          : '';
    console.log(
      `[hub] listening on http://${cfg.bind}:${cfg.port}  default=${cfg.agentKind}  targets=[${[...registry.keys()].join(', ')}]${exposureNote}`
    );
  });
}

main();
