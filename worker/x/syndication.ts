// X syndication cross-check (server-side only).
//
// X exposes a public, keyless embed endpoint (the same one Vercel's
// react-tweet uses) that returns the AUTHORITATIVE tweet for a tweet ID:
//   GET https://cdn.syndication.twimg.com/tweet-result?id={id}&lang=en&token={t}
// Only the already-public tweet ID leaves the device (no screenshot, no user
// text). Unofficial and unversioned: always keep the archive fallback, cache
// briefly, stay concurrency-capped. Verified live 2026-10-03.
import { CDX_TIMEOUT_MS } from '../../lib/config';

export interface SyndicationEnv {
  WAYBACK_USER_AGENT?: string;
}

export type SyndicationStatus = 'live' | 'unavailable';

export interface SyndicatedTweet {
  status: SyndicationStatus;
  id: string;
  /** Exact post text when live (t.co links intact), else null. */
  text: string | null;
  screenName: string | null;
  createdAtIso: string | null;
  favoriteCount: number | null;
  cached: boolean;
}

const ID_RE = /^\d{1,25}$/;
const SYND_HOST = 'cdn.syndication.twimg.com';

/**
 * Embed token. BigInt-safe (tweet IDs exceed 2^53 — never Number(id)):
 * quotient + remainder-fraction replicate Number(id)/1e15 exactly.
 * Verified: id 957414748881997825 -> '2bjt21ztkvx'
 *           id 1256236544704686336 -> '31ml7rymai'.
 */
export function tokenFor(id: string): string {
  if (!ID_RE.test(id)) throw new Error('bad tweet id');
  const q = BigInt(id) / 10n ** 15n;
  const r = BigInt(id) % 10n ** 15n;
  return ((Number(q) + Number(r) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

export function syndicationUrl(id: string): string {
  // id validated inside tokenFor; URL host is a constant (SSRF-safe).
  const token = tokenFor(id);
  return `https://${SYND_HOST}/tweet-result?id=${id}&lang=en&token=${token}`;
}

interface CacheEntry {
  value: Omit<SyndicatedTweet, 'cached'>;
  expiresAt: number;
}

const mem = new Map<string, CacheEntry>();
const TTL_LIVE_MS = 60 * 60 * 1000;
const TTL_DEAD_MS = 10 * 60 * 1000;

function readCache(id: string): Omit<SyndicatedTweet, 'cached'> | null {
  const e = mem.get(id);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    mem.delete(id);
    return null;
  }
  return e.value;
}

interface TweetJson {
  __typename?: string;
  text?: unknown;
  id_str?: unknown;
  created_at?: unknown;
  favorite_count?: unknown;
  user?: { screen_name?: unknown } | null;
}

function parseLive(id: string, json: unknown): Omit<SyndicatedTweet, 'cached'> | null {
  if (typeof json !== 'object' || json === null) return null;
  const t = json as TweetJson;
  // Deleted-with-tombstone or any non-Tweet shape is not authoritative text.
  if (t.__typename !== undefined && t.__typename !== 'Tweet') return null;
  if (typeof t.text !== 'string' || t.text.trim() === '') return null;
  const screenName = typeof t.user?.screen_name === 'string' ? t.user.screen_name : null;
  const createdAt = typeof t.created_at === 'string' ? t.created_at : null;
  const fav = typeof t.favorite_count === 'number' ? t.favorite_count : null;
  return { status: 'live', id, text: t.text, screenName, createdAtIso: createdAt, favoriteCount: fav };
}

const unavailable = (id: string): Omit<SyndicatedTweet, 'cached'> => ({
  status: 'unavailable',
  id,
  text: null,
  screenName: null,
  createdAtIso: null,
  favoriteCount: null,
});

/** Fetch the authoritative tweet; never throws (unavailable on any failure). */
export async function fetchSyndicatedTweet(id: string, env: SyndicationEnv): Promise<SyndicatedTweet> {
  if (!ID_RE.test(id)) throw new Error('bad tweet id');
  const hit = readCache(id);
  if (hit) return { ...hit, cached: true };
  const ua = env.WAYBACK_USER_AGENT || 'Receipts/1.0 (+contact: receipts@example.com)';
  let value: Omit<SyndicatedTweet, 'cached'> = unavailable(id);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CDX_TIMEOUT_MS);
    try {
      const res = await fetch(syndicationUrl(id), {
        signal: ctrl.signal,
        redirect: 'manual',
        headers: { 'user-agent': ua, accept: 'application/json' },
      });
      const loc = res.headers.get('location');
      if (loc) {
        const next = new URL(loc, `https://${SYND_HOST}`);
        if (next.hostname !== SYND_HOST) throw new Error('refused cross-host redirect');
      } else if (res.ok) {
        const ctype = (res.headers.get('content-type') ?? '').toLowerCase();
        if (ctype.includes('json')) {
          const parsed = parseLive(id, (await res.json()) as unknown);
          if (parsed) value = parsed;
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    value = unavailable(id);
  }
  mem.set(id, { value, expiresAt: Date.now() + (value.status === 'live' ? TTL_LIVE_MS : TTL_DEAD_MS) });
  if (mem.size > 500) {
    const first = mem.keys().next().value;
    if (first !== undefined) mem.delete(first);
  }
  return { ...value, cached: false };
}
