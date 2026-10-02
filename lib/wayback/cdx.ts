// CDX helpers: parse, dedupe, time-window filter, URL builder.
import { CDX_LIMIT } from '../config';
import { extractTweetId } from './urls';
import { idToMs } from './snowflake';

export interface CdxRow {
  timestamp: string;
  original: string;
  statuscode: number;
  mimetype: string;
  digest: string;
}

/** Parse CDX `output=json` body. First row is the header; empty/missing body -> []. */
export function parseCdxJson(json: unknown): CdxRow[] {
  if (!Array.isArray(json) || json.length === 0) return [];
  const [header, ...rows] = json as unknown[];
  if (!Array.isArray(header)) return [];
  const idx = (name: string): number => header.indexOf(name);
  const iTs = idx('timestamp');
  const iOrig = idx('original');
  const iStatus = idx('statuscode');
  const iMime = idx('mimetype');
  const iDigest = idx('digest');
  if (iTs < 0 || iOrig < 0) return [];
  const out: CdxRow[] = [];
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    const get = (i: number): string => (i >= 0 && r[i] != null ? String(r[i] as unknown) : '');
    const timestamp = get(iTs);
    const original = get(iOrig);
    if (!timestamp || !original) continue;
    const statuscode = iStatus >= 0 ? Number(r[iStatus] as unknown) : 0;
    out.push({
      timestamp,
      original,
      statuscode: Number.isFinite(statuscode) ? statuscode : 0,
      mimetype: get(iMime),
      digest: get(iDigest),
    });
  }
  return out;
}

interface RowView {
  original: string;
  timestamp: string;
  statuscode: number | string;
}

function viewOf<T>(row: T): RowView | null {
  const r = row as Record<string, unknown>;
  const original =
    typeof r['original'] === 'string'
      ? (r['original'] as string)
      : typeof r['originalUrl'] === 'string'
        ? (r['originalUrl'] as string)
        : null;
  const timestamp =
    typeof r['timestamp'] === 'string'
      ? (r['timestamp'] as string)
      : typeof r['snapshotTs'] === 'string'
        ? (r['snapshotTs'] as string)
        : null;
  const statusRaw = r['statuscode'] ?? r['statusCode'];
  const statuscode = typeof statusRaw === 'number' || typeof statusRaw === 'string' ? statusRaw : 0;
  if (original == null || timestamp == null) return null;
  return { original, timestamp, statuscode };
}

/**
 * Dedupe by tweet id (host variants x/twitter/www/mobile collapse via
 * extractTweetId). For each id keep the earliest capture with status 200;
 * if none is 200, keep the earliest overall.
 */
export function dedupeByTweetId<T>(rows: T[]): T[] {
  const groups = new Map<string, { row: T; ts: string; status: number }>();
  for (const row of rows) {
    const v = viewOf(row);
    if (!v) continue;
    const id = extractTweetId(v.original);
    if (!id) continue;
    const status = Number(v.statuscode);
    const prev = groups.get(id);
    if (!prev) {
      groups.set(id, { row, ts: v.timestamp, status: Number.isFinite(status) ? status : 0 });
      continue;
    }
    const prevIs200 = prev.status === 200;
    const curIs200 = status === 200;
    if (curIs200 && !prevIs200) {
      groups.set(id, { row, ts: v.timestamp, status });
    } else if (curIs200 === prevIs200 && v.timestamp < prev.ts) {
      groups.set(id, { row, ts: v.timestamp, status: Number.isFinite(status) ? status : 0 });
    }
  }
  return [...groups.values()].map((g) => g.row);
}

function idTimeOf<T>(row: T): number | null {
  const r = row as Record<string, unknown>;
  if (typeof r['idTimeMs'] === 'number' && Number.isFinite(r['idTimeMs'])) {
    return r['idTimeMs'] as number;
  }
  const v = viewOf(row);
  if (!v) return null;
  const id = extractTweetId(v.original);
  if (!id) return null;
  try {
    return idToMs(id);
  } catch {
    return null;
  }
}

/** Keep candidates whose tweet-creation time falls in [fromMs, toMs] (inclusive edges). */
export function filterByIdTime<T>(cands: T[], fromMs: number, toMs: number): T[] {
  return cands.filter((c) => {
    const t = idTimeOf(c);
    if (t == null) return false;
    return t >= fromMs && t <= toMs;
  });
}

/** Build a CDX prefix-search URL for handle/status/prefix captures since fromTs. */
export function buildCdxUrl(handle: string, prefix: string, fromTs: string): string {
  // Keep canonical substrings literal for testability (commas/colons unencoded).
  const url = `x.com/${handle}/status/${prefix}`;
  return (
    `https://web.archive.org/cdx/search/cdx?` +
    `url=${encodeURIComponent(url)}` +
    `&from=${encodeURIComponent(fromTs)}` +
    `&matchType=prefix` +
    `&fl=timestamp,original,statuscode,mimetype,digest` +
    `&filter=statuscode:200` +
    `&collapse=urlkey` +
    `&limit=${CDX_LIMIT}` +
    `&output=json`
  );
}
