import { describe, it, expect } from 'vitest';
import {
  isCanonicalStatusUrl,
  extractTweetId,
  archiveUrl,
  ALLOWED_HOSTS,
  assertAllowedUrl,
} from '../../../lib/wayback/urls';

describe('urls', () => {
  it('accepts canonical variants', () => {
    expect(isCanonicalStatusUrl('https://x.com/jack/status/20')).toBe(true);
    expect(isCanonicalStatusUrl('https://twitter.com/jack/status/20')).toBe(true);
    expect(isCanonicalStatusUrl('https://www.x.com/jack/status/20')).toBe(true);
    expect(isCanonicalStatusUrl('https://mobile.twitter.com/jack/status/20/')).toBe(true);
    expect(isCanonicalStatusUrl('http://x.com/jack/status/20?x=1')).toBe(true);
  });

  it('rejects non-canonical', () => {
    expect(isCanonicalStatusUrl('https://x.com/jack/status/')).toBe(false);
    expect(isCanonicalStatusUrl('https://x.com/jack/status/abc')).toBe(false);
    expect(isCanonicalStatusUrl('https://example.com/jack/status/20')).toBe(false);
    expect(isCanonicalStatusUrl('https://x.com/jack/status/20/extra')).toBe(false);
  });

  it('extracts tweet id as string', () => {
    expect(extractTweetId('https://x.com/jack/status/20')).toBe('20');
    expect(extractTweetId('https://x.com/jack/status/1635000000000000000')).toBe('1635000000000000000');
    expect(extractTweetId('https://example.com/a/status/1')).toBeNull();
  });

  it('builds archive url', () => {
    expect(archiveUrl('20230101000000', 'https://x.com/a/status/1')).toBe(
      'https://web.archive.org/web/20230101000000id_/https://x.com/a/status/1',
    );
  });

  it('allowlist hosts', () => {
    expect([...ALLOWED_HOSTS]).toEqual(['web.archive.org', 'archive.org']);
  });

  it('assertAllowedUrl allows archive hosts', () => {
    expect(() => assertAllowedUrl('https://web.archive.org/web/20200101000000id_/https://x.com/a/status/1')).not.toThrow();
    expect(() => assertAllowedUrl('https://archive.org/wayback/available?url=x')).not.toThrow();
  });

  it('assertAllowedUrl blocks hostile inputs', () => {
    expect(() => assertAllowedUrl('https://web.archive.org@evil.com/x')).toThrow();
    expect(() => assertAllowedUrl('https://evil.com/?x=web.archive.org')).toThrow();
    expect(() => assertAllowedUrl('https://web.archive.org%2e.evil.com/')).toThrow();
    expect(() => assertAllowedUrl('https://web%E3%80%82archive%E3%80%82org/')).toThrow();
    expect(() => assertAllowedUrl('https://web．archive．org/')).toThrow();
    expect(() => assertAllowedUrl('http://evil.com/web.archive.org')).toThrow();
    expect(() => assertAllowedUrl('ftp://web.archive.org/x')).toThrow();
  });
});
