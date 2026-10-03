// Neutral word diff (labels carry no color semantics).
//
// diffWords (diff's default) tokenizes punctuation separately, which shreds
// URLs into confetti ("https", ":", "/", ... aligning independently). We
// diff whitespace-separated WORDS via diffArrays and strip URLs first (they
// are stripped for scoring too), so each changed word renders as one row.
import { diffArrays } from 'diff';

export interface WordDiffPart {
  op: 'eq' | 'del' | 'ins';
  text: string;
}

const URL_RE = /https?:\/\/\S+|t\.co\/\w+|pic\.(twitter|x)\.com\/\w+/gi;

/** Remove links for display (scoring ignores them as well). */
export function stripUrlsForDisplay(s: string): string {
  return s
    .replace(URL_RE, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

function tokenize(s: string): string[] {
  return s.split(/(\s+)/).filter((t) => t !== '');
}

/** Word-level diff with neutral op labels. Runs of whitespace attach to the previous part. */
export function wordDiff(a: string, b: string): WordDiffPart[] {
  const parts = diffArrays(tokenize(a), tokenize(b));
  const out: WordDiffPart[] = [];
  for (const p of parts) {
    const text = p.value.join('');
    if (text === '') continue;
    const op: WordDiffPart['op'] = p.added ? 'ins' : p.removed ? 'del' : 'eq';
    const prev = out[out.length - 1];
    if (/^\s+$/.test(text) && prev !== undefined) {
      prev.text += text;
      continue;
    }
    out.push({ op, text });
  }
  if (out.length === 0) return [{ op: 'eq', text: '' }];
  return out;
}

/** Diff what we actually compare: URLs stripped, whole words only. */
export function diffForDisplay(a: string, b: string): WordDiffPart[] {
  return wordDiff(stripUrlsForDisplay(a), stripUrlsForDisplay(b));
}
