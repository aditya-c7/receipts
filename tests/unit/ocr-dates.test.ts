import { describe, it, expect } from 'vitest';
import { parseDateCandidates } from '../../lib/ocr/dates';

const NOW = new Date(2025, 5, 15, 12, 0, 0); // Jun 15 2025 (local)

describe('parseDateCandidates', () => {
  it('parses "h:mm AM/PM · Mon D, YYYY"', () => {
    const c = parseDateCandidates('10:30 PM · Dec 5, 2024', NOW);
    expect(c).toHaveLength(1);
    expect(c[0]?.isoDate).toBe('2024-12-05');
    expect(c[0]?.localMinuteOfDay).toBe(22 * 60 + 30);
    expect(c[0]?.raw).toBe('10:30 PM · Dec 5, 2024');
  });

  it('parses "h:mm AM/PM - D Mon YYYY"', () => {
    const c = parseDateCandidates('10:30 PM - 5 Dec 2024', NOW);
    expect(c).toHaveLength(1);
    expect(c[0]?.isoDate).toBe('2024-12-05');
    expect(c[0]?.localMinuteOfDay).toBe(1350);
  });

  it('parses "D Mon YYYY" without time', () => {
    const c = parseDateCandidates('5 Dec 2024', NOW);
    expect(c).toHaveLength(1);
    expect(c[0]?.isoDate).toBe('2024-12-05');
    expect(c[0]?.localMinuteOfDay).toBeUndefined();
  });

  it('parses "Mon D, YYYY"', () => {
    const c = parseDateCandidates('Mar 9, 2023', NOW);
    expect(c).toHaveLength(1);
    expect(c[0]?.isoDate).toBe('2023-03-09');
  });

  it('parses numeric D/M/YY both ways as ambiguous', () => {
    const c = parseDateCandidates('5/12/24', NOW);
    expect(c).toHaveLength(2);
    expect(c.map((x) => x.isoDate)).toEqual(['2024-12-05', '2024-05-12']);
    expect(c[0]?.dayMonthAmbiguous).toBe(true);
    expect(c[1]?.dayMonthAmbiguous).toBe(true);
  });

  it('parses unambiguous numeric when day > 12', () => {
    const c = parseDateCandidates('25/12/24', NOW);
    expect(c).toHaveLength(1);
    expect(c[0]?.isoDate).toBe('2024-12-25');
    expect(c[0]?.dayMonthAmbiguous).not.toBe(true);
  });

  it('collapses identical ambiguous readings to one', () => {
    const c = parseDateCandidates('5/5/24', NOW);
    expect(c).toHaveLength(1);
    expect(c[0]?.isoDate).toBe('2024-05-05');
    expect(c[0]?.dayMonthAmbiguous).not.toBe(true);
  });

  it('parses ISO "YYYY-MM-DD" without tz shift', () => {
    const c = parseDateCandidates('2024-12-05', NOW);
    expect(c).toHaveLength(1);
    expect(c[0]?.isoDate).toBe('2024-12-05');
  });

  it('parses 24h time', () => {
    const c = parseDateCandidates('23:15 · 5 Dec 2024', NOW);
    expect(c).toHaveLength(1);
    expect(c[0]?.isoDate).toBe('2024-12-05');
    expect(c[0]?.localMinuteOfDay).toBe(23 * 60 + 15);
  });

  it('handles 12 AM / 12 PM edges', () => {
    expect(parseDateCandidates('12:00 AM · Jan 1, 2024', NOW)[0]?.localMinuteOfDay).toBe(0);
    expect(parseDateCandidates('12:00 PM · Jan 1, 2024', NOW)[0]?.localMinuteOfDay).toBe(720);
  });

  it('tolerates garbled separators (•, *, -, .)', () => {
    for (const raw of [
      '10:30 PM • Dec 5, 2024',
      '10:30 PM * Dec 5, 2024',
      '10:30 PM | Dec 5, 2024',
      'Dec 5. 2024',
    ]) {
      const c = parseDateCandidates(raw, NOW);
      expect(c.length, raw).toBeGreaterThan(0);
      expect(c[0]?.isoDate, raw).toBe('2024-12-05');
    }
  });

  it('infers current + previous year when year is missing', () => {
    for (const raw of ['Dec 5', '5 Dec']) {
      const c = parseDateCandidates(raw, NOW);
      expect(c.map((x) => x.isoDate), raw).toEqual(['2025-12-05', '2024-12-05']);
      expect(c.every((x) => x.yearInferred === true), raw).toBe(true);
    }
  });

  it('attaches time to no-year dates', () => {
    const c = parseDateCandidates('10:30 PM · Dec 5', NOW);
    expect(c).toHaveLength(2);
    expect(c[0]?.localMinuteOfDay).toBe(1350);
    expect(c[0]?.yearInferred).toBe(true);
  });

  it('skips Feb 29 for non-leap years', () => {
    const leap = new Date(2024, 5, 15);
    const c = parseDateCandidates('Feb 29', leap);
    expect(c.map((x) => x.isoDate)).toEqual(['2024-02-29']);
  });

  it('returns [] for relative timestamps', () => {
    for (const raw of ['3h', '2d', '15m', '1h', '45s', '3 hours ago']) {
      expect(parseDateCandidates(raw, NOW), raw).toEqual([]);
    }
  });

  it('returns [] for empty / dateless lines', () => {
    expect(parseDateCandidates('', NOW)).toEqual([]);
    expect(parseDateCandidates('   ', NOW)).toEqual([]);
    expect(parseDateCandidates('Just a normal post body', NOW)).toEqual([]);
  });

  it('falls back to chrono-node when regex misses (ordinals)', () => {
    const c = parseDateCandidates('December 5th, 2024', NOW);
    expect(c).toHaveLength(1);
    expect(c[0]?.isoDate).toBe('2024-12-05');
  });

  it('finds dates embedded in longer timestamp lines', () => {
    const c = parseDateCandidates('10:30 PM · Dec 5, 2024 · 1.2M Views', NOW);
    expect(c).toHaveLength(1);
    expect(c[0]?.isoDate).toBe('2024-12-05');
    expect(c[0]?.localMinuteOfDay).toBe(1350);
  });

  it('rejects impossible calendar dates', () => {
    expect(parseDateCandidates('Feb 30, 2024', NOW)).toEqual([]);
    expect(parseDateCandidates('32/01/24', NOW)).toEqual([]);
  });
});
