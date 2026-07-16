/**
 * WhisperSTT.ts
 *
 * OpenAI Whisper speech-to-text via the /v1/audio/transcriptions REST endpoint.
 * Works with any Whisper-compatible backend (OpenAI, Ollama, LocalAI, etc.).
 */

import type { STTEngine } from './STTEngine.ts';
import { authedFetch, type TokenProvider } from '../auth/TokenProvider.ts';

export class WhisperSTT implements STTEngine {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model = 'whisper-1',
    private tokenProvider?: TokenProvider
  ) {}

  isAvailable(): boolean {
    return this.baseUrl.length > 0;
  }

  updateConfig(baseUrl: string, apiKey: string, model?: string): void {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    if (model) this.model = model;
  }

  async transcribe(audio: ArrayBuffer, format = 'wav'): Promise<string> {
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([audio], { type: `audio/${format}` }),
      `audio.${format}`
    );
    formData.append('model', this.model);
    formData.append('response_format', 'json');

    const response = await authedFetch(
      this.tokenProvider,
      this.apiKey,
      (bearer) =>
        fetch(`${this.baseUrl}/v1/audio/transcriptions`, {
          method: 'POST',
          headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
          body: formData,
        })
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Whisper STT error ${response.status}: ${errText}`);
    }

    const result = await response.json() as { text?: string };
    return result.text?.trim() ?? '';
  }
}
