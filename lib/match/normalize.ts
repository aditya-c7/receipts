// Text normalization for screenshot-vs-archive comparison.

const URL_RE = /https?:\/\/\S+|[a-z0-9-]+\.t\.co\/\S*|pic\.(?:twitter|x)\.com\/\S*/gi;
const BARE_TCO_RE = /\bt\.co\/\S+/gi;
const BARE_PIC_RE = /\bpic\.(?:twitter|x)\.com\/\S*/gi;

// Extended pictographic (emoji) + zero-width / format chars.
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
// eslint-disable-next-line no-misleading-character-class
const ZW_RE = /[\u200B\u200C\u200D\uFEFF\u2060\u00AD]/g;

const QUOTE_MAP: Array<[RegExp, string]> = [
  [/[‘’‚‛‹›`´ʹʺ′‵]/g, "'"],
  [/[“”„‟«»]/g, '"'],
];

const DASH_RE = /[‐‑‒–—―−]/g;
const ELLIPSIS_RE = /\u2026/g;

function baseNormalize(s: string): string {
  let t = s.normalize('NFKC').toLowerCase();
  t = t.replace(URL_RE, ' ');
  t = t.replace(BARE_TCO_RE, ' ');
  t = t.replace(BARE_PIC_RE, ' ');
  t = t.replace(EMOJI_RE, ' ');
  t = t.replace(ZW_RE, '');
  for (const [re, rep] of QUOTE_MAP) t = t.replace(re, rep);
  t = t.replace(DASH_RE, '-');
  t = t.replace(ELLIPSIS_RE, '...');
  // Fold remaining curly quotes that NFKC missed (explicit per spec).
  t = t
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, '-');
  return t;
}

/**
 * NFKC, lowercase, strip URLs, strip emoji + zero-width, fold
 * quotes/dashes/ellipsis, keep only letters+numbers + single spaces.
 */
export function normalizeText(s: string): string {
  const t = baseNormalize(s);
  return t
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CONFUSABLE_SINGLE: Record<string, string> = {
  '0': 'o',
  '1': 'l',
  '|': 'l',
  '5': 's',
  '8': 'b',
};

/**
 * normalizeText + confusable fold {0:o, 1:l, |:l, 5:s, 8:b, rn:m, vv:w}.
 * NOTE: deliberately NOT folding i (1/| -> l only).
 */
export function normalizeFolded(s: string): string {
  let t = baseNormalize(s);
  // Multi-char folds first.
  t = t.replace(/rn/g, 'm').replace(/vv/g, 'w');
  let out = '';
  for (const ch of t) {
    out += CONFUSABLE_SINGLE[ch] ?? ch;
  }
  return out
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
