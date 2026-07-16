/**
 * stt.ts
 *
 * Speech-to-text proxy: `POST /v1/audio/transcriptions`.
 *
 * The glasses app records a clip and POSTs multipart audio to
 * `${baseUrl}/v1/audio/transcriptions` (see ci-glasses-app WhisperSTT). Every
 * standardized preset points `baseUrl` at agent-hub, so without this route the
 * hands-free flow 404s. The hub forwards the request verbatim to any
 * Whisper-compatible server (faster-whisper-server, speaches, LocalAI, OpenAI)
 * configured via `STT_URL`, injecting `STT_API_KEY` server-side so the
 * upstream credential never ships to the WebView.
 *
 * The body is buffered rather than streamed: glasses clips are ≤ ~2 MB and
 * buffering keeps the forward simple (fetch sets Content-Length upstream).
 * The incoming Content-Type header is preserved byte-for-byte so the
 * multipart boundary survives.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HubConfig } from './config.ts';

export async function handleTranscription(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: HubConfig
): Promise<void> {
  if (!cfg.sttUrl) {
    res.writeHead(501, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'stt_not_configured',
        message: 'Set STT_URL to a Whisper-compatible server',
      })
    );
    return;
  }

  // Buffer the raw request body untouched — re-parsing multipart here would
  // risk corrupting the boundary the upstream needs.
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks);

  const headers: Record<string, string> = {};
  const contentType = req.headers['content-type'];
  if (typeof contentType === 'string') headers['Content-Type'] = contentType;
  if (cfg.sttApiKey) headers['Authorization'] = `Bearer ${cfg.sttApiKey}`;

  const url = `${cfg.sttUrl.replace(/\/+$/, '')}/v1/audio/transcriptions`;
  let upstream: Response;
  try {
    upstream = await fetch(url, { method: 'POST', headers, body });
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'stt_upstream_unreachable',
        message: `STT upstream: ${(e as Error).message}`,
      })
    );
    return;
  }

  // Pipe status + body back verbatim (Whisper servers answer JSON).
  const payload = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(upstream.status, {
    'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
  });
  res.end(payload);
}
