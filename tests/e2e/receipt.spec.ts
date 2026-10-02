import { test, expect } from '@playwright/test';

const CLAIMED = 'Just shipped our new prototype after months of work. Thanks to everyone who helped test it!';
const CAND = {
  tweetId: '1787687654321098752',
  idTimeMs: Date.parse('2024-05-10T12:00:00Z'),
  snapshotTs: '20240510120000',
  originalUrl: 'https://x.com/example_user/status/1787687654321098752',
  archiveUrl: 'https://web.archive.org/web/20240510120000id_/https://x.com/example_user/status/1787687654321098752',
  statusCode: 200,
};

test('receipt consent flow', async ({ page }) => {
  let receiptBody: unknown = null;
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
  await page.route('**/api/receipt', async (route) => {
    receiptBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, id: 'AbC123XyZ9', url: '/r/AbC123XyZ9' }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Example 1 (archived)' }).click();
  await expect(page.getByTestId('verdict-card')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('create-receipt-open').click();
  await expect(page.getByTestId('receipt-dialog')).toBeVisible();
  // Both consents required before confirm enables.
  await expect(page.getByTestId('create-receipt-confirm')).toBeDisabled();
  await page.getByTestId('consent-upload').check();
  await expect(page.getByTestId('create-receipt-confirm')).toBeDisabled();
  await page.getByTestId('consent-store').check();
  await expect(page.getByTestId('create-receipt-confirm')).toBeEnabled();
  await page.getByTestId('create-receipt-confirm').click();
  await expect(page.getByTestId('receipt-card')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('receipt-qr')).toBeVisible();
  // Body text only leaves on this explicit opt-in POST.
  expect(receiptBody).toMatchObject({ handle: 'example_user', claimedText: CLAIMED });
  await expect(page.getByTestId('receipt-snippet')).toContainText(CLAIMED.slice(0, 40));
});

test('receipt permalink view', async ({ page }) => {
  await page.route('**/api/receipt/AbC123XyZ9', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        receipt: {
          id: 'AbC123XyZ9',
          schemaVersion: 1,
          verdictCode: 'MATCH_STRONG',
          score: 0.98,
          handle: 'example_user',
          claimedDateIso: '2024-05-10',
          snapshotTs: '20240510120000',
          originalUrl: 'https://x.com/example_user/status/1787687654321098752',
          archiveSnippet: CLAIMED.slice(0, 140),
          fieldsEdited: 0,
          createdAt: 1715347200000,
        },
      }),
    });
  });
  await page.goto('/r/AbC123XyZ9');
  await expect(page.getByTestId('receipt-card')).toBeVisible({ timeout: 15000 });
});
