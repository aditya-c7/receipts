import { test, expect } from '@playwright/test';

// Privacy guardrail: no POST anywhere may carry image bytes or data: URLs.
test('no image bytes ever upload', async ({ page }) => {
  const bad: string[] = [];
  page.on('request', (req) => {
    if (req.method() !== 'POST') return;
    const data = req.postData() ?? '';
    const bytes = req.headers()['content-length'];
    if (data.includes('data:image') || data.length > 8000 || (bytes != null && Number(bytes) > 8000)) {
      bad.push(`${req.url()} (${data.length} chars)`);
    }
  });
  await page.route('**/api/wayback/search', async (route) => {
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
  // Full check flow via bundled example (no file needed).
  await page.getByRole('button', { name: 'Example 2 (archived)' }).click();
  await expect(page.getByTestId('verdict-card')).toBeVisible({ timeout: 15000 });
  // Upload path: attach a real (tiny) PNG through the picker.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.getByTestId('file-input').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByTestId('field-editor')).toBeVisible({ timeout: 10000 });
  expect(bad).toEqual([]);
});
