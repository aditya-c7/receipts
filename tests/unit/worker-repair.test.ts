import { describe, it, expect, vi, afterEach } from 'vitest';
import { MemoryCache } from '../../worker/cache/redis';
import { fetchCandidates } from '../../worker/wayback/cdx';

const HEADER = ['urlkey', 'timestamp', 'original', 'mimetype', 'statuscode', 'digest'];

function rows(urls: Array<{ ts: string; original: string }>): unknown {
  return [HEADER, ...urls.map((u) => ['key', u.ts, u.original, 'text/html', '200', 'digest'])];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('handle repair probes', () => {
  it('adopts a confusable variant when the original has no captures', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      // Note: buildCdxRequests URL-encodes the query, so match the encoded
      // path segment (%2F = /).
      const url = String(input);
      if (url.includes('%2Frnasa%2F')) return Response.json(rows([]));
      if (url.includes('%2Fmasa%2F')) {
        return Response.json(
          rows([{ ts: '20230311120000', original: 'https://x.com/masa/status/1635000000000000000' }]),
        );
      }
      return Response.json(rows([]));
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchCandidates('rnasa', 0, Date.now(), {}, new MemoryCache());
    expect(res.coverage.repairedHandle).toBe('masa');
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]?.tweetId).toBe('1635000000000000000');
  });

  it('does not repair when the original handle has captures', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(rows([{ ts: '20230311120000', original: 'https://x.com/nasa/status/1635000000000000000' }])),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchCandidates('nasa', 0, Date.now(), {}, new MemoryCache());
    expect(res.coverage.repairedHandle).toBeUndefined();
    expect(res.candidates).toHaveLength(1);
  });

  it('returns empty with no repair when nothing has captures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(rows([]))));

    const res = await fetchCandidates('zzzxqq_nope', 0, Date.now(), {}, new MemoryCache());
    expect(res.candidates).toHaveLength(0);
    expect(res.coverage.repairedHandle).toBeUndefined();
    expect(res.coverage.handleHasAnyCaptures).toBe(false);
  });
});
