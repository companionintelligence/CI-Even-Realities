import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WhisperSTT } from '../WhisperSTT.ts';
import type { TokenProvider } from '../../auth/TokenProvider.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('WhisperSTT', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('isAvailable', () => {
    it('is available when baseUrl is non-empty', () => {
      expect(new WhisperSTT('http://localhost:8080', 'key').isAvailable()).toBe(true);
    });

    it('is unavailable when baseUrl is empty', () => {
      expect(new WhisperSTT('', 'key').isAvailable()).toBe(false);
    });
  });

  describe('transcribe', () => {
    it('POSTs multipart form data to /v1/audio/transcriptions', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ text: 'hello world' }));
      const stt = new WhisperSTT('http://localhost:8080', 'test-key');

      const result = await stt.transcribe(new ArrayBuffer(8), 'wav');

      expect(result).toBe('hello world');
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:8080/v1/audio/transcriptions');
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);
    });

    it('includes file, model, and response_format fields in the form data', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }));
      const stt = new WhisperSTT('http://localhost:8080', 'test-key', 'whisper-large');

      await stt.transcribe(new ArrayBuffer(4), 'wav');

      const body = fetchMock.mock.calls[0][1].body as FormData;
      expect(body.get('model')).toBe('whisper-large');
      expect(body.get('response_format')).toBe('json');
      const file = body.get('file') as File;
      expect(file.name).toBe('audio.wav');
      expect(file.type).toBe('audio/wav');
    });

    it('names the file using the given format', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }));
      const stt = new WhisperSTT('http://localhost:8080', 'key');

      await stt.transcribe(new ArrayBuffer(4), 'mp3');

      const body = fetchMock.mock.calls[0][1].body as FormData;
      const file = body.get('file') as File;
      expect(file.name).toBe('audio.mp3');
      expect(file.type).toBe('audio/mp3');
    });

    it('defaults to wav format when none is given', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }));
      const stt = new WhisperSTT('http://localhost:8080', 'key');

      await stt.transcribe(new ArrayBuffer(4));

      const body = fetchMock.mock.calls[0][1].body as FormData;
      const file = body.get('file') as File;
      expect(file.name).toBe('audio.wav');
    });

    it('sends the static API key as a Bearer token when no token provider is set', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }));
      const stt = new WhisperSTT('http://localhost:8080', 'my-static-key');

      await stt.transcribe(new ArrayBuffer(4));

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>)['Authorization']).toBe(
        'Bearer my-static-key'
      );
    });

    it('omits the Authorization header when no key or provider is available', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }));
      const stt = new WhisperSTT('http://localhost:8080', '');

      await stt.transcribe(new ArrayBuffer(4));

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
    });

    it('prefers the token provider bearer over the static key', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }));
      const provider: TokenProvider = { getBearer: async () => 'oidc-token' };
      const stt = new WhisperSTT('http://localhost:8080', 'static-key', 'whisper-1', provider);

      await stt.transcribe(new ArrayBuffer(4));

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>)['Authorization']).toBe(
        'Bearer oidc-token'
      );
    });

    it('trims whitespace from the transcribed text', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ text: '  hello there  \n' }));
      const stt = new WhisperSTT('http://localhost:8080', 'key');

      expect(await stt.transcribe(new ArrayBuffer(4))).toBe('hello there');
    });

    it('returns an empty string when the response has no text field', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));
      const stt = new WhisperSTT('http://localhost:8080', 'key');

      expect(await stt.transcribe(new ArrayBuffer(4))).toBe('');
    });

    it('throws with status and body text on a non-2xx response', async () => {
      fetchMock.mockResolvedValue(
        new Response('bad audio format', { status: 400 })
      );
      const stt = new WhisperSTT('http://localhost:8080', 'key');

      await expect(stt.transcribe(new ArrayBuffer(4))).rejects.toThrow(
        /Whisper STT error 400.*bad audio format/s
      );
    });

    it('throws on a 5xx upstream failure', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 503 }));
      const stt = new WhisperSTT('http://localhost:8080', 'key');

      await expect(stt.transcribe(new ArrayBuffer(4))).rejects.toThrow(/503/);
    });

    it('propagates a network-level rejection', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      const stt = new WhisperSTT('http://localhost:8080', 'key');

      await expect(stt.transcribe(new ArrayBuffer(4))).rejects.toThrow('Failed to fetch');
    });
  });

  describe('updateConfig', () => {
    it('updates baseUrl and apiKey used on the next transcribe call', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }));
      const stt = new WhisperSTT('http://old:8080', 'old-key');

      stt.updateConfig('http://new:9090', 'new-key');
      await stt.transcribe(new ArrayBuffer(4));

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://new:9090/v1/audio/transcriptions');
      expect((init.headers as Record<string, string>)['Authorization']).toBe(
        'Bearer new-key'
      );
    });

    it('updates the model only when a value is given', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }));
      const stt = new WhisperSTT('http://localhost:8080', 'key', 'whisper-1');

      stt.updateConfig('http://localhost:8080', 'key'); // no model arg
      await stt.transcribe(new ArrayBuffer(4));

      const body = fetchMock.mock.calls[0][1].body as FormData;
      expect(body.get('model')).toBe('whisper-1'); // unchanged
    });

    it('changes the model when explicitly provided', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }));
      const stt = new WhisperSTT('http://localhost:8080', 'key', 'whisper-1');

      stt.updateConfig('http://localhost:8080', 'key', 'whisper-large-v3');
      await stt.transcribe(new ArrayBuffer(4));

      const body = fetchMock.mock.calls[0][1].body as FormData;
      expect(body.get('model')).toBe('whisper-large-v3');
    });

    it('reflects isAvailable after updating to an empty baseUrl', () => {
      const stt = new WhisperSTT('http://localhost:8080', 'key');
      expect(stt.isAvailable()).toBe(true);
      stt.updateConfig('', 'key');
      expect(stt.isAvailable()).toBe(false);
    });
  });
});
