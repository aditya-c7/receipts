import { describe, it, expect } from 'vitest';
import { diffForDisplay, stripUrlsForDisplay, wordDiff } from '../../../lib/match/diff';

describe('diffForDisplay', () => {
  it('keeps changed words whole instead of shredding URLs', () => {
    const a = 'today we launched ChatGpu try talking with it here: chat https://t.co/uWra8LKFMN';
    const b = 'today we launched ChatGPT. try talking with it here: https://openai.com';
    const d = diffForDisplay(a, b);
    const joined = d.map((p) => p.text).join('|');
    expect(joined).not.toContain('https');
    expect(joined).not.toContain('t.co');
    expect(d.length).toBeLessThanOrEqual(7);
    const delTexts = d.filter((p) => p.op === 'del').map((p) => p.text.trim());
    const insTexts = d.filter((p) => p.op === 'ins').map((p) => p.text.trim());
    expect(delTexts).toContain('ChatGpu');
    expect(insTexts).toContain('ChatGPT.');
  });

  it('identical texts after URL stripping collapse to equal', () => {
    const d = diffForDisplay('see this https://t.co/abc', 'see this https://x.com/other');
    expect(d.every((p) => p.op === 'eq')).toBe(true);
  });

  it('plain wordDiff still works on raw text', () => {
    const d = wordDiff('hello brave world', 'hello world');
    expect(d.some((p) => p.op === 'del' || p.op === 'ins')).toBe(true);
  });

  it('stripUrlsForDisplay removes t.co and pic links', () => {
    expect(stripUrlsForDisplay('a https://t.co/abc123 b')).toBe('a b');
    expect(stripUrlsForDisplay('a pic.twitter.com/xyz b')).toBe('a b');
  });
});
