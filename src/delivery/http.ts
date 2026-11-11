export type FetchFn = typeof fetch;

export const PROVIDER_TIMEOUT_MS = 10_000;

export interface HttpOutcome {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

/**
 * POST with a hard timeout. Never rejects for vendor or network problems:
 * the caller gets either an outcome or an error message.
 */
export async function post(
  fetchFn: FetchFn,
  url: string,
  init: { headers: Record<string, string>; body: string },
): Promise<HttpOutcome | { error: string }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ error: string }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ error: `Timed out after ${PROVIDER_TIMEOUT_MS / 1000}s` });
    }, PROVIDER_TIMEOUT_MS);
  });
  const request = (async (): Promise<HttpOutcome | { error: string }> => {
    try {
      const res = await fetchFn(url, { method: 'POST', ...init, signal: controller.signal });
      let body: Record<string, unknown> = {};
      try {
        const parsed: unknown = await res.json();
        if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
      } catch {
        // Non-JSON body: fall back to the status code.
      }
      return { ok: res.ok, status: res.status, body };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function failureDetail(outcome: HttpOutcome): string {
  const message = outcome.body.message;
  return typeof message === 'string' && message ? message : `HTTP ${outcome.status}`;
}
