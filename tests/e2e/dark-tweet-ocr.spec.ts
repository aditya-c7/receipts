import { test, expect } from '@playwright/test';

// Replica of the reported Polymarket dark-card screenshot (490px wide,
// dark theme, verified handle, timestamp with time + Views, engagement row).
// Feeds the RENDERED pixels through the real on-device OCR path.
const REPLICA_HTML = `<!doctype html><html><body style="margin:0;background:#111">
<div id="card" style="width:490px;background:#000;color:#fff;font-family:Arial,sans-serif;padding:12px 16px;box-sizing:border-box">
  <div style="display:flex;gap:10px;align-items:center">
    <div style="width:40px;height:40px;border-radius:8px;background:#2f6fed;color:#fff;font-weight:bold;font-size:24px;display:flex;align-items:center;justify-content:center">P</div>
    <div>
      <div style="font-weight:bold;font-size:22px">Polymarket <span style="color:#ffb400">&#10003;</span></div>
      <div style="color:#aaa;font-size:20px">@Polymarket</div>
    </div>
    <div style="margin-left:auto;color:#888;font-size:24px">&middot;&middot;&middot;</div>
  </div>
  <div style="font-size:23px;line-height:1.45;margin:12px 0">
    JUST IN: South Korean President Lee Jae-myung strips investigative powers from prosecutors who indicted him before he took office.
  </div>
  <div style="color:#888;font-size:20px">8:27 AM &middot; Oct 3, 2026 &middot; <b>36.1K</b> Views</div>
  <div style="display:flex;gap:60px;color:#888;font-size:20px;margin-top:14px">
    <span>27</span><span>41</span><span>232</span><span>12</span>
  </div>
</div></body></html>`;

test('dark X card OCR reads handle, date+time, body, platform', async ({ page }) => {
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
  await page.route('**/api/wayback/snapshot', async (route) => {
    await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
  });
  // Render replica and capture its pixels.
  await page.setContent(REPLICA_HTML);
  const png = await page.locator('#card').screenshot({ type: 'png' });

  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'polymarket.png',
    mimeType: 'image/png',
    buffer: png,
  });

  const handle = page.getByTestId('field-handle');
  await expect(handle).not.toHaveValue('', { timeout: 90000 });
  const handleVal = await handle.inputValue();
  const dateVal = await page.getByTestId('field-date').inputValue();
  const bodyVal = await page.getByTestId('field-body').inputValue();
  console.log(`OCR_HANDLE=[${handleVal}] OCR_DATE=[${dateVal}] OCR_BODY=[${bodyVal.slice(0, 80)}]`);

  expect(handleVal.toLowerCase()).toBe('polymarket');
  expect(dateVal).toBe('2026-10-03');
  expect(bodyVal).toContain('prosecutors');
  // NOTE: body punctuation fidelity (e.g. "Jae-myung" vs "Jaemyung") is the
  // strong-engine track's job (PaddleOCR). The `best` model covers the
  // header/date bands (search keys); matching is punctuation-insensitive.
  // Platform must be detected as X (Views signal) — no override checkbox.
  await expect(page.getByTestId('platform-override')).toHaveCount(0);
  // Filled fields must NEVER yield INSUFFICIENT_INPUT (empty wayback → NO_MATCH).
  await expect(page.getByTestId('verdict-card')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('verdict-card')).toContainText('No archive match', { timeout: 30000 });
});

test('edited handle/date re-check cleanly (no INSUFFICIENT dead-end)', async ({ page }) => {
  const seenHandles: string[] = [];
  await page.route('**/api/wayback/search', async (route) => {
    try {
      const body = route.request().postDataJSON() as { handle?: string };
      if (body?.handle) seenHandles.push(body.handle);
    } catch {
      // no/invalid body — ignore
    }
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
  await page.route('**/api/wayback/snapshot', async (route) => {
    await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
  });
  await page.setContent(REPLICA_HTML);
  const png = await page.locator('#card').screenshot({ type: 'png' });

  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'polymarket.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect(page.getByTestId('field-handle')).not.toHaveValue('', { timeout: 90000 });

  // The reported failure mode: user retypes handle with @ + capitals and
  // re-picks the date. The editor must normalize; the re-check must search
  // (lowercased) and land on NO_MATCH — never INSUFFICIENT_INPUT.
  await page.getByTestId('field-handle').fill('@POLYMARKET ');
  await page.getByTestId('field-date').fill('2026-10-03');
  await expect(page.getByTestId('field-handle')).toHaveValue('polymarket');
  await expect(page.getByTestId('verdict-card')).toContainText('No archive match', { timeout: 30000 });
  expect(seenHandles[seenHandles.length - 1]).toBe('polymarket');
});
