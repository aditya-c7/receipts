import { describe, it, expect } from 'vitest';
import { repairCandidates } from '../../lib/ocr/confusables';

describe('repairCandidates', () => {
  it('lowercases the input', () => {
    expect(repairCandidates('NASA')).toContain('nasa');
  });

  it('repairs 0<->o', () => {
    const c = repairCandidates('n0sa');
    expect(c).toContain('n0sa');
    expect(c).toContain('nosa');
  });

  it('repairs 1<->l', () => {
    expect(repairCandidates('he11o')).toContain('hello');
  });

  it('repairs 5<->s', () => {
    expect(repairCandidates('na5a')).toContain('nasa');
  });

  it('repairs rn<->m both ways', () => {
    expect(repairCandidates('marna')).toContain('mama');
    expect(repairCandidates('mama')).toContain('rnarna');
  });

  it('drops a trailing char', () => {
    expect(repairCandidates('nasa')).toContain('nas');
  });

  it('returns at most 6 unique lowercase entries', () => {
    const c = repairCandidates('NASA_007');
    expect(c.length).toBeLessThanOrEqual(6);
    expect(new Set(c).size).toBe(c.length);
    expect(c.every((s) => s === s.toLowerCase())).toBe(true);
  });

  it('dedupes handles without confusables', () => {
    expect(repairCandidates('abc')).toEqual(['abc', 'ab']);
  });

  it('returns [] for empty input', () => {
    expect(repairCandidates('')).toEqual([]);
    expect(repairCandidates('   ')).toEqual([]);
  });
});
