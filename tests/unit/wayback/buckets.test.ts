import { describe, it, expect } from 'vitest';
import { idsToPrefixBuckets } from '../../../lib/wayback/buckets';

function covers(buckets: string[], id: string): boolean {
  return buckets.some((b) => id.startsWith(b));
}

describe('buckets', () => {
  it('single id', () => {
    expect(idsToPrefixBuckets('12345', '12345')).toEqual(['12345']);
  });

  it('small same-length range uses longest fitting prefix', () => {
    const b = idsToPrefixBuckets('1000', '1005');
    expect(b.length).toBeLessThanOrEqual(12);
    for (let i = 1000; i <= 1005; i++) expect(covers(b, String(i))).toBe(true);
  });

  it('1000..1099 fits in <=12 buckets and covers all', () => {
    const b = idsToPrefixBuckets('1000', '1099');
    expect(b.length).toBeLessThanOrEqual(12);
    for (let i = 1000; i <= 1099; i++) expect(covers(b, String(i))).toBe(true);
  });

  it('digit-boundary split covers all (999..1005)', () => {
    const b = idsToPrefixBuckets('999', '1005');
    expect(b.length).toBeLessThanOrEqual(12);
    for (const id of ['999', '1000', '1001', '1005']) expect(covers(b, id)).toBe(true);
    // every id in range covered
    for (let i = 999; i <= 1005; i++) expect(covers(b, String(i))).toBe(true);
  });

  it('large range stays within budget', () => {
    const b = idsToPrefixBuckets('1000000000000000000', '1999999999999999999');
    expect(b.length).toBeLessThanOrEqual(12);
    expect(covers(b, '1000000000000000000')).toBe(true);
    expect(covers(b, '1999999999999999999')).toBe(true);
    expect(covers(b, '1500000000000000000')).toBe(true);
  });

  it('swaps when min>max', () => {
    const a = idsToPrefixBuckets('1000', '1099');
    const b = idsToPrefixBuckets('1099', '1000');
    expect(a).toEqual(b);
  });
});
