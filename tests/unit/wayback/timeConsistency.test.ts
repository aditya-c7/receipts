import { describe, it, expect } from 'vitest';
import {
  VALID_TZ_OFFSETS_MIN,
  checkTimeConsistent,
  checkDateConsistent,
  impliedOffset,
  rankByTimeConsistency,
} from '../../../lib/wayback/timeConsistency';

describe('timeConsistency', () => {
  it('table includes required offsets', () => {
    for (const o of [-720, -420, 330, 345, 525, 570, 765, 840]) {
      expect(VALID_TZ_OFFSETS_MIN).toContain(o);
    }
  });

  it('consistent for exact valid offsets', () => {
    // id at midnight UTC; shot wall = midnight + offset => implied == offset.
    const idMs = Date.parse('2023-05-01T00:00:00Z');
    for (const off of [-420, 330, 345, 570]) {
      const wallMs = idMs + off * 60000;
      const d = new Date(wallMs);
      const iso = d.toISOString().slice(0, 10);
      const minute = d.getUTCHours() * 60 + d.getUTCMinutes();
      expect(checkTimeConsistent(iso, minute, idMs)).toBe(true);
    }
  });

  it('inconsistent far date', () => {
    const idMs = Date.parse('2023-05-01T12:00:00Z');
    expect(checkTimeConsistent('2023-06-15', 720, idMs)).toBe(false);
  });

  it('null when no time', () => {
    const idMs = Date.parse('2023-05-01T12:00:00Z');
    expect(checkTimeConsistent('2023-05-01', undefined, idMs)).toBeNull();
    expect(checkTimeConsistent('', 720, idMs)).toBeNull();
  });

  it('impliedOffset helper', () => {
    const idMs = Date.parse('2023-05-01T00:00:00Z');
    expect(impliedOffset('2023-05-01', 345, idMs)).toBe(345);
  });

  it('date-only helper + rank', () => {
    const idMs = Date.parse('2023-05-01T12:00:00Z');
    expect(checkDateConsistent('2023-05-01', idMs)).toBe(true);
    expect(checkDateConsistent('2023-06-01', idMs)).toBe(false);
    const cands = [{ idTimeMs: Date.parse('2023-06-01T12:00:00Z') }, { idTimeMs: idMs }];
    const ranked = rankByTimeConsistency(cands, '2023-05-01');
    expect(ranked[0]?.idTimeMs).toBe(idMs);
  });
});
