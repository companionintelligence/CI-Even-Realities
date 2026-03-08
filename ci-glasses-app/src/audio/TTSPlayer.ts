/**
 * TTSPlayer.ts
 *
 * Text-to-speech playback via the browser's Web Speech API (SpeechSynthesis).
 * Audio output is optional — the primary G2 UX is display-only (text on glasses).
 */

export class TTSPlayer {
  private synth: SpeechSynthesis | null = null;
  private enabled = false;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
    }
  }

  isAvailable(): boolean {
    return this.synth !== null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Speak the provided text aloud via the phone's TTS engine.
   * No-op if TTS is disabled or not available.
   */
  speak(text: string): void {
    if (!this.enabled || !this.synth) return;

    // Cancel any ongoing speech
    this.stop();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    this.synth.speak(utterance);
  }

  stop(): void {
    if (this.synth?.speaking) {
      this.synth.cancel();
    }
  }
}
