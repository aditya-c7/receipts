// Server-side Wayback snapshot fetch + extraction (server-only).
// Extraction delegates to lib/wayback/snapshot.ts (ldjson > og > classic >
// embeddedJson > title > none) so tested code is shipped code; the
// Worker-side fetch/redirect-policy/content-type-gate/byte-cap/cache
// wrappers live here.
//
// Safety: allowlisted hosts only, refuse cross-host redirects, content-type
// gate, byte cap, timeout, Upstash/memory caching.
import { SNAPSHOT_MAX_BYTES, SNAPSHOT_TIMEOUT_MS } from '../../lib/config';
import type { ArchivedPost } from '../../lib/types';
import { extractArchivedPost as extractLibPost } from '../../lib/wayback/snapshot';
import { type Cache, snapKey, snapTtlSec } from '../cache/redis';

export interface SnapshotEnv {
  WAYBACK_USER_AGENT?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
}

export interface SnapshotResult {
  archiveUrl: string;
  extracted: ArchivedPost;
  cached: boolean;
}

const ALLOWED_HOSTS = new Set(['web.archive.org', 'archive.org']);
const STATUS_RE = /^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+$/;
const TS_RE = /^\d{14}$/;

/** Canonical replay URL (raw variant). Server-side only. */
export function buildSnapshotUrl(snapshotTs: string, originalUrl: string): string {
  return `https://web.archive.org/web/${snapshotTs}id_/${originalUrl}`;
}

/** Framed replay variant for sandboxed preview. */
export function toPreviewUrl(archiveUrl: string): string {
  return archiveUrl.replace('/web/', '/web/').includes('id_')
    ? archiveUrl.replace('id_/', 'if_/')
    : archiveUrl;
}

/** Delegated extractor (lib order: ldjson > og > classic > embeddedJson > title > none). */
export function extractArchivedPost(html: string, _url?: string): ArchivedPost {
  void _url;
  return extractLibPost(html);
}

async function fetchWithRedirectPolicy(url: string, userAgent: string): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), SNAPSHOT_TIMEOUT_MS);
    try {
      const res = await fetch(current, {
        signal: ctrl.signal,
        redirect: 'manual',
        headers: { 'user-agent': userAgent, accept: 'text/html,application/json' },
      });
      const status = res.status;
      if (status >= 300 && status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new Error('redirect without location');
        const next = new URL(loc, current);
        if (next.protocol !== 'https:' || !ALLOWED_HOSTS.has(next.hostname)) {
          throw new Error('refused cross-host redirect');
        }
        current = next.toString();
        continue;
      }
      return res;
    } finally {
      clearTimeout(t);
    }
  }
  throw new Error('too many redirects');
}

export async function fetchSnapshot(
  snapshotTs: string,
  originalUrl: string,
  env: SnapshotEnv,
  cache: Cache,
): Promise<SnapshotResult> {
  if (!TS_RE.test(snapshotTs)) throw new Error('bad snapshotTs');
  if (!STATUS_RE.test(originalUrl)) throw new Error('bad originalUrl');
  const archiveUrl = buildSnapshotUrl(snapshotTs, originalUrl);
  const key = snapKey(snapshotTs, originalUrl);

  try {
    const hit = await cache.get<SnapshotResult>(key);
    if (hit) return { ...hit, cached: true };
  } catch {
    // ignore
  }

  const ua = env.WAYBACK_USER_AGENT || 'Receipts/1.0 (+contact: receipts@example.com)';
  const res = await fetchWithRedirectPolicy(archiveUrl, ua);
  if (!res.ok) throw new Error(`snapshot status ${res.status}`);
  const ctype = (res.headers.get('content-type') ?? '').toLowerCase();
  if (!ctype.includes('text/html') && !ctype.includes('application/json')) {
    throw new Error(`unsupported content-type ${ctype || 'unknown'}`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > SNAPSHOT_MAX_BYTES) throw new Error('snapshot too large');
  const html = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  const extracted = extractArchivedPost(html, originalUrl);
  const result: SnapshotResult = { archiveUrl, extracted, cached: false };
  try {
    await cache.set(key, result, snapTtlSec());
  } catch {
    // ignore
  }
  return result;
}
