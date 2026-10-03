import { test, expect } from '@playwright/test';

// Archive text unreadable (null) + live X post verifies author + text
// → upgraded MATCH_STRONG via x-live, original link shown.
const TWEET_ID = '957414748881997825';
const HANDLE = 'elonmusk';
const DAY = '2018-01-28';
const BODY = 'The Boring Company flamethrower guaranteed to liven up any party!';
const ORIGINAL = `https://x.com/${HANDLE}/status/${TWEET_ID}`;

test('unreadable archive + live verification upgrades verdict and links original', async ({ page }) => {
  await page.route('**/api/wayback/search', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        cached: false,
        candidates: [
          {
            tweetId: TWEET_ID,
            idTimeMs: Date.parse('2018-01-28T00:47:18.000Z'),
            snapshotTs: '20240101000000',
            originalUrl: ORIGINAL,
            archiveUrl: `https://web.archive.org/web/20240101000000id_/${ORIGINAL}`,
            statusCode: 200,
          },
        ],
        coverage: { buckets: 2, totalCaptures: 1, truncated: false, handleHasAnyCaptures: true },
      }),
    });
  });
  await page.route('**/api/wayback/snapshot', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, cached: false, archiveUrl: ORIGINAL, extracted: { text: null, extractor: 'none' } }),
    });
  });
  await page.route('**/api/x/tweet', async (route) => {
    const body = route.request().postDataJSON() as { id?: string };
    expect(body.id).toBe(TWEET_ID);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        cached: false,
        tweet: { status: 'live', id: TWEET_ID, text: `${BODY} https://t.co/n2FiZimJia`, screenName: HANDLE },
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Example 4 (no match)' }).click();
  await expect(page.getByTestId('field-handle')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('field-handle').fill(HANDLE);
  await page.getByTestId('field-date').fill(DAY);
  await page.getByTestId('field-body').fill(BODY);

  await expect(page.getByTestId('verdict-card')).toContainText('Archived original found', { timeout: 30000 });
  await expect(page.getByTestId('verified-badge')).toContainText('Verified against the live post on X');
  const href = await page.getByTestId('original-open-link').getAttribute('href');
  expect(href).toBe(ORIGINAL);
  await expect(page.getByTestId('original-copy')).toBeVisible();
});
