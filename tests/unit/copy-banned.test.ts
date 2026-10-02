import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BANNED = ['fake', 'forged', 'fraud', 'hoax', 'lie', 'liar', 'debunked', 'doctored'];

describe('verdict copy guardrail', () => {
  it('contains no banned words (whole-word match)', () => {
    const p = path.join(__dirname, '..', '..', 'lib', 'verdict', 'copy.ts');
    const text = fs.readFileSync(p, 'utf8').toLowerCase();
    for (const w of BANNED) {
      // Whole-word match: naive substring would false-positive on words
      // like "replies" (contains "lie") or "believe".
      const re = new RegExp(`\\b${w}\\b`);
      expect(text, `banned word "${w}" in copy.ts`).not.toMatch(re);
    }
  });
});
