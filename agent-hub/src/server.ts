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
import type { Adapter } from './adapters/Adapter.ts';
import { PassthroughAdapter } from './adapters/passthrough.ts';
import { ClaudeCliAdapter } from './adapters/claudeCli.ts';
import { CodexCliAdapter } from './adapters/codexCli.ts';
import { OpenClawAdapter } from './adapters/openclaw.ts';

function buildAdapter(cfg: HubConfig): Adapter {
  switch (cfg.agentKind) {
    case 'openai':
      return new PassthroughAdapter({
        baseUrl: cfg.downstreamUrl,
        apiKey: cfg.downstreamApiKey,
        kind: 'openai',
      });
    case 'local-llm':
      return new PassthroughAdapter({
        baseUrl: cfg.downstreamUrl,
        apiKey: cfg.downstreamApiKey,
        kind: 'local-llm',
      });
    case 'claude-cli':
      return new ClaudeCliAdapter({
        binary: cfg.claudeBinary,
        cwd: cfg.agentCwd,
      });
    case 'codex-cli':
      return new CodexCliAdapter({
        binary: cfg.codexBinary,
        cwd: cfg.agentCwd,
      });
    case 'openclaw':
      return new OpenClawAdapter({
        gatewayUrl: cfg.openclawGatewayUrl,
        token: cfg.openclawToken,
      });
  }
}

function main(): void {
  const cfg = loadConfig();
  const adapter = buildAdapter(cfg);
  const router = makeRouter({ config: cfg, adapter });
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
      `[hub] listening on http://${cfg.bind}:${cfg.port}  kind=${cfg.agentKind}${exposureNote}`
    );
  });
}

main();
