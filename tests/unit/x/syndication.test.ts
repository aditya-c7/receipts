import { describe, it, expect } from 'vitest';
import { tokenFor, syndicationUrl } from '../../../worker/x/syndication';

describe('syndication token', () => {
  it('matches verified live vectors (BigInt-safe, no Number(id))', () => {
    // Verified against cdn.syndication.twimg.com 2026-10-03.
    expect(tokenFor('957414748881997825')).toBe('2bjt21ztkvx');
    expect(tokenFor('1256236544704686336')).toBe('31ml7rymai');
  });
  it('handles pre-Snowflake tiny ids', () => {
    expect(typeof tokenFor('20')).toBe('string');
    expect(tokenFor('20').length).toBeGreaterThan(0);
  });
  it('rejects non-numeric ids (SSRF discipline)', () => {
    for (const bad of ['', 'abc', '12.5', '-1', '1'.repeat(26), 'https://x.com/evil']) {
      expect(() => tokenFor(bad)).toThrow();
    }
  });
});

describe('syndicationUrl', () => {
  it('builds a constant-host URL with only the id embedded', () => {
    const u = new URL(syndicationUrl('957414748881997825'));
    expect(u.hostname).toBe('cdn.syndication.twimg.com');
    expect(u.searchParams.get('id')).toBe('957414748881997825');
    expect(u.searchParams.get('lang')).toBe('en');
    expect(u.searchParams.get('token')).toBe('2bjt21ztkvx');
  });
});
