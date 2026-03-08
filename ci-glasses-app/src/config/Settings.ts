/**
 * Settings.ts
 *
 * Persisted user configuration for the CI Glasses app.
 * Stored in localStorage (or SDK storage when bridge is available).
 */

export type ApiMode = 'completions' | 'responses' | 'auto';
export type STTProvider = 'whisper' | 'webspeech';

export interface BackendConfig {
  /** Base URL of the AI backend, e.g. "http://localhost:8080" */
  baseUrl: string;
  /** Bearer token / API key */
  apiKey: string;
  /** Model name, e.g. "gpt-4o", "llama3", "ci-companion" */
  model: string;
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
}

const STORAGE_KEY = 'ci-glasses-config';

const DEFAULT_CONFIG: BackendConfig = {
  baseUrl: 'http://localhost:8080',
  apiKey: 'ci-local-key',
  model: 'ci-companion',
  apiMode: 'auto',
  systemPrompt:
    "You are a personal companion assistant. Respond concisely — answers will be displayed on smart glasses.",
  streaming: true,
  storeContext: true,
  sttProvider: 'whisper',
  ttsEnabled: false,
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
