/**
 * fetchWithTimeout.ts
 *
 * A `fetch` wrapper that aborts after `timeoutMs`, in addition to honoring an
 * optional caller-supplied `signal`. Used by the CI-Server memory adapter and
 * memory-augmentation middleware so a slow or unreachable CI-Server can't
 * stall a chat turn indefinitely, or leak a hung socket on a fire-and-forget
 * write-back — the same "never hang forever" principle already applied to
 * claude-cli/codex-cli subprocess turns (see adapters/claudeCli.ts).
 */

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort);
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (timedOut) throw new Error(`request timed out after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
