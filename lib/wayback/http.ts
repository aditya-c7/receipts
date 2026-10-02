// Policy fetch wrapper for archive.org: timeouts, retries, typed errors.
import { AppError } from '../errors';

export interface FetchPolicyOpts {
  timeoutMs: number;
  /** Retries after the first attempt (max 2 per spec). */
  retries: number;
  userAgent: string;
  maxBytes: number;
}

function parseRetryAfterMs(v: string | null): number | undefined {
  if (!v) return undefined;
  const secs = Number(v.trim());
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const dateMs = Date.parse(v);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * GET with timeout + exponential backoff+jitter (max 2 retries).
 * Throws ARCHIVE_RATE_LIMITED on 429/503 (+Retry-After), ARCHIVE_TIMEOUT on
 * abort/timeout, ARCHIVE_ERROR otherwise.
 *
 * NOTE: never cache errors for more than 30s upstream (cache layer must use
 * short TTL for failures; success TTLs live in lib/config.ts).
 */
export async function fetchWithPolicy(url: string, opts: FetchPolicyOpts): Promise<string> {
  const retries = Math.min(Math.max(0, Math.floor(opts.retries)), 2);
  const maxBytes = Math.max(1, Math.floor(opts.maxBytes));
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': opts.userAgent, Accept: 'text/html,application/json,*/*' },
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status === 503) {
        const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
        // Retry rate-limits like other transient failures (within retry budget).
        if (attempt < retries) {
          const backoff = Math.min(4000, 400 * 2 ** attempt) + Math.random() * 200;
          await sleep(retryAfterMs !== undefined ? Math.min(retryAfterMs, 5000) : backoff);
          continue;
        }
        throw new AppError('ARCHIVE_RATE_LIMITED', `Archive rate limited (${res.status})`, retryAfterMs);
      }
      if (!res.ok) {
        if (attempt < retries && (res.status >= 500 || res.status === 408)) {
          const backoff = Math.min(4000, 400 * 2 ** attempt) + Math.random() * 200;
          await sleep(backoff);
          continue;
        }
        throw new AppError('ARCHIVE_ERROR', `Archive error ${res.status}`);
      }
      const text = await res.text();
      return text.length > maxBytes ? text.slice(0, maxBytes) : text;
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof AppError) {
        lastErr = e;
        // ARCHIVE_RATE_LIMITED already handled retries above; do not retry further.
        break;
      }
      const name = e instanceof Error ? e.name : '';
      const msg = e instanceof Error ? e.message : String(e);
      const isAbort = name === 'AbortError' || /abort/i.test(msg);
      if (isAbort) {
        if (attempt < retries) {
          const backoff = Math.min(4000, 400 * 2 ** attempt) + Math.random() * 200;
          await sleep(backoff);
          continue;
        }
        lastErr = new AppError('ARCHIVE_TIMEOUT', 'Archive request timed out');
        break;
      }
      // Network error: retry within budget, else ARCHIVE_ERROR.
      lastErr = e;
      if (attempt < retries) {
        const backoff = Math.min(4000, 400 * 2 ** attempt) + Math.random() * 200;
        await sleep(backoff);
        continue;
      }
      lastErr = new AppError('ARCHIVE_ERROR', 'Archive fetch failed');
      break;
    }
  }
  if (lastErr instanceof AppError) throw lastErr;
  throw new AppError('ARCHIVE_ERROR', 'Archive fetch failed');
}
