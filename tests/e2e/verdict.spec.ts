import { test, expect, type Page } from '@playwright/test';

const CLAIMED = 'Just shipped our new prototype after months of work. Thanks to everyone who helped test it!';
const CAND = {
  tweetId: '1787687654321098752',
  idTimeMs: Date.parse('2024-05-10T12:00:00Z'),
  snapshotTs: '20240510120000',
  originalUrl: 'https://x.com/example_user/status/1787687654321098752',
  archiveUrl: 'https://web.archive.org/web/20240510120000id_/https://x.com/example_user/status/1787687654321098752',
  statusCode: 200,
};

async function mockMatch(page: Page): Promise<void> {
  await page.route('**/api/wayback/search', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        cached: false,
        candidates: [CAND],
        coverage: { buckets: 2, totalCaptures: 1, truncated: false, handleHasAnyCaptures: true },
      }),
    });
  });
  await page.route('**/api/wayback/snapshot', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        cached: false,
        archiveUrl: CAND.archiveUrl,
        extracted: { text: CLAIMED, extractor: 'og' },
      }),
    });
  });
}

test('strong-match verdict path', async ({ page }) => {
  await mockMatch(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Example 1 (archived)' }).click();
  await expect(page.getByTestId('verdict-card')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('verdict-title')).toContainText('Archived original found', { timeout: 15000 });
  await expect(page.getByTestId('coverage-line')).toContainText('Compared 1 of 1');
  await expect(page.getByTestId('diff-view')).toBeVisible();
  await expect(page.getByTestId('archive-preview')).toBeVisible();
});

test('no-match verdict path', async ({ page }) => {
  await page.route('**/api/wayback/search', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        cached: false,
        candidates: [],
        coverage: { buckets: 2, totalCaptures: 0, truncated: false, handleHasAnyCaptures: false },
      }),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Example 4 (no match)' }).click();
  await expect(page.getByTestId('verdict-card')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('verdict-title')).toContainText('No archive match found', { timeout: 15000 });
});
