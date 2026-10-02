import { describe, it, expect } from 'vitest';
import { decide } from '../../../lib/verdict/engine';
import type { Candidate } from '../../../lib/types';

function cand(): Candidate {
  return {
    tweetId: '20',
    idTimeMs: 1,
    snapshotTs: '20230101000000',
    originalUrl: 'https://x.com/a/status/20',
    archiveUrl: 'https://web.archive.org/web/20230101000000id_/https://x.com/a/status/20',
    statusCode: 200,
  };
}

const cov = { capturesFound: 1, capturesCompared: 1, truncated: false, from: 'a', to: 'b' };

describe('verdict engine', () => {
  it('unsupported platform first', () => {
    const v = decide({
      platform: 'unknown',
      handleOk: null,
      dateOk: null,
      hasDates: false,
      best: null,
      alternates: [],
      coverage: cov,
      archiveError: true,
    });
    expect(v.code).toBe('UNSUPPORTED_PLATFORM');
  });

  it('insufficient input when missing handle/dates', () => {
    const v = decide({
      platform: 'x',
      handleOk: null,
      dateOk: null,
      hasDates: false,
      best: null,
      alternates: [],
      coverage: cov,
      archiveError: false,
    });
    expect(v.code).toBe('INSUFFICIENT_INPUT');
  });

  it('archive unavailable', () => {
    const v = decide({
      platform: 'x',
      handleOk: true,
      dateOk: true,
      hasDates: true,
      best: null,
      alternates: [],
      coverage: cov,
      archiveError: true,
    });
    expect(v.code).toBe('ARCHIVE_UNAVAILABLE');
  });

  it('strong/likely/partial thresholds', () => {
    const mk = (score: number) =>
      decide({
        platform: 'x',
        handleOk: true,
        dateOk: true,
        hasDates: true,
        best: { score, timeConsistent: true, extractable: true, candidate: cand(), archived: { text: 'x', extractor: 'og' } },
        alternates: [],
        coverage: cov,
        archiveError: false,
      }).code;
    expect(mk(0.95)).toBe('MATCH_STRONG');
    expect(mk(0.8)).toBe('MATCH_LIKELY');
    expect(mk(0.6)).toBe('MATCH_PARTIAL');
  });

  it('unreadable when time-consistent but no text', () => {
    const v = decide({
      platform: 'x',
      handleOk: true,
      dateOk: true,
      hasDates: true,
      best: { score: 0.2, timeConsistent: true, extractable: false },
      alternates: [],
      coverage: cov,
      archiveError: false,
    });
    expect(v.code).toBe('POST_EXISTS_TEXT_UNREADABLE');
  });

  it('no match fallback', () => {
    const v = decide({
      platform: 'x',
      handleOk: true,
      dateOk: true,
      hasDates: true,
      best: { score: 0.1, timeConsistent: false, extractable: true },
      alternates: [],
      coverage: cov,
      archiveError: false,
    });
    expect(v.code).toBe('NO_MATCH');
  });
});
