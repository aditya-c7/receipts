import { describe, it, expect } from 'vitest';
import { TWITTER_EPOCH, idToMs, msToMinId, msToMaxId } from '../../../lib/wayback/snowflake';

describe('snowflake', () => {
  it('exposes twitter epoch', () => {
    expect(TWITTER_EPOCH).toBe(1288834974657n);
  });

  it('pre-snowflake id "20" maps near epoch (fallback note)', () => {
    const ms = idToMs('20');
    // (20 >> 22) == 0, so time == epoch exactly.
    expect(ms).toBe(Number(TWITTER_EPOCH));
  });

  it('round-trip: id in [min,max] for its own ms', () => {
    // Modern-scale id: construct from a known ms, then verify containment.
    const ms = 1700000000000; // 2023-11-14T22:13:20Z
    const min = msToMinId(ms);
    const max = msToMaxId(ms);
    expect(min <= max).toBe(true);
    // min decodes back to ms.
    expect(idToMs(min.toString())).toBe(ms);
    expect(idToMs(max.toString())).toBe(ms);
    // A mid id (min+12345) in same ms also decodes to ms.
    const mid = min + 12345n;
    expect(mid <= max).toBe(true);
    expect(idToMs(mid.toString())).toBe(ms);
  });

  it('second modern round-trip (2021 range)', () => {
    const ms = 1635000000000; // ~2021-10-23
    const min = msToMinId(ms);
    const max = msToMaxId(ms);
    expect(idToMs(min.toString())).toBe(ms);
    expect(idToMs(max.toString())).toBe(ms);
    expect(max - min).toBe((1n << 22n) - 1n);
  });

  it('neighbor ms ranges do not overlap', () => {
    const a = 1700000000000;
    expect(msToMaxId(a) < msToMinId(a + 1)).toBe(true);
  });
});
