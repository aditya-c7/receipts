import { describe, it, expect, vi } from 'vitest';
import { runCheck } from '../../lib/check';
import type { ParsedScreenshot, Candidate } from '../../lib/types';
import { msToMinId } from '../../lib/wayback/snowflake';
import { AppError } from '../../lib/errors';

function parsed(text: string, handle: string | null, isoDate: string | null): ParsedScreenshot {
  return {
    platform: 'x',
    displayName: { value: 'Name', confidence: 1, source: 'ocr' },
    handle: { value: handle, confidence: 1, source: 'ocr' },
    text: { value: text, confidence: 1, source: 'ocr' },
    dates: {
      value: isoDate ? [{ isoDate, raw: isoDate }] : null,
      confidence: 1,
      source: 'ocr',
    },
    language: 'en',
    ocrMs: 1,
    fieldsEdited: false,
  };
}

function candidateFor(ms: number, handle = 'jack'): Candidate {
  const id = msToMinId(ms).toString();
  return {
    tweetId: id,
    idTimeMs: ms,
    snapshotTs: '20230501120000',
    originalUrl: `https://x.com/${handle}/status/${id}`,
    archiveUrl: `https://web.archive.org/web/20230501120000id_/https://x.com/${handle}/status/${id}`,
    statusCode: 200,
  };
}

describe('runCheck', () => {
  it('strong match path with progress events', async () => {
    const text = 'The city council approved the new downtown transit plan after months of public debate and revisions';
    const ms = Date.parse('2023-05-01T12:00:00Z');
    const c = candidateFor(ms);
    const phases: string[] = [];
    const v = await runCheck(parsed(text, 'jack', '2023-05-01'), {
      search: async () => [c],
      snapshot: async () => ({ text, handle: 'jack', extractor: 'og' as const }),
      onProgress: (e) => phases.push(e.phase),
    });
    expect(v.code).toBe('MATCH_STRONG');
    expect(phases).toContain('reading');
    expect(phases).toContain('searching');
    expect(phases).toContain('comparing');
    expect(phases).toContain('done');
  });

  it('insufficient input without search', async () => {
    const search = vi.fn(async () => []);
    const v = await runCheck(parsed('hello world, long enough text for test', null, null), {
      search,
      snapshot: async () => ({ text: null, extractor: 'none' as const }),
    });
    expect(v.code).toBe('INSUFFICIENT_INPUT');
    expect(search).not.toHaveBeenCalled();
  });

  it('archive unavailable on search error', async () => {
    const v = await runCheck(parsed('some long claimed text for archive error test case here', 'jack', '2023-05-01'), {
      search: async () => {
        throw new AppError('ARCHIVE_ERROR', 'down');
      },
      snapshot: async () => ({ text: null, extractor: 'none' as const }),
    });
    expect(v.code).toBe('ARCHIVE_UNAVAILABLE');
  });

  it('aborts on signal', async () => {
    const text = 'The city council approved the new downtown transit plan after months of public debate and revisions';
    const ms = Date.parse('2023-05-01T12:00:00Z');
    const ctrl = new AbortController();
    ctrl.abort();
    const v = await runCheck(parsed(text, 'jack', '2023-05-01'), {
      search: async () => [candidateFor(ms)],
      snapshot: async () => ({ text, extractor: 'og' as const }),
      signal: ctrl.signal,
    });
    expect(v.coverage.capturesCompared).toBe(0);
  });
});
