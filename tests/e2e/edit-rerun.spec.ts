import { test, expect } from '@playwright/test';

test('edit handle re-runs the check with the new handle', async ({ page }) => {
  const seenHandles: string[] = [];
  await page.route('**/api/wayback/search', async (route) => {
    // postDataJSON() is synchronous in this Playwright version (throws on no/invalid body).
    let body: { handle?: string } | null = null;
    try {
      body = route.request().postDataJSON() as { handle?: string } | null;
    } catch {
      body = null;
    }
    if (body?.handle) seenHandles.push(body.handle);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        cached: false,
        candidates: [],
        coverage: { buckets: 1, totalCaptures: 0, truncated: false, handleHasAnyCaptures: false },
      }),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Example 1 (archived)' }).click();
  await expect(page.getByTestId('verdict-card')).toBeVisible({ timeout: 15000 });
  // Edit the handle -> debounced re-run should POST the new handle.
  await page.getByTestId('field-handle').fill('edited_handle');
  await expect(async () => {
    expect(seenHandles[seenHandles.length - 1]).toBe('edited_handle');
  }).toPass({ timeout: 15000 });
  expect(seenHandles.length).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('fields-edited-badge')).toBeVisible();
});
