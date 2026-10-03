// Text-quality gate: junk archive extractions must come back null, never scored.
import { describe, it, expect } from 'vitest';
import { extractArchivedPost, isJunkArchiveText } from '../../../lib/wayback/snapshot';

describe('isJunkArchiveText', () => {
  it('rejects bare domains and chrome', () => {
    for (const t of ['x.com', 'X', 'Twitter', 'Log in on X', 'x / home']) {
      expect(isJunkArchiveText(t), t).toBe(true);
    }
  });
  it('rejects short and error-page text', () => {
    expect(isJunkArchiveText('hi')).toBe(true);
    expect(isJunkArchiveText('Something went wrong. Try reloading.')).toBe(true);
    expect(isJunkArchiveText('Rate limit exceeded. Please slow down.')).toBe(true);
    expect(isJunkArchiveText('Log in to X to see more posts here.')).toBe(true);
  });
  it('accepts real post text, even shortish posts', () => {
    expect(isJunkArchiveText('Tesla rocks!!')).toBe(false);
    expect(isJunkArchiveText('Tesla stock price is too high imo')).toBe(false);
    expect(isJunkArchiveText('JUST IN: South Korean President Lee Jae-myung strips powers.')).toBe(false);
  });
});

describe('extractArchivedPost junk gate', () => {
  it('returns null text (not "x.com") for a chrome-only capture', () => {
    const html = '<html><head><title>x.com</title><meta property="og:description" content="x.com"></head><body></body></html>';
    const out = extractArchivedPost(html);
    expect(out.text).toBeNull();
    expect(out.extractor).toBe('none');
  });
});
