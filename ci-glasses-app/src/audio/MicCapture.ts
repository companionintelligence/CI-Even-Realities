/**
 * MicCapture.ts
 *
 * Wraps the Even Hub SDK Microphone API (audioControl) and listens for PCM
 * audio data delivered via the EvenHub audio event.
 *
 * The SDK delivers audio as PCM (already decoded from LC3 by the native host).
 * Audio chunks are accumulated until stopCapture() is called, then the
 * accumulated PCM data is returned as a single ArrayBuffer.
 */

import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { AudioInputSource } from '@evenrealities/even_hub_sdk';
import { LC3Decoder } from './LC3Decoder.ts';

export type MicState = 'idle' | 'recording' | 'processing';

export class MicCapture {
  private pcmChunks: Uint8Array[] = [];
  private state: MicState = 'idle';
  private unsubscribeAudio?: () => void;

  constructor(private bridge: EvenAppBridge) {}

  getState(): MicState {
    return this.state;
  }

  /**
   * Start capturing audio from the G2 microphone.
   * Registers a listener for audioEvent PCM data via the SDK event system.
   */
  async startCapture(): Promise<void> {
    if (this.state !== 'idle') return;

    this.pcmChunks = [];
    this.state = 'recording';

    // Activate microphone on the glasses. SDK ≥0.0.16 adds an optional
    // `source` param to audioControl (glasses vs. phone mic) — pass it
    // explicitly since MicCapture has always captured from the G2's own mic.
    const ok = await this.bridge.audioControl(true, AudioInputSource.Glasses);
    if (!ok) {
      this.state = 'idle';
      throw new Error('Failed to start microphone');
    }

    // Listen for PCM audio chunks from the glasses
    this.unsubscribeAudio = this.bridge.onEvenHubEvent((event) => {
      if (event.audioEvent?.audioPcm) {
        this.pcmChunks.push(event.audioEvent.audioPcm);
      }
    });
  }

  /**
   * Stop capturing audio and return the accumulated PCM as a WAV ArrayBuffer
   * ready for use with the Whisper transcription API.
   */
  async stopCapture(): Promise<ArrayBuffer> {
    if (this.state !== 'recording') {
      return new ArrayBuffer(0);
    }

    this.state = 'processing';

    // Deactivate microphone
    await this.bridge.audioControl(false);

    // Unsubscribe from audio events
    this.unsubscribeAudio?.();
    this.unsubscribeAudio = undefined;

    // Concatenate all PCM chunks
    const totalLength = this.pcmChunks.reduce(
      (sum, chunk) => sum + chunk.byteLength,
      0
    );
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of this.pcmChunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    this.pcmChunks = [];
    this.state = 'idle';

    // Wrap PCM in WAV container for Whisper compatibility
    const pcmBuffer = LC3Decoder.fromSDKAudio(combined);
    return LC3Decoder.pcmToWav(pcmBuffer);
  }

  /**
   * Cancel ongoing capture without returning audio data.
   */
  async cancelCapture(): Promise<void> {
    if (this.state === 'idle') return;
    await this.bridge.audioControl(false);
    this.unsubscribeAudio?.();
    this.unsubscribeAudio = undefined;
    this.pcmChunks = [];
    this.state = 'idle';
  }
}
