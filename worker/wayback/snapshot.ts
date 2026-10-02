// Server-side Wayback snapshot fetch + extraction (server-only cheerio pass).
// lib/wayback/snapshot.ts holds the pure extractor chain used by tests; this
// module mirrors its order (ldjson > embeddedJson > og > classic > title)
// for the Worker runtime.
//
// Safety: allowlisted hosts only, refuse cross-host redirects, content-type
// gate, byte cap, timeout, Upstash/memory caching.
import { load } from 'cheerio';
import { SNAPSHOT_MAX_BYTES, SNAPSHOT_TIMEOUT_MS } from '../../lib/config';
import type { ArchivedPost } from '../../lib/types';
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

function textOrNull(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return t ? t : null;
}

function tryParseJsonObjects(html: string): string[] {
  // Collect candidate JSON blobs from <script> tags for embedded-state parsing.
  const out: string[] = [];
  const re = /<script[^>]*>([\s\S]{0,200000}?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const body = m[1] ?? '';
    if (body.includes('full_text') || body.includes('"text"')) out.push(body);
    if (out.length >= 5) break;
  }
  return out;
}

function extractEmbeddedJson(html: string): string | null {
  for (const blob of tryParseJsonObjects(html)) {
    const m =
      blob.match(/"full_text"\s*:\s*"((?:[^"\\]|\\.)*)"/) ?? blob.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m && m[1]) {
      try {
        const decoded = JSON.parse(`"${m[1]}"`) as unknown;
        if (typeof decoded === 'string') return textOrNull(decoded);
      } catch {
        // fall through
      }
    }
  }
  return null;
}

/** DOM-free-ish extraction over server-fetched HTML (cheerio runs in Workers via nodejs_compat). */
export function extractArchivedPost(html: string, _url: string): ArchivedPost {
  const $ = load(html);

  // 1. ld+json articleBody
  const ldNodes = $('script[type="application/ld+json"]');
  for (let i = 0; i < ldNodes.length; i++) {
    try {
      const raw = $(ldNodes[i]).text();
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (typeof item === 'object' && item !== null) {
          const rec = item as Record<string, unknown>;
          const body = rec['articleBody'];
          if (typeof body === 'string' && body.trim()) {
            return { text: textOrNull(body), extractor: 'ldjson' };
          }
        }
      }
    } catch {
      // keep trying
    }
  }

  // 2. embedded JSON state (full_text)
  const embedded = extractEmbeddedJson(html);
  if (embedded) return { text: embedded, extractor: 'embeddedJson' };

  // 3. OpenGraph description
  const og = $('meta[property="og:description"]').attr('content') ?? $('meta[name="description"]').attr('content');
  const ogText = textOrNull(og);
  if (ogText) return { text: ogText, extractor: 'og' };

  // 4. classic tweet selectors
  const classic =
    textOrNull($('[data-testid="tweetText"]').first().text()) ??
    textOrNull($('.tweet-text').first().text()) ??
    textOrNull($('#tweet-content').first().text());
  if (classic) return { text: classic, extractor: 'classic' };

  // 5. title fallback (strip " / X" suffixes)
  const title = textOrNull($('title').first().text())?.replace(/\s*\/\s*X\s*$/i, '') ?? null;
  if (title && title.length > 8) return { text: title, extractor: 'title' };

  return { text: null, extractor: 'none' };
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
