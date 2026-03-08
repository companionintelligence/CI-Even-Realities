/**
 * LC3Decoder.ts
 *
 * LC3 audio decoding strategy.
 *
 * The Even Hub SDK (v0.0.7+) delivers audio via `EvenHubEvent.audioEvent.audioPcm`
 * which is already decoded to PCM by the native host app. This module is therefore
 * a pass-through for SDK audio data.
 *
 * For use-cases where raw LC3 bytes must be decoded client-side (e.g., received
 * over a custom BLE channel), a server-side decode strategy is documented below.
 */

export class LC3Decoder {
  /**
   * Pass-through: the SDK already delivers PCM audio from the G2 microphone.
   * The `audioPcm` field in `AudioEventPayload` is ready for use with the
   * Web Audio API or for sending to a Whisper STT endpoint.
   */
  static fromSDKAudio(pcmData: Uint8Array): ArrayBuffer {
    const slice = pcmData.buffer.slice(
      pcmData.byteOffset,
      pcmData.byteOffset + pcmData.byteLength
    );
    // Normalise to ArrayBuffer (buffer may be a SharedArrayBuffer in some envs)
    if (slice instanceof ArrayBuffer) return slice;
    const copy = new ArrayBuffer(slice.byteLength);
    new Uint8Array(copy).set(new Uint8Array(slice));
    return copy;
  }

  /**
   * Encode PCM to WAV format so it can be sent to Whisper's transcription
   * endpoint as a standard audio file.
   *
   * @param pcmData   Raw 16-bit signed PCM samples (little-endian)
   * @param sampleRate  Sample rate in Hz (typically 16000 for speech)
   * @param channels  Number of audio channels (typically 1 for mono)
   */
  static pcmToWav(
    pcmData: ArrayBuffer,
    sampleRate = 16000,
    channels = 1
  ): ArrayBuffer {
    const pcmBytes = new Uint8Array(pcmData);
    const wavHeader = buildWavHeader(pcmBytes.byteLength, sampleRate, channels);
    const wavBuffer = new ArrayBuffer(wavHeader.byteLength + pcmBytes.byteLength);
    const view = new Uint8Array(wavBuffer);
    view.set(new Uint8Array(wavHeader), 0);
    view.set(pcmBytes, wavHeader.byteLength);
    return wavBuffer;
  }
}

/**
 * Build a minimal RIFF/WAV header for 16-bit PCM audio.
 */
function buildWavHeader(
  dataBytes: number,
  sampleRate: number,
  channels: number
): ArrayBuffer {
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const headerSize = 44;

  const buffer = new ArrayBuffer(headerSize);
  const view = new DataView(buffer);

  // Helper to write a 4-char FourCC
  function writeTag(offset: number, tag: string): void {
    for (let i = 0; i < 4; i++) {
      view.setUint8(offset + i, tag.charCodeAt(i));
    }
  }

  // RIFF chunk
  writeTag(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeTag(8, 'WAVE');

  // fmt sub-chunk
  writeTag(12, 'fmt ');
  view.setUint32(16, 16, true);       // PCM sub-chunk size
  view.setUint16(20, 1, true);        // Audio format: PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeTag(36, 'data');
  view.setUint32(40, dataBytes, true);

  return buffer;
}
