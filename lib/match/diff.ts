// Neutral word diff (labels carry no color semantics).
import { diffWords } from 'diff';

export interface WordDiffPart {
  op: 'eq' | 'del' | 'ins';
  text: string;
}

/** Word-level diff with neutral op labels. */
export function wordDiff(a: string, b: string): WordDiffPart[] {
  const parts = diffWords(a, b);
  const out: WordDiffPart[] = [];
  for (const p of parts) {
    const op: WordDiffPart['op'] = p.added ? 'ins' : p.removed ? 'del' : 'eq';
    // diffWords may emit empty strings; drop them.
    if (p.value === '') continue;
    out.push({ op, text: p.value });
  }
  if (out.length === 0) return [{ op: 'eq', text: '' }];
  return out;
}
