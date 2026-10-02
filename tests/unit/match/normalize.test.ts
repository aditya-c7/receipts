import { describe, it, expect } from 'vitest';
import { normalizeText, normalizeFolded } from '../../../lib/match/normalize';

describe('normalize', () => {
  it('strips urls, emoji, folds quotes', () => {
    expect(normalizeText('Hello https://t.co/abc World')).toBe('hello world');
    expect(normalizeText('pic.twitter.com/xyz hello')).toBe('hello');
    expect(normalizeText('Hello 😀 World\u200b!')).toBe('hello world');
    expect(normalizeText('“Hello” — world…')).toBe('hello world');
    expect(normalizeText('  HELLO   WORLD  ')).toBe('hello world');
  });

  it('folded maps confusables (not i)', () => {
    expect(normalizeFolded('0')).toBe('o');
    expect(normalizeFolded('1')).toBe('l');
    expect(normalizeFolded('|')).toBe('l');
    expect(normalizeFolded('5')).toBe('s');
    expect(normalizeFolded('8')).toBe('b');
    expect(normalizeFolded('rn')).toBe('m');
    expect(normalizeFolded('vv')).toBe('w');
    // sanity: plain keeps digits
    expect(normalizeText('1058')).toBe('1058');
  });
});
