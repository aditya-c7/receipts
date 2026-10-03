import { test, expect } from '@playwright/test';

// OCR smoke: exercises the REAL on-device Tesseract pipeline (no mocks for
// /tesseract/* — vite serves public/; only the archive API is stubbed since
// the OCR path needs no API). Generates a synthetic screenshot in-test:
// huge black-on-white text incl. a handle, a date, body words, and a
// platform signal word. Assertions stay loose: handle OR body non-empty.
test('ocr smoke: synthetic screenshot reads via on-device OCR', async ({ page }) => {
  test.slow();
  test.setTimeout(150_000);

  // Keep the post-OCR auto-check hermetic (no live archive, no wrangler).
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

  // Render synthetic "screenshot" content and capture it as a PNG buffer.
  await page.setContent(`<!doctype html>
<html><body style="margin:0;background:#ffffff;color:#000000;font-family:Arial,Helvetica,sans-serif">
<div style="padding:80px;font-size:88px;line-height:1.45;font-weight:700">
<div>Smoke Test Post</div>
<div>@smoketest</div>
<div>These are body words for the smoke test of optical character recognition</div>
<div>Mar 14, 2023</div>
<div>123 Views</div>
</div>
</body></html>`);
  const png = await page.screenshot({ fullPage: true });
  expect(png.length).toBeGreaterThan(10_000);

  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({ name: 'smoke.png', mimeType: 'image/png', buffer: png });

  // OCR (WASM load + eng data + recognition) can take a while on first run.
  await expect(page.getByTestId('field-editor')).toBeVisible({ timeout: 90_000 });
  await expect(async () => {
    const handle = await page.getByTestId('field-handle').inputValue();
    const body = await page.getByTestId('field-body').inputValue();
    expect(handle.includes('smoketest') || body.trim().length > 0).toBe(true);
  }).toPass({ timeout: 30_000 });
});
