/**
 * STTEngine.ts
 *
 * Abstract interface for Speech-to-Text engines.
 */

export interface STTEngine {
  /**
   * Transcribe audio data to text.
   *
   * @param audio  Audio data as an ArrayBuffer (WAV recommended for Whisper)
   * @param format Audio format hint (e.g. "wav", "webm", "mp3")
   * @returns Transcribed text string
   */
  transcribe(audio: ArrayBuffer, format?: string): Promise<string>;

  /**
   * Whether this engine is available in the current environment.
   */
  isAvailable(): boolean;
}
