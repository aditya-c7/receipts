// CDX search against the Wayback Machine (server-side only).
//
// Deliberate local implementation (see docs/DECISIONS.md): wildcard prefix
// queries + from-only bound + Snowflake ID-time filter. lib/wayback/* holds
// the pure, unit-tested primitives (snowflake/buckets/urls/cdx-parse); the
// fetch orchestration lives here because it needs Worker fetch + cache.
import {
  CDX_LIMIT,
  CDX_TIMEOUT_MS,
  SEARCH_MAX_BUCKETS,
} from '../../lib/config';
import type { Candidate } from '../../lib/types';
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
}

export interface CdxResult {
  candidates: Candidate[];
  coverage: CoverageInfo;
  cached: boolean;
}

const CDX_ENDPOINT = 'https://web.archive.org/cdx/search/cdx';
const TWEET_ID_RE = /\/status\/(\d{1,25})/;
const SNOWFLAKE_EPOCH = 1288834974657n;

/** Tweet Snowflake -> created-at ms (IDs exceed 2^53, so BigInt; result fits in f64). */
export function snowflakeToMs(idStr: string): number {
  try {
    const ts = (BigInt(idStr) >> 22n) + SNOWFLAKE_EPOCH;
    return Number(ts);
  } catch {
    return 0;
  }
}

function toCdxTs(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

/**
 * Candidate discovery (few-users simplification; see docs/DECISIONS.md).
 * One CDX query per host (x.com, twitter.com) with a capture-time `from=`
 * lower bound ONLY — never a `to=` upper bound: a capture cannot predate
 * the post but can postdate it by years. Exact tweet-time filtering happens
 * below via Snowflake ID decode, which the CDX API cannot do server-side.
 */
export function buildCdxRequests(handle: string, fromMs: number, _toMs: number): string[] {
  const h = handle.toLowerCase();
  const hosts = [`x.com/${h}/status`, `twitter.com/${h}/status`];
  const out: string[] = [];
  for (const host of hosts) {
    const q = new URLSearchParams({
      url: `${host}/*`,
      from: toCdxTs(fromMs),
      output: 'json',
      filter: 'statuscode:200',
      collapse: 'urlkey',
      limit: String(CDX_LIMIT),
    });
    out.push(`${CDX_ENDPOINT}?${q.toString()}`);
    if (out.length >= SEARCH_MAX_BUCKETS) return out;
  }
  return out;
}

/** Parse CDX output=json (array-of-arrays with header row) into Candidates. */
export function parseCdxResponse(json: unknown): Candidate[] {
  if (!Array.isArray(json) || json.length < 2) return [];
  const rows = json.slice(1);
  const out: Candidate[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 5) continue;
    const ts = String(r[1] ?? '');
    const original = String(r[2] ?? '');
    const statusCode = Number(r[4] ?? 0);
    if (!/^\d{14}$/.test(ts)) continue;
    const m = original.match(TWEET_ID_RE);
    if (!m || !m[1]) continue;
    const tweetId = m[1];
    out.push({
      tweetId,
      idTimeMs: snowflakeToMs(tweetId),
      snapshotTs: ts,
      originalUrl: original,
      archiveUrl: `https://web.archive.org/web/${ts}id_/${original}`,
      statusCode,
    });
  }
  return out;
}

/** Dedupe on originalUrl|snapshotTs, keeping first occurrence. */
export function dedupeCandidates(cands: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of cands) {
    const k = `${c.originalUrl}|${c.snapshotTs}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/** Local time-consistency rank: in-window first, then nearest to window center. */
export function rankByTimeConsistency(cands: Candidate[], fromMs: number, toMs: number): Candidate[] {
  const center = (fromMs + toMs) / 2;
  return [...cands].sort((a, b) => {
    const aIn = a.idTimeMs >= fromMs && a.idTimeMs <= toMs ? 0 : 1;
    const bIn = b.idTimeMs >= fromMs && b.idTimeMs <= toMs ? 0 : 1;
    if (aIn !== bIn) return aIn - bIn;
    return Math.abs(a.idTimeMs - center) - Math.abs(b.idTimeMs - center);
  });
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
    const requests = buildCdxRequests(handle, fromMs, toMs);
    const settled = await Promise.all(
      requests.map(async (url) => {
        try {
          const res = await fetchCdxWithPolicy(url, ua);
          const json: unknown = await res.json();
          return parseCdxResponse(json);
        } catch {
          return [] as Candidate[];
        }
      }),
    );
    let truncated = false;
    for (const list of settled) {
      if (list.length >= CDX_LIMIT) truncated = true;
    }
    const merged = dedupeCandidates(settled.flat());
    // Exact tweet-time filter via Snowflake ID decode (CDX can't do this).
    // idTimeMs === 0 means undecodable (e.g. pre-2010 non-Snowflake IDs):
    // keep those rather than dropping them.
    const inWindow = merged.filter(
      (c) => c.idTimeMs === 0 || (c.idTimeMs >= fromMs && c.idTimeMs <= toMs),
    );
    const ranked = rankByTimeConsistency(inWindow, fromMs, toMs).slice(0, CDX_LIMIT);
    const anyCaps = await handleHasAnyCaptures(handle, ua);
    const result: CdxResult = {
      candidates: ranked,
      coverage: {
        buckets: requests.length,
        totalCaptures: ranked.length,
        truncated,
        handleHasAnyCaptures: anyCaps,
      },
      cached: false,
    };
    try {
      await cache.set(key, result, cdxTtlSec(ranked.length === 0));
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
