// Embedded-JSON extractor: modern X payloads (full_text / note_tweet, __NEXT_DATA__).
import type { CheerioAPI } from 'cheerio';

export interface EmbeddedResult {
  text: string | null;
  displayName?: string;
  handle?: string;
  createdAtIso?: string;
}

function tryJsonDecode(s: string): string | null {
  const t = s.trim();
  if (t === '') return null;
  // Plain string already.
  if (!t.startsWith('"') && !t.startsWith('{') && !t.startsWith('[')) return s;
  try {
    const v: unknown = JSON.parse(t);
    if (typeof v === 'string') {
      // May be double-encoded.
      try {
        const inner: unknown = JSON.parse(v);
        if (typeof inner === 'string') return inner;
      } catch {
        // single-encoded
      }
      return v;
    }
    return null;
  } catch {
    // Try unescaping \" sequences manually.
    try {
      const v: unknown = JSON.parse(`"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
      if (typeof v === 'string') return v;
    } catch {
      return null;
    }
    return null;
  }
}

function collectStrings(node: unknown, out: string[], depth: number): void {
  if (depth > 12) return;
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectStrings(v, out, depth + 1);
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'full_text' || k === 'text' || k === 'tweet_text') {
        if (typeof v === 'string' && v.trim() !== '') out.push(v);
      }
      collectStrings(v, out, depth + 1);
    }
  }
}

function findLegacy(html: string): string | null {
  // Regex over raw HTML for "full_text":"..." (JSON-escaped).
  const re = /"(?:full_text|note_tweet)"\s*:\s*("(?:\\.|[^"\\])*")/g;
  let m: RegExpExecArray | null;
  const cands: string[] = [];
  while ((m = re.exec(html)) !== null) {
    const raw = m[1];
    if (raw === undefined) continue;
    const decoded = tryJsonDecode(raw);
    if (decoded != null && decoded.trim() !== '') cands.push(decoded);
    if (cands.length >= 5) break;
  }
  if (cands.length === 0) return null;
  // Longest plausible tweet text wins.
  cands.sort((a, b) => b.length - a.length);
  return (cands[0] as string).trim();
}

export function extractEmbeddedJson($: CheerioAPI, rawHtml: string): EmbeddedResult | null {
  // 1) __NEXT_DATA__ structured parse.
  const nextRaw = $('#__NEXT_DATA__').html();
  if (nextRaw != null && nextRaw.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(nextRaw);
      const strings: string[] = [];
      collectStrings(parsed, strings, 0);
      const best = strings.filter((s) => s.trim().length >= 2).sort((a, b) => b.length - a.length)[0];
      if (best != null && best.trim() !== '') {
        // Prefer strings that look like tweet bodies over nav chrome: skip very long blobs?
        const t = best.trim();
        if (t.length <= 2000) return { text: t };
      }
    } catch {
      // fall through to regex
    }
  }
  // 2) Regex fallback over raw HTML.
  const found = findLegacy(rawHtml);
  if (found != null) return { text: found };
  return null;
}
