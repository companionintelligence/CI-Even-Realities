import { describe, it, expect } from 'vitest';
import { loadConfig } from '../config.ts';

describe('loadConfig', () => {
  describe('defaults (empty env)', () => {
    const cfg = loadConfig({});

    it('defaults port to 8787', () => {
      expect(cfg.port).toBe(8787);
    });

    it('binds to loopback when no HUB_TOKEN is set', () => {
      expect(cfg.bind).toBe('127.0.0.1');
    });

    it('defaults agentKind to openai', () => {
      expect(cfg.agentKind).toBe('openai');
    });

    it('defaults downstreamUrl to local Ollama', () => {
      expect(cfg.downstreamUrl).toBe('http://localhost:11434');
    });

    it('defaults binaries to claude/codex', () => {
      expect(cfg.claudeBinary).toBe('claude');
      expect(cfg.codexBinary).toBe('codex');
    });

    it('defaults agentCwd to process.cwd()', () => {
      expect(cfg.agentCwd).toBe(process.cwd());
    });

    it('defaults portalOidcEnabled to false', () => {
      expect(cfg.portalOidcEnabled).toBe(false);
    });

    it('defaults portalIssuer to the production Portal', () => {
      expect(cfg.portalIssuer).toBe('https://hub.ci.computer');
    });

    it('derives portalJwksUri from the default issuer', () => {
      expect(cfg.portalJwksUri).toBe('https://hub.ci.computer/api/auth/jwks');
    });

    it('defaults portalAudience to the standard first-party client list', () => {
      expect(cfg.portalAudience).toBe('ci-hub,ci-even,ci-server');
    });

    it('defaults ecosystem target URLs to empty (unregistered)', () => {
      expect(cfg.hermesGatewayUrl).toBe('');
      expect(cfg.ciServerUrl).toBe('');
      expect(cfg.sttUrl).toBe('');
    });

    it('defaults memory/turn paths', () => {
      expect(cfg.ciServerMemoryPath).toBe('/memory/recall');
      expect(cfg.ciServerTurnPath).toBe('/memory/turn');
    });
  });

  describe('HUB_BIND / HUB_TOKEN interaction', () => {
    it('binds to 0.0.0.0 when a HUB_TOKEN is set and HUB_BIND is not', () => {
      const cfg = loadConfig({ HUB_TOKEN: 'secret' });
      expect(cfg.bind).toBe('0.0.0.0');
    });

    it('an explicit HUB_BIND always wins, even without a token', () => {
      const cfg = loadConfig({ HUB_BIND: '192.168.1.5' });
      expect(cfg.bind).toBe('192.168.1.5');
    });

    it('an explicit HUB_BIND wins even when a token is also set', () => {
      const cfg = loadConfig({ HUB_TOKEN: 'secret', HUB_BIND: '10.0.0.1' });
      expect(cfg.bind).toBe('10.0.0.1');
    });
  });

  describe('agentKind parsing', () => {
    it('accepts every known BackendKind, including auto', () => {
      const kinds = [
        'openai', 'local-llm', 'claude-cli', 'codex-cli',
        'hermes', 'memory', 'openclaw', 'auto',
      ];
      for (const k of kinds) {
        expect(loadConfig({ AGENT_KIND: k }).agentKind).toBe(k);
      }
    });

    it('falls back to openai for an unrecognized value', () => {
      expect(loadConfig({ AGENT_KIND: 'not-a-real-kind' }).agentKind).toBe('openai');
    });

    it('falls back to openai when unset', () => {
      expect(loadConfig({}).agentKind).toBe('openai');
    });
  });

  describe('downstream URL / key resolution', () => {
    it('DOWNSTREAM_URL takes precedence over CI_LLM_BASE_URL', () => {
      const cfg = loadConfig({
        DOWNSTREAM_URL: 'http://explicit:1234',
        CI_LLM_BASE_URL: 'http://hub-ollama:11434/v1',
      });
      expect(cfg.downstreamUrl).toBe('http://explicit:1234');
    });

    it('falls back to CI_LLM_BASE_URL with a trailing /v1 stripped', () => {
      const cfg = loadConfig({ CI_LLM_BASE_URL: 'http://hub-ollama:11434/v1' });
      expect(cfg.downstreamUrl).toBe('http://hub-ollama:11434');
    });

    it('strips a trailing /v1/ (with slash) from CI_LLM_BASE_URL too', () => {
      const cfg = loadConfig({ CI_LLM_BASE_URL: 'http://hub-ollama:11434/v1/' });
      expect(cfg.downstreamUrl).toBe('http://hub-ollama:11434');
    });

    it('does not touch a CI_LLM_BASE_URL with no /v1 suffix', () => {
      const cfg = loadConfig({ CI_LLM_BASE_URL: 'http://hub-ollama:11434' });
      expect(cfg.downstreamUrl).toBe('http://hub-ollama:11434');
    });

    it('DOWNSTREAM_API_KEY takes precedence over CI_LLM_API_KEY', () => {
      const cfg = loadConfig({
        DOWNSTREAM_API_KEY: 'explicit-key',
        CI_LLM_API_KEY: 'ollama',
      });
      expect(cfg.downstreamApiKey).toBe('explicit-key');
    });

    it('falls back to CI_LLM_API_KEY', () => {
      expect(loadConfig({ CI_LLM_API_KEY: 'ollama' }).downstreamApiKey).toBe('ollama');
    });
  });

  describe('Portal issuer / JWKS resolution', () => {
    it('PORTAL_OIDC_ISSUER takes precedence over CI_CLOUD_URL', () => {
      const cfg = loadConfig({
        PORTAL_OIDC_ISSUER: 'https://explicit.example',
        CI_CLOUD_URL: 'https://from-cloud-url.example',
      });
      expect(cfg.portalIssuer).toBe('https://explicit.example');
    });

    it('falls back to CI_CLOUD_URL when PORTAL_OIDC_ISSUER is unset', () => {
      const cfg = loadConfig({ CI_CLOUD_URL: 'https://from-cloud-url.example' });
      expect(cfg.portalIssuer).toBe('https://from-cloud-url.example');
    });

    it('derives portalJwksUri from a custom issuer, stripping trailing slashes', () => {
      const cfg = loadConfig({ PORTAL_OIDC_ISSUER: 'https://my-portal.example/' });
      expect(cfg.portalJwksUri).toBe('https://my-portal.example/api/auth/jwks');
    });

    it('an explicit PORTAL_OIDC_JWKS_URI overrides the derived one', () => {
      const cfg = loadConfig({
        PORTAL_OIDC_ISSUER: 'https://my-portal.example',
        PORTAL_OIDC_JWKS_URI: 'https://custom-jwks.example/keys',
      });
      expect(cfg.portalJwksUri).toBe('https://custom-jwks.example/keys');
    });
  });

  describe('portalOidcEnabled boolean parsing', () => {
    it('parses "true" (any case) as enabled', () => {
      expect(loadConfig({ PORTAL_OIDC_ENABLED: 'true' }).portalOidcEnabled).toBe(true);
      expect(loadConfig({ PORTAL_OIDC_ENABLED: 'TRUE' }).portalOidcEnabled).toBe(true);
      expect(loadConfig({ PORTAL_OIDC_ENABLED: 'True' }).portalOidcEnabled).toBe(true);
    });

    it('treats any other value as disabled', () => {
      expect(loadConfig({ PORTAL_OIDC_ENABLED: 'false' }).portalOidcEnabled).toBe(false);
      expect(loadConfig({ PORTAL_OIDC_ENABLED: '1' }).portalOidcEnabled).toBe(false);
      expect(loadConfig({ PORTAL_OIDC_ENABLED: 'yes' }).portalOidcEnabled).toBe(false);
      expect(loadConfig({ PORTAL_OIDC_ENABLED: '' }).portalOidcEnabled).toBe(false);
    });
  });

  describe('ecosystem target aliasing', () => {
    it('HERMES_APP_SEED takes precedence over HERMES_TOKEN', () => {
      const cfg = loadConfig({ HERMES_APP_SEED: 'seed-val', HERMES_TOKEN: 'token-val' });
      expect(cfg.hermesToken).toBe('seed-val');
    });

    it('falls back to HERMES_TOKEN when HERMES_APP_SEED is unset', () => {
      expect(loadConfig({ HERMES_TOKEN: 'token-val' }).hermesToken).toBe('token-val');
    });

    it('CI_SERVER_API_KEY takes precedence over CI_SERVER_TOKEN', () => {
      const cfg = loadConfig({
        CI_SERVER_API_KEY: 'api-key-val',
        CI_SERVER_TOKEN: 'token-val',
      });
      expect(cfg.ciServerApiKey).toBe('api-key-val');
    });

    it('falls back to CI_SERVER_TOKEN when CI_SERVER_API_KEY is unset', () => {
      expect(loadConfig({ CI_SERVER_TOKEN: 'token-val' }).ciServerApiKey).toBe('token-val');
    });

    it('reads HERMES_GATEWAY_URL and CI_SERVER_URL verbatim', () => {
      const cfg = loadConfig({
        HERMES_GATEWAY_URL: 'http://hermes:8642',
        CI_SERVER_URL: 'http://server:3030',
      });
      expect(cfg.hermesGatewayUrl).toBe('http://hermes:8642');
      expect(cfg.ciServerUrl).toBe('http://server:3030');
    });

    it('reads custom memory/turn paths', () => {
      const cfg = loadConfig({
        CI_SERVER_MEMORY_PATH: '/api/memory/recall',
        CI_SERVER_TURN_PATH: '/api/memory/turn',
      });
      expect(cfg.ciServerMemoryPath).toBe('/api/memory/recall');
      expect(cfg.ciServerTurnPath).toBe('/api/memory/turn');
    });
  });

  describe('STT config', () => {
    it('reads STT_URL and STT_API_KEY verbatim', () => {
      const cfg = loadConfig({
        STT_URL: 'http://whisper:9000',
        STT_API_KEY: 'whisper-key',
      });
      expect(cfg.sttUrl).toBe('http://whisper:9000');
      expect(cfg.sttApiKey).toBe('whisper-key');
    });
  });

  describe('full realistic env', () => {
    it('resolves a fully-populated production-like environment consistently', () => {
      const cfg = loadConfig({
        HUB_PORT: '9000',
        HUB_TOKEN: 'prod-token',
        AGENT_KIND: 'auto',
        CI_LLM_BASE_URL: 'http://ci-hub-ollama:11434/v1',
        CI_LLM_API_KEY: 'ollama',
        PORTAL_OIDC_ENABLED: 'true',
        CI_CLOUD_URL: 'https://hub.ci.computer',
        HERMES_GATEWAY_URL: 'http://ci-hermes:8642',
        HERMES_APP_SEED: 'hermes-seed',
        CI_SERVER_URL: 'http://ci-server:3030',
        CI_SERVER_TOKEN: 'server-token',
        STT_URL: 'http://whisper:9000',
      });

      expect(cfg).toMatchObject({
        port: 9000,
        bind: '0.0.0.0',
        authToken: 'prod-token',
        agentKind: 'auto',
        downstreamUrl: 'http://ci-hub-ollama:11434',
        downstreamApiKey: 'ollama',
        portalOidcEnabled: true,
        portalIssuer: 'https://hub.ci.computer',
        portalJwksUri: 'https://hub.ci.computer/api/auth/jwks',
        hermesGatewayUrl: 'http://ci-hermes:8642',
        hermesToken: 'hermes-seed',
        ciServerUrl: 'http://ci-server:3030',
        ciServerApiKey: 'server-token',
        sttUrl: 'http://whisper:9000',
      });
    });
  });
});
