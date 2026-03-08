/**
 * WebSpeechSTT.ts
 *
 * Browser-native speech-to-text via the Web Speech API (SpeechRecognition).
 * Uses the phone microphone — useful as a fallback when the G2 mic is unavailable.
 *
 * Note: Chrome's Web Speech API sends audio to Google's servers.
 * For a fully private pipeline, prefer WhisperSTT with a self-hosted backend.
 */

import type { STTEngine } from './STTEngine.ts';

// Browser SpeechRecognition types (not yet in lib.dom.d.ts for all vendors)
interface SpeechRecognitionResult {
  readonly [index: number]: SpeechRecognitionAlternative;
  readonly isFinal: boolean;
  readonly length: number;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResultList {
  readonly [index: number]: SpeechRecognitionResult;
  readonly length: number;
}

interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare const SpeechRecognition: SpeechRecognitionConstructor | undefined;
declare const webkitSpeechRecognition:
  | SpeechRecognitionConstructor
  | undefined;

export class WebSpeechSTT implements STTEngine {
  private recognition: SpeechRecognitionInstance | null = null;

  constructor(private lang = 'en-US') {}

  isAvailable(): boolean {
    return (
      typeof SpeechRecognition !== 'undefined' ||
      typeof webkitSpeechRecognition !== 'undefined'
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async transcribe(_audio?: ArrayBuffer, _format?: string): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('Web Speech API is not available in this browser');
    }

    const RecognitionCtor =
      (typeof SpeechRecognition !== 'undefined'
        ? SpeechRecognition
        : webkitSpeechRecognition) as SpeechRecognitionConstructor;

    return new Promise<string>((resolve, reject) => {
      const recognition = new RecognitionCtor();
      this.recognition = recognition;

      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = this.lang;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const transcript =
          event.results[0]?.[0]?.transcript?.trim() ?? '';
        resolve(transcript);
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        reject(new Error(`Web Speech error: ${event.error}`));
      };

      recognition.onend = () => {
        // Resolve with empty string if no result was received
        resolve('');
      };

      recognition.start();
    });
  }

  abort(): void {
    this.recognition?.abort();
    this.recognition = null;
  }
}
