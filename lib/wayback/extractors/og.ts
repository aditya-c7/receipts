// OpenGraph extractor: og:description (+ og:title "Name on X: "text" / X").
import type { CheerioAPI } from 'cheerio';

export interface OgResult {
  text: string | null;
  displayName?: string;
  handle?: string;
  createdAtIso?: string;
}

function stripSurroundingQuotes(s: string): string {
  let t = s.trim();
  // Strip ASCII + curly quotes repeatedly.
  for (let i = 0; i < 3; i++) {
    const first = t.charAt(0);
    const last = t.charAt(t.length - 1);
    const pairs: Array<[string, string]> = [
      ['"', '"'],
      ["'", "'"],
      ['\u201c', '\u201d'],
      ['\u2018', '\u2019'],
      ['\u00ab', '\u00bb'],
    ];
    let stripped = false;
    for (const [a, b] of pairs) {
      if (t.length >= 2 && first === a && last === b) {
        t = t.slice(1, -1).trim();
        stripped = true;
        break;
      }
    }
    if (!stripped) break;
  }
  return t;
}

export function parseOgTitle(title: string): { displayName?: string; text?: string } {
  // Forms: `Display Name on X: "tweet" / X`, `Display Name on Twitter: "tweet"`,
  // `Display Name on X: "tweet"`, with straight or curly quotes.
  const m = /^(.*?)\s+on\s+(?:X|Twitter)\s*:\s*[“"«']([\s\S]*?)[”"»']\s*(?:\/\s*X)?\s*$/.exec(title.trim());
  if (!m) return {};
  const out: { displayName?: string; text?: string } = {};
  const name = (m[1] ?? '').trim();
  const text = (m[2] ?? '').trim();
  if (name) out.displayName = name;
  if (text) out.text = text;
  return out;
}

function meta($: CheerioAPI, names: string[]): string | null {
  for (const n of names) {
    const v =
      $(`meta[property="${n}"]`).attr('content') ?? $(`meta[name="${n}"]`).attr('content') ?? null;
    if (v != null && v.trim() !== '') return v;
  }
  return null;
}

export function extractOg($: CheerioAPI): OgResult | null {
  const desc = meta($, ['og:description', 'twitter:description']);
  const titleRaw = meta($, ['og:title', 'twitter:title']);
  let text: string | null = null;
  let displayName: string | undefined;
  if (desc != null) {
    const cleaned = stripSurroundingQuotes(desc);
    if (cleaned !== '') text = cleaned;
  }
  if (titleRaw != null) {
    const parsed = parseOgTitle(titleRaw);
    if (parsed.displayName) displayName = parsed.displayName;
    // og:title text is a fallback when no description exists.
    if (text == null && parsed.text) text = parsed.text;
  }
  if (text == null) return null;
  const out: OgResult = { text };
  if (displayName) out.displayName = displayName;
  return out;
}
