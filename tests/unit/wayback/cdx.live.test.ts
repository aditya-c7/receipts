// @live — real Wayback CDX smoke test. Included in `pnpm test` but
// self-skips unless LIVE=1 (no network in CI). Run locally with:
//   $env:LIVE='1'; npx pnpm vitest run tests/unit/wayback/cdx.live.test.ts
import { describe, it, expect } from 'vitest';
import { MemoryCache } from '../../../worker/cache/redis';
import { fetchCandidates, handleHasAnyCaptures } from '../../../worker/wayback/cdx';

const UA = 'Receipts/1.0 (+http://localhost:3000; contact: adityachitragar2.0@gmail.com)';
const LIVE = process.env.LIVE === '1';

/** Archive.org throttles aggressively (429s); retry transient empties. */
async function retry<T>(fn: () => Promise<T>, what: string): Promise<T> {
  // Gentle: 60s+ between attempts, max 3. Refiring fast during a throttle
  // extends the IP block (doubles each violation), so never tighten this.
  const waits = [60000, 120000];
  let last: unknown = null;
  for (let i = 0; i <= waits.length; i++) {
    try {
      const out = await fn();
      if (out === false || (out !== null && typeof out === 'object' && 'candidates' in out && (out as { candidates: unknown[] }).candidates.length === 0)) {
        last = new Error(`${what}: empty result (possible 429 throttle)`);
      } else {
        return out;
      }
    } catch (e) {
      last = e;
    }
    if (i < waits.length) await new Promise((r) => setTimeout(r, waits[i]));
  }
  throw last instanceof Error ? last : new Error(`${what}: failed after retries`);
}

describe.skipIf(!LIVE)('@live wayback CDX', () => {
  it('finds captures for a well-archived institutional account', async () => {
    const has = await retry(() => handleHasAnyCaptures('nasa', UA), 'coverage probe');
    expect(has).toBe(true);
  }, 120000);

  it('returns ID-time-filtered candidates in a single-day window', async () => {
    // Single day (not a month): prefix buckets stay selective and responses
    // small — a month of a heavily-archived handle is thousands of rows.
    const fromMs = Date.parse('2023-03-11T00:00:00Z');
    const toMs = Date.parse('2023-03-11T23:59:59Z');
    const res = await retry(
      () => fetchCandidates('nasa', fromMs, toMs, { WAYBACK_USER_AGENT: UA }, new MemoryCache()),
      'candidate fetch',
    );
    expect(res.candidates.length).toBeGreaterThan(0);
    for (const c of res.candidates) {
      expect(c.tweetId).toMatch(/^\d+$/);
      expect(c.idTimeMs).toBeGreaterThanOrEqual(fromMs);
      expect(c.idTimeMs).toBeLessThanOrEqual(toMs);
      expect(c.archiveUrl).toContain('web.archive.org');
    }
  }, 120000);
});
