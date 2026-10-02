// Similarity: full/token/partial over plain+folded normalizations.
import { distance } from 'fastest-levenshtein';
import { normalizeText, normalizeFolded } from './normalize';

export interface SimilarityDetail {
  full: number;
  partial: number;
  tokenSet: number;
  foldedFull: number;
  foldedPartial: number;
  foldedTokenSet: number;
  rawMax: number;
  cappedBy: string | null;
  numberMismatch: boolean;
  note: string | null;
}

/** 1 - lev/maxLen (1 when both empty, 0 when one empty). */
export function levenshteinFull(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const d = distance(a, b);
  const m = Math.max(a.length, b.length);
  return 1 - d / m;
}

/** Sliding best of shorter-in-longer (window = shorter length). */
export function partialSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  let short = a;
  let long = b;
  if (short.length > long.length) {
    short = b;
    long = a;
  }
  const w = short.length;
  if (w === 0) return 0;
  // Exact substring shortcut.
  if (long.includes(short)) return 1;
  let best = 0;
  // Bound windows for very long inputs (tweets are short; still safe).
  const maxWindows = 400;
  const step = Math.max(1, Math.floor((long.length - w + 1) / maxWindows));
  for (let i = 0; i + w <= long.length; i += step) {
    const win = long.slice(i, i + w);
    const d = distance(short, win);
    const s = 1 - d / w;
    if (s > best) {
      best = s;
      if (best >= 1) break;
    }
  }
  return best;
}

/** Aliases for spec shorthand. */
export const partial = partialSimilarity;

function tokens(s: string): string[] {
  return s.split(' ').filter((t) => t !== '');
}

/** Dice over token sets: 2|∩|/(|A|+|B|). */
export function tokenSetSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setB = new Set(tb);
  let inter = 0;
  for (const t of new Set(ta)) {
    if (setB.has(t)) {
      // Count multiplicities minimally: min(countA, countB).
      const ca = ta.filter((x) => x === t).length;
      const cb = tb.filter((x) => x === t).length;
      inter += Math.min(ca, cb);
    }
  }
  return (2 * inter) / (ta.length + tb.length);
}

export const tokenSet = tokenSetSimilarity;
export const tokenSetRatio = tokenSetSimilarity;

function numberTokens(s: string): string[] {
  const m = s.match(/\d+/g);
  return m ? [...m].sort() : [];
}

/**
 * max(full, 0.92*partial, 0.85*tokenSet) over plain + folded normalizations.
 * Guards: <25 chars caps at 0.80; differing numeric token sets cap at 0.89.
 */
export function textSimilarity(a: string, b: string): { score: number; detail: SimilarityDetail } {
  const plainA = normalizeText(a);
  const plainB = normalizeText(b);
  const foldA = normalizeFolded(a);
  const foldB = normalizeFolded(b);

  const full = levenshteinFull(plainA, plainB);
  const part = partialSimilarity(plainA, plainB);
  const tok = tokenSetSimilarity(plainA, plainB);
  const fFull = levenshteinFull(foldA, foldB);
  const fPart = partialSimilarity(foldA, foldB);
  const fTok = tokenSetSimilarity(foldA, foldB);

  const cands = [full, 0.92 * part, 0.85 * tok, fFull, 0.92 * fPart, 0.85 * fTok];
  let rawMax = cands[0] as number;
  for (const c of cands) if (c > rawMax) rawMax = c;

  let score = rawMax;
  let cappedBy: string | null = null;
  let note: string | null = null;

  const listA = numberTokens(plainA);
  const listB = numberTokens(plainB);
  // Only cap when BOTH sides contain numbers and the sets differ.
  // This keeps OCR confusables (0/o, 1/l) and stripped URLs from tripping
  // the guard, while still catching true numeral edits (240 vs 241).
  const bothHaveNumbers = listA.length > 0 && listB.length > 0;
  const numberMismatch = bothHaveNumbers && listA.join('|') !== listB.join('|');
  if (numberMismatch && score > 0.89) {
    score = 0.89;
    cappedBy = 'number';
  }

  const minLen = Math.min(plainA.length, plainB.length);
  if (minLen < 25 && score > 0.8) {
    score = 0.8;
    // Keep number cap provenance if both apply.
    cappedBy = cappedBy === 'number' ? 'number+length' : 'length';
    note = 'short-text: under 25 chars, capped at 0.80';
  }

  return {
    score,
    detail: {
      full,
      partial: part,
      tokenSet: tok,
      foldedFull: fFull,
      foldedPartial: fPart,
      foldedTokenSet: fTok,
      rawMax,
      cappedBy,
      numberMismatch,
      note,
    },
  };
}
