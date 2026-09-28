/**
 * Settings.ts
 *
 * Persisted user configuration for the CI Glasses app.
 * Stored in localStorage (or SDK storage when bridge is available).
 */

export type ApiMode = 'completions' | 'responses' | 'auto';
export type STTProvider = 'whisper' | 'webspeech';

/**
 * How the app authenticates to its backend.
 * - `apiKey` — legacy: send a static bearer the user pastes into Settings.
 * - `oidc`   — "Sign in with Companion Intelligence": obtain a CI-Portal OIDC
 *              access token (Authorization-Code + PKCE) and send that instead.
 */
export type AuthMode = 'apiKey' | 'oidc';

/**
 * Which kind of agent sits behind the configured backend URL.
 *
 * The glasses app speaks one wire format (OpenAI SSE) regardless. The kind
 * is a hint to the hub about how to dispatch, and to the app about which
 * agent_* event types to expect (e.g. permission_prompt for coding agents).
 *
 * - `openai`     — any OpenAI-compatible endpoint, no extra events
 * - `local-llm`  — Ollama / vLLM / llama.cpp running on LAN
 * - `claude-cli` — agent-hub spawning Claude Code in stream-json mode
 * - `codex-cli`  — agent-hub spawning Codex CLI in JSON streaming mode
 * - `openclaw`   — agent-hub forwarding to an OpenClaw Gateway
 * - `hermes`     — agent-hub forwarding to the Hermes agent gateway (OpenAI-shaped)
 * - `memory`     — agent-hub recalling from CI-Server ("Companion Memory")
 * - `auto`       — "Assistant": agent-hub routes each request by intent
 *                  (memory · Hermes · OpenClaw · plain chat) — the glasses
 *                  send one kind and the hub picks the target per message
 */
export type BackendKind =
  | 'openai'
  | 'local-llm'
  | 'claude-cli'
  | 'codex-cli'
  | 'openclaw'
  | 'hermes'
  | 'memory'
  | 'auto';

export interface BackendConfig {
  /** Base URL of the AI backend, e.g. "http://localhost:8080" */
  baseUrl: string;
  /** Bearer token / API key */
  apiKey: string;
  /** Model name, e.g. "gpt-4o", "llama3", "ci-companion" */
  model: string;
  /** Kind of agent the backend URL routes to. */
  backendKind: BackendKind;
  /** Which OpenAI API shape to use */
  apiMode: ApiMode;
  /** Default system prompt / instructions */
  systemPrompt: string;
  /** Enable SSE streaming responses */
  streaming: boolean;
  /** Responses API: server-side conversation context */
  storeContext: boolean;
  /** STT provider */
  sttProvider: STTProvider;
  /** Enable TTS audio output via phone speaker */
  ttsEnabled: boolean;
  /**
   * Maximum number of messages to keep in the Chat Completions history
   * (user + assistant pairs). Older messages are dropped to avoid
   * unbounded payload growth. Use an even number to keep whole turns.
   * Default: 20 (10 conversation turns).
   */
  maxHistoryMessages: number;

  // ── Authentication ──────────────────────────────────────────────────────
  /** How the app authenticates to its backend (see {@link AuthMode}). */
  authMode: AuthMode;
  /**
   * CI-Portal OIDC provider base URL (Better-Auth mount). Discovery + endpoint
   * fallbacks derive from this. Default is the production Portal issuer.
   */
  oidcIssuer: string;
  /** OIDC public client id. Defaults to the dedicated pre-registered `ci-even` client. */
  oidcClientId: string;
  /** OIDC scopes; `offline_access` is required for refresh tokens. */
  oidcScope: string;

  // ── CI-Hub quick-connect ────────────────────────────────────────────────
  /**
   * Base host of the user's CI-Hub (e.g. `http://ci-hub.local` or a Tailscale
   * `http://100.x.y.z`). Standardized service presets (Ollama / Hermes /
   * OpenClaw) are derived from this — see config/HubPresets.ts.
   */
  hubBaseUrl: string;
  /**
   * Memory-augmented chat: ask the agent-hub to recall from Companion Memory
   * (CI-Server) before each reply and save the conversation back afterwards.
   * Sent as `metadata.use_memory` on every chat request. Requires the
   * agent-hub to be connected to a CI-Server; off by default.
   */
  useMemory: boolean;
}

const STORAGE_KEY = 'ci-glasses-config';

const DEFAULT_CONFIG: BackendConfig = {
  // Stay OpenAI-compatible by default so a fresh install with a user's
  // existing key/URL "just works" without setting up the hub. Users who
  // run the agent-hub override Backend URL + Backend Kind in Settings.
  baseUrl: 'http://localhost:8080',
  apiKey: 'ci-local-key',
  model: 'ci-companion',
  backendKind: 'openai',
  apiMode: 'auto',
  systemPrompt:
    "You are a personal companion assistant. Respond concisely — answers will be displayed on smart glasses.",
  streaming: true,
  storeContext: true,
  sttProvider: 'whisper',
  ttsEnabled: false,
  maxHistoryMessages: 20,

  // Default to the legacy static-key mode so existing installs keep working;
  // users opt into OIDC from the Account section in Settings.
  authMode: 'apiKey',
  // Production CI-Portal issuer (Better-Auth mount). Configurable in Settings
  // for staging/dev/self-hosted Portals. See CI-Server PortalTokenService.
  oidcIssuer: 'https://hub.ci.computer/api/auth',
  // Dedicated public PKCE client for the glasses (registered in CI-Portal
  // PUBLIC_CLIENTS; accepted by CI-Server's PORTAL_OIDC_AUDIENCE). Tokens carry
  // aud: ci-even.
  oidcClientId: 'ci-even',
  oidcScope: 'openid email profile offline_access',

  // Canonical CI-Hub base. Service presets (agent-hub on :8787) derive from
  // this host (see config/HubPresets.ts).
  hubBaseUrl: 'http://localhost',

  // Memory-augmented chat is opt-in: it only works once the user's agent-hub
  // is connected to a CI-Server, so a fresh install keeps it off.
  useMemory: false,
};

export class Settings {
  private config: BackendConfig;

  constructor() {
    this.config = this.load();
  }

  get(): BackendConfig {
    return { ...this.config };
  }

  set(patch: Partial<BackendConfig>): void {
    this.config = { ...this.config, ...patch };
    this.save();
  }

  reset(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.save();
  }

  private load(): BackendConfig {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) } as BackendConfig;
      }
    } catch {
      // Ignore parse errors — fall back to defaults
    }
    return { ...DEFAULT_CONFIG };
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
    } catch {
      // Ignore storage errors (e.g. private mode)
    }
  }
}
