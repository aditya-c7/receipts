import { describe, it, expect, vi, afterEach } from 'vitest';
import { runCheckFlow, windowFromParsed } from '../../src/lib/check-client';
import { idToMs, msToMinId } from '../../lib/wayback/snowflake';
import type { Candidate, ParsedScreenshot } from '../../lib/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeParsed(
  text: string | null,
  handle: string | null,
  isoDates: Array<{ isoDate: string; minute?: number }>| null,
  platform: ParsedScreenshot['platform'] = 'x',
): ParsedScreenshot {
  return {
    platform,
    displayName: { value: 'Name', confidence: 1, source: 'ocr' },
    handle: { value: handle, confidence: 1, source: 'ocr' },
    text: { value: text, confidence: 1, source: 'ocr' },
    dates: {
      value: isoDates
        ? isoDates.map((d) => ({
            isoDate: d.isoDate,
            ...(d.minute !== undefined ? { localMinuteOfDay: d.minute } : {}),
            raw: d.isoDate,
          }))
        : null,
      confidence: 1,
      source: 'ocr',
    },
    language: 'en',
    ocrMs: 1,
    fieldsEdited: false,
  };
}

function okJson(payload: unknown): Response {
  return { ok: true, json: async () => payload } as unknown as Response;
}

function candidateFor(ms: number, handle = 'jack', snapshotTs = '20230501120000'): Candidate {
  const id = msToMinId(ms).toString();
  const idMs = idToMs(id);
  const originalUrl = `https://x.com/${handle}/status/${id}`;
  return {
    tweetId: id,
    idTimeMs: idMs,
    snapshotTs,
    originalUrl,
    archiveUrl: `https://web.archive.org/web/${snapshotTs}id_/${originalUrl}`,
    statusCode: 200,
  };
}

const CLAIMED =
  'The city council approved the new downtown transit plan after months of public debate and revisions';

describe('runCheckFlow', () => {
  it('unknown platform → UNSUPPORTED_PLATFORM without any fetch', async () => {
    const fetchMock = vi.fn(async () => okJson({}));
    vi.stubGlobal('fetch', fetchMock);
    const v = await runCheckFlow(makeParsed(CLAIMED, 'jack', [{ isoDate: '2023-05-01' }], 'unknown'));
    expect(v.code).toBe('UNSUPPORTED_PLATFORM');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('missing handle → INSUFFICIENT_INPUT without fetch', async () => {
    const fetchMock = vi.fn(async () => okJson({}));
    vi.stubGlobal('fetch', fetchMock);
    const v = await runCheckFlow(makeParsed(CLAIMED, null, [{ isoDate: '2023-05-01' }]));
    expect(v.code).toBe('INSUFFICIENT_INPUT');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('missing dates → INSUFFICIENT_INPUT without fetch', async () => {
    const fetchMock = vi.fn(async () => okJson({}));
    vi.stubGlobal('fetch', fetchMock);
    const v = await runCheckFlow(makeParsed(CLAIMED, 'jack', null));
    expect(v.code).toBe('INSUFFICIENT_INPUT');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('search throws → ARCHIVE_UNAVAILABLE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down');
      }),
    );
    const v = await runCheckFlow(makeParsed(CLAIMED, 'jack', [{ isoDate: '2023-05-01' }]));
    expect(v.code).toBe('ARCHIVE_UNAVAILABLE');
    expect(v.score).toBeNull();
  });

  it('empty candidates → NO_MATCH with coverage counts', async () => {
    const searchPayload = {
      ok: true,
      cached: false,
      candidates: [],
      coverage: { buckets: 4, totalCaptures: 0, truncated: false, handleHasAnyCaptures: false },
    };
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes('/api/wayback/search')) return okJson(searchPayload);
      throw new Error(`unexpected fetch ${String(url)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const v = await runCheckFlow(makeParsed(CLAIMED, 'jack', [{ isoDate: '2023-05-01' }]));
    expect(v.code).toBe('NO_MATCH');
    expect(v.coverage.capturesFound).toBe(0);
    expect(v.coverage.capturesCompared).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('full flow → MATCH_STRONG with score≥0.90, diff, alternates', async () => {
    const ms = Date.parse('2023-05-01T12:00:00Z');
    const c1 = candidateFor(ms, 'jack', '20230501120000');
    const c2 = candidateFor(ms + 3_600_000, 'jack', '20230501130000');
    const searchPayload = {
      ok: true,
      cached: false,
      candidates: [c1, c2],
      coverage: { buckets: 4, totalCaptures: 2, truncated: false, handleHasAnyCaptures: true },
    };
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/api/wayback/search')) return okJson(searchPayload);
      if (u.includes('/api/wayback/snapshot')) {
        return okJson({
          ok: true,
          cached: false,
          archiveUrl: c1.archiveUrl,
          extracted: { text: CLAIMED, extractor: 'og' },
        });
      }
      throw new Error(`unexpected fetch ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const v = await runCheckFlow(makeParsed(CLAIMED, 'jack', [{ isoDate: '2023-05-01' }]));
    expect(v.code).toBe('MATCH_STRONG');
    expect(v.score).not.toBeNull();
    expect(v.score as number).toBeGreaterThanOrEqual(0.9);
    expect(v.diff).toBeDefined();
    expect(Array.isArray(v.diff)).toBe(true);
    expect(v.alternates.length).toBeGreaterThanOrEqual(1);
    expect(v.coverage.capturesFound).toBe(2);
    expect(v.coverage.capturesCompared).toBe(2);
  });

  it('repairedHandle caps score ≤0.60 even for identical text', async () => {
    const ms = Date.parse('2023-05-01T12:00:00Z');
    const c1 = candidateFor(ms, 'jack', '20230501120000');
    const c2 = candidateFor(ms + 3_600_000, 'jack', '20230501130000');
    const searchPayload = {
      ok: true,
      cached: false,
      candidates: [c1, c2],
      coverage: {
        buckets: 4,
        totalCaptures: 2,
        truncated: false,
        handleHasAnyCaptures: true,
        repairedHandle: 'jackx',
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        const u = String(url);
        if (u.includes('/api/wayback/search')) return okJson(searchPayload);
        if (u.includes('/api/wayback/snapshot')) {
          return okJson({
            ok: true,
            cached: false,
            archiveUrl: c1.archiveUrl,
            extracted: { text: CLAIMED, extractor: 'og' },
          });
        }
        throw new Error(`unexpected fetch ${u}`);
      }),
    );
    const v = await runCheckFlow(makeParsed(CLAIMED, 'jack', [{ isoDate: '2023-05-01' }]));
    expect(v.score).not.toBeNull();
    expect(v.score as number).toBeLessThanOrEqual(0.6);
    expect(v.code).not.toBe('MATCH_STRONG');
  });
});

describe('windowFromParsed', () => {
  it('known date → [00:00−14h, 23:59:59+12h] UTC', () => {
    const w = windowFromParsed(makeParsed(CLAIMED, 'jack', [{ isoDate: '2023-05-01' }]));
    expect(w).not.toBeNull();
    const start = Date.parse('2023-05-01T00:00:00Z');
    const end = Date.parse('2023-05-01T23:59:59Z');
    expect(w?.fromMs).toBe(start - 14 * 3_600_000);
    expect(w?.toMs).toBe(end + 12 * 3_600_000);
  });

  it('ambiguous two-date union', () => {
    const w = windowFromParsed(
      makeParsed(CLAIMED, 'jack', [{ isoDate: '2023-05-01' }, { isoDate: '2023-05-03' }]),
    );
    expect(w).not.toBeNull();
    const start1 = Date.parse('2023-05-01T00:00:00Z') - 14 * 3_600_000;
    const end2 = Date.parse('2023-05-03T23:59:59Z') + 12 * 3_600_000;
    expect(w?.fromMs).toBe(start1);
    expect(w?.toMs).toBe(end2);
  });

  it('no dates → null', () => {
    expect(windowFromParsed(makeParsed(CLAIMED, 'jack', null))).toBeNull();
    expect(
      windowFromParsed(makeParsed(CLAIMED, 'jack', [], 'x')),
    ).toBeNull();
  });
});
