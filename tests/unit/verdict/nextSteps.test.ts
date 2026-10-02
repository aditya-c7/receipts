import { describe, it, expect } from 'vitest';
import { buildNextSteps } from '../../../lib/verdict/nextSteps';

describe('nextSteps', () => {
  it('includes required links + reminders', () => {
    const steps = buildNextSteps('jack', 'hello world phrase for search testing', '2023-05-01');
    const urls = steps.filter((s) => typeof s !== 'string').map((s) => (s as { url: string }).url);
    expect(urls.some((u) => u.includes('x.com/search') && u.includes('from%3A'))).toBe(true);
    expect(urls.some((u) => u.includes('since%3A') || u.includes('since:'))).toBe(true);
    expect(urls.some((u) => u === 'https://web.archive.org/web/*/x.com/jack/status/*')).toBe(true);
    expect(urls.some((u) => u.includes('site%3Ax.com') || u.includes('site:x.com'))).toBe(true);
    expect(urls.some((u) => u.includes('archive.ph'))).toBe(true);
    expect(urls.some((u) => u.includes('ghostarchive.org'))).toBe(true);
    const strings = steps.filter((s) => typeof s === 'string') as string[];
    expect(strings.length).toBeGreaterThanOrEqual(2);
  });
});
