import { describe, it, expect } from 'vitest';
import { parseCdxJson, dedupeByTweetId, filterByIdTime, buildCdxUrl } from '../../../lib/wayback/cdx';
import { CDX_LIMIT } from '../../../lib/config';
import { idToMs, msToMinId } from '../../../lib/wayback/snowflake';

describe('cdx', () => {
  it('parses header + rows, empty -> []', () => {
    expect(parseCdxJson([])).toEqual([]);
    expect(parseCdxJson([['timestamp', 'original']])).toEqual([]);
    expect(parseCdxJson(null)).toEqual([]);
    const rows = parseCdxJson([
      ['timestamp', 'original', 'statuscode', 'mimetype', 'digest'],
      ['20230101000000', 'https://x.com/a/status/20', '200', 'text/html', 'abc'],
      ['20230102000000', 'https://x.com/a/status/21', '404', 'text/html', 'def'],
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ timestamp: '20230101000000', statuscode: 200 });
  });

  it('dedupe prefers earliest 200', () => {
    const rows = parseCdxJson([
      ['timestamp', 'original', 'statuscode', 'mimetype', 'digest'],
      ['20230102000000', 'https://x.com/a/status/20', '200', 'text/html', 'b'],
      ['20230101000000', 'https://x.com/a/status/20', '200', 'text/html', 'a'],
      ['20230103000000', 'https://twitter.com/a/status/20', '404', 'text/html', 'c'],
    ]);
    const d = dedupeByTweetId(rows);
    expect(d).toHaveLength(1);
    expect(d[0]?.timestamp).toBe('20230101000000');
  });

  it('dedupe collapses host variants', () => {
    const rows = parseCdxJson([
      ['timestamp', 'original', 'statuscode', 'mimetype', 'digest'],
      ['20230101000000', 'https://twitter.com/a/status/20', '200', 'text/html', 'a'],
      ['20230102000000', 'https://x.com/a/status/20', '200', 'text/html', 'b'],
      ['20230101000000', 'https://mobile.x.com/a/status/20', '200', 'text/html', 'c'],
      ['20230101000000', 'https://www.twitter.com/a/status/20', '200', 'text/html', 'd'],
    ]);
    expect(dedupeByTweetId(rows)).toHaveLength(1);
  });

  it('filter window inclusive edges', () => {
    const ms = 1700000000000;
    const id = msToMinId(ms).toString();
    const idMs = idToMs(id);
    const cands = [
      { idTimeMs: idMs, v: 'in' },
      { idTimeMs: idMs - 1, v: 'before' },
      { idTimeMs: idMs + 1, v: 'after' },
    ];
    expect(filterByIdTime(cands, idMs, idMs).map((c) => c.v)).toEqual(['in']);
    expect(filterByIdTime(cands, idMs - 1, idMs + 1)).toHaveLength(3);
  });

  it('builds cdx url with required params', () => {
    const u = buildCdxUrl('jack', '1635', '20200101000000');
    expect(u).toContain('matchType=prefix');
    expect(u).toContain('fl=timestamp,original,statuscode,mimetype,digest');
    expect(u).toContain('filter=statuscode:200');
    expect(u).toContain('collapse=urlkey');
    expect(u).toContain(`limit=${CDX_LIMIT}`);
    expect(u).toContain('jack');
    expect(u).toContain('1635');
    expect(u).toContain('20200101000000');
  });
});
