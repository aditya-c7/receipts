// CDX search against the Wayback Machine (server-side only).
//
// SPEC ID-prefix-bucket discovery via lib/wayback/* pure primitives; the
// fetch orchestration lives here because it needs Worker fetch + cache.
import {
  CDX_LIMIT,
  CDX_TIMEOUT_MS,
  SEARCH_MAX_BUCKETS,
} from '../../lib/config';
import { repairCandidates } from '../../lib/ocr/confusables';
import type { Candidate } from '../../lib/types';
import { idsToPrefixBuckets } from '../../lib/wayback/buckets';
import {
  buildCdxUrl,
  dedupeByTweetId,
  filterByIdTime,
  parseCdxJson,
} from '../../lib/wayback/cdx';
import { idToMs, msToMaxId, msToMinId } from '../../lib/wayback/snowflake';
import { archiveUrl, extractTweetId } from '../../lib/wayback/urls';
import { type Cache, buildQueryKey, cdxKey, cdxTtlSec } from '../cache/redis';

export interface CdxEnv {
  WAYBACK_USER_AGENT?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
}

export interface CoverageInfo {
  buckets: number;
  totalCaptures: number;
  truncated: boolean;
  handleHasAnyCaptures: boolean;
  /** OCR-confusable variant that actually had captures (original had none). */
  repairedHandle?: string;
}

export interface CdxResult {
  candidates: Candidate[];
  coverage: CoverageInfo;
  cached: boolean;
}

const CDX_ENDPOINT = 'https://web.archive.org/cdx/search/cdx';

function toCdxTs(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function retryAfterMs(res: Response, attempt: number): number {
  const raw = res.headers.get('retry-after');
  if (raw) {
    const secs = Number(raw);
    if (Number.isFinite(secs)) return Math.min(10000, secs * 1000);
  }
  return Math.min(4000, 500 * 2 ** attempt);
}

/** GET with timeout + UA + up to 2 retries, honoring Retry-After. Throws on final failure. */
export async function fetchCdxWithPolicy(url: string, userAgent: string): Promise<Response> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= 2; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), CDX_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'user-agent': userAgent, accept: 'application/json' },
      });
      if (res.status === 429 || res.status === 503) {
        lastErr = new Error(`cdx status ${res.status}`);
        if (attempt < 2) await sleep(retryAfterMs(res, attempt));
        continue;
      }
      if (!res.ok) throw new Error(`cdx status ${res.status}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await sleep(500 * 2 ** attempt);
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('cdx fetch failed');
}

/** Coverage probe: does this handle have ANY captures (limit=1)? Never throws. */
export async function handleHasAnyCaptures(handle: string, userAgent: string): Promise<boolean> {
  try {
    const h = handle.toLowerCase();
    const q = new URLSearchParams({
      url: `x.com/${h}/status/*`,
      output: 'json',
      limit: '1',
    });
    const res = await fetchCdxWithPolicy(`${CDX_ENDPOINT}?${q.toString()}`, userAgent);
    const json: unknown = await res.json();
    return Array.isArray(json) && json.length >= 2;
  } catch {
    return false;
  }
}

// In-flight coalescing: one network burst per queryKey at a time.
const inflight = new Map<string, Promise<CdxResult>>();

export function queryKeyFor(handle: string, fromMs: number, toMs: number): string {
  return buildQueryKey(handle, fromMs, toMs);
}

export async function fetchCandidates(
  handle: string,
  fromMs: number,
  toMs: number,
  env: CdxEnv,
  cache: Cache,
): Promise<CdxResult> {
  const qk = queryKeyFor(handle, fromMs, toMs);
  const existing = inflight.get(qk);
  if (existing) return existing;
  const p = (async (): Promise<CdxResult> => {
    const key = cdxKey(qk);
    try {
      const hit = await cache.get<CdxResult>(key);
      if (hit) return { ...hit, cached: true };
    } catch {
      // ignore cache errors
    }
    const ua = env.WAYBACK_USER_AGENT || 'Receipts/1.0 (+contact: receipts@example.com)';

    /** Fetch one CDX bucket URL → Candidates (never throws; [] on failure). */
    async function fetchBucket(url: string): Promise<Candidate[]> {
      try {
        const res = await fetchCdxWithPolicy(url, ua);
        const json: unknown = await res.json();
        const rows = parseCdxJson(json);
        const out: Candidate[] = [];
        for (const row of rows) {
          const tweetId = extractTweetId(row.original);
          if (!tweetId) continue;
          let idTimeMs: number;
          try {
            idTimeMs = idToMs(tweetId);
          } catch {
            // Undecodable (e.g. pre-Snowflake): mark 0 and keep below.
            idTimeMs = 0;
          }
          out.push({
            tweetId,
            idTimeMs,
            snapshotTs: row.timestamp,
            originalUrl: row.original,
            archiveUrl: archiveUrl(row.timestamp, row.original),
            statusCode: row.statuscode,
          });
        }
        return out;
      } catch {
        return [];
      }
    }

    /**
     * Fetch bucket URLs with capped concurrency (good citizenship: smooths
     * bursts against the archive's ~60 req/min average ceiling instead of
     * firing the whole window at once).
     */
    async function fetchBuckets(urls: string[]): Promise<Candidate[][]> {
      const out: Candidate[][] = new Array(urls.length);
      let cursor = 0;
      async function worker(): Promise<void> {
        while (cursor < urls.length) {
          const i = cursor;
          cursor += 1;
          const url = urls[i];
          if (url === undefined) continue;
          out[i] = await fetchBucket(url);
        }
      }
      const pool = Math.min(3, urls.length);
      await Promise.all(Array.from({ length: pool }, () => worker()));
      return out;
    }

    function finalize(lists: Candidate[][]): { ranked: Candidate[]; truncated: boolean } {
      let truncated = false;
      for (const list of lists) {
        if (list.length >= CDX_LIMIT) truncated = true;
      }
      // Prefer earliest 200 per tweet id, collapsing x/twitter host variants.
      const deduped = dedupeByTweetId(lists.flat());
      // Exact tweet-time filter via Snowflake ID decode (CDX can't do this).
      // filterByIdTime drops undecodable rows; preserve the pre-2010
      // behavior (keep idTimeMs===0 rows) by re-appending them.
      const decodable = deduped.filter((c) => c.idTimeMs !== 0);
      const undecodable = deduped.filter((c) => c.idTimeMs === 0);
      const inWindow = [...filterByIdTime(decodable, fromMs, toMs), ...undecodable];
      return { ranked: inWindow.slice(0, CDX_LIMIT), truncated };
    }

    /**
     * Readability score for one capture. twitter.com + pre-July-2023 captures
     * are usually server-rendered (extractable text); post-2023 x.com captures
     * are usually JS shells. Used only to pick the representative capture per
     * tweet ID — never to drop IDs.
     */
    function readability(c: Candidate): number {
      let s = 0;
      if (c.originalUrl.includes('twitter.com')) s += 2;
      if (c.snapshotTs < '20230701') s += 1;
      return s;
    }

    async function runFor(h: string): Promise<{ ranked: Candidate[]; truncated: boolean; buckets: number }> {
      const lower = h.toLowerCase();
      // Window -> Snowflake ID range -> <= SEARCH_MAX_BUCKETS decimal prefixes.
      const minId = msToMinId(fromMs).toString();
      const maxId = msToMaxId(toMs).toString();
      const fromTs = toCdxTs(fromMs);
      const prefixes = idsToPrefixBuckets(minId, maxId, SEARCH_MAX_BUCKETS);
      // `from` is a CAPTURE-time lower bound only — never send `to=`: a
      // capture cannot predate the post but can postdate it by years.
      // Query BOTH hosts (x.com buckets + twitter.com buckets): readability
      // differs by host era, and per-ID selection below picks the best
      // representative. Bucket fetches share one concurrency-3 pool.
      const xUrls = prefixes.map((prefix) => buildCdxUrl(lower, prefix, fromTs));
      // buildCdxUrl emits url=x.com%2F... (slashes encoded): swap the host.
      const tUrls = xUrls.map((u) => u.replace('x.com%2F', 'twitter.com%2F'));
      const urls = [...xUrls, ...tUrls];
      const settled = await fetchBuckets(urls);
      // Per tweet ID keep the most readable status-200 capture (earliest on
      // ties); if no 200 exists keep the most readable overall.
      const byId = new Map<string, Candidate[]>();
      for (const c of settled.flat()) {
        const list = byId.get(c.tweetId);
        if (list) list.push(c);
        else byId.set(c.tweetId, [c]);
      }
      const picked: Candidate[] = [];
      for (const list of byId.values()) {
        const good = list.filter((c) => c.statusCode === 200);
        const pool = good.length > 0 ? good : list;
        pool.sort(
          (a, b) =>
            readability(b) - readability(a) || (a.snapshotTs < b.snapshotTs ? -1 : a.snapshotTs > b.snapshotTs ? 1 : 0),
        );
        const first = pool[0];
        if (first) picked.push(first);
      }
      const fin = finalize([picked]);
      return { ranked: fin.ranked, truncated: fin.truncated, buckets: urls.length };
    }

    let run = await runFor(handle);
    const anyCaps = await handleHasAnyCaptures(handle, ua);
    // Handle repair (SPEC §4.2): zero candidates → up to 6 cheap limit=1
    // probes with confusable variants; full bucket re-fetch for the first
    // variant that has captures. The UI flags the repair and the score is
    // capped (handleOK=false).
    let repairedHandle: string | undefined;
    if (run.ranked.length === 0) {
      const variants = repairCandidates(handle).filter(
        (v) => v !== handle.toLowerCase() && /^[a-z0-9_]{1,15}$/.test(v),
      );
      for (const v of variants) {
        if (await handleHasAnyCaptures(v, ua)) {
          const retry = await runFor(v);
          if (retry.ranked.length > 0) {
            run = retry;
            repairedHandle = v;
            break;
          }
        }
      }
    }
    const result: CdxResult = {
      candidates: run.ranked,
      coverage: {
        buckets: run.buckets,
        totalCaptures: run.ranked.length,
        truncated: run.truncated,
        handleHasAnyCaptures: anyCaps || repairedHandle !== undefined,
        ...(repairedHandle !== undefined ? { repairedHandle } : {}),
      },
      cached: false,
    };
    try {
      await cache.set(key, result, cdxTtlSec(run.ranked.length === 0));
    } catch {
      // ignore
    }
    return result;
  })();
  inflight.set(qk, p);
  try {
    return await p;
  } finally {
    inflight.delete(qk);
  }
}
