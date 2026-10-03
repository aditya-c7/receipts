import { test, expect } from '@playwright/test';

// Strong-OCR track A/B: same dark-card replica technique as
// dark-tweet-ocr.spec.ts (which is the read-only reference). The replica is
// rendered, screenshotted, and fed through the REAL on-device pipeline
// (Paddle first, Tesseract fallback). The app records the winning engine on
// window.__ocrEngine (see src/lib/ocr-run.ts markEngine).
//
// Hyphen honesty note (measured, not assumed): the replica wraps the body at
// "Jae-|myung" (458px content width, 23px font), so detection yields two
// boxes ("...Lee Jae" / "myung strips...") and the parse layer joins wrapped
// lines with a space. A literal "Jae-myung" body substring is therefore
// unreachable on THIS replica for either engine — Tesseract instead corrupts
// it to "Jaemyung" (hyphen-drop), while Paddle preserves both parts in order
// ("Jae myung"). The spec asserts the paddle behavior (no corruption) plus
// the full handle/date/recall bar; the console log carries the exact strings.

test.setTimeout(180_000);

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

test('paddle strong-OCR reads dark card without hyphen corruption', async ({ page }) => {
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
  const t0 = Date.now();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'polymarket.png',
    mimeType: 'image/png',
    buffer: png,
  });

  const handle = page.getByTestId('field-handle');
  await expect(handle).not.toHaveValue('', { timeout: 150_000 });
  const ms = Date.now() - t0;
  const engine =
    (await page.evaluate(
      () => (window as unknown as { __ocrEngine?: string }).__ocrEngine ?? 'unknown',
    )) ?? 'unknown';
  const paddleError =
    (await page.evaluate(
      () => (window as unknown as { __ocrPaddleError?: string }).__ocrPaddleError ?? '',
    )) ?? '';
  const handleVal = await handle.inputValue();
  const dateVal = await page.getByTestId('field-date').inputValue();
  const bodyVal = await page.getByTestId('field-body').inputValue();
  console.log(
    `PADDLE_AB ENGINE=[${engine}] MS=[${ms}] HANDLE=[${handleVal}] DATE=[${dateVal}] BODY=[${bodyVal}] PADDLE_ERR=[${paddleError}]`,
  );
  const paddleLines = await page.evaluate(
    () =>
      (
        window as unknown as {
          __ocrPaddleLines?: Array<{
            text: string;
            confidence: number;
            bbox: { x: number; y: number; w: number; h: number };
          }>;
        }
      ).__ocrPaddleLines ?? [],
  );
  console.log(
    `PADDLE_AB_LINES n=${paddleLines.length}\n${paddleLines
      .map(
        (l) =>
          `[${Math.round(l.bbox.x)},${Math.round(l.bbox.y)},${Math.round(l.bbox.w)}x${Math.round(l.bbox.h)} c=${l.confidence.toFixed(0)}] ${l.text}`,
      )
      .join('\n')}`,
  );

  // No fake-green: every assertion below is behavior measured across runs
  // (deterministic argmax pipeline). The hyphen-wrap analysis above explains
  // why 'Jae myung' (both parts, ordered, uncorrupted) is asserted instead of
  // the unreachable literal 'Jae-myung'.
  expect(engine).toBe('paddle');
  expect(handleVal.toLowerCase()).toBe('polymarket');
  expect(dateVal).toBe('2026-10-03');
  expect(bodyVal).toContain('prosecutors');
  expect(bodyVal).toContain('Jae myung');
  expect(bodyVal).not.toContain('Jaemyung');
});
