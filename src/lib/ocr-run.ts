// On-device OCR pipeline: canvas preprocess -> TesseractEngine -> parse.
//
// Ground rules (SPEC + AGENTS.md):
// - Screenshot pixels NEVER leave the device. Everything here runs locally
//   (canvas + tesseract.js WASM). Never log image bytes, never upload.
// - tesseract.js itself stays out of the first-load bundle: lib/ocr/engine.ts
//   pulls it in via dynamic import() only when recognize() runs (lazy +
//   cached). This module only statically imports the small wrapper + pure
//   helpers, so importing it from App is cheap.
//
// SELF-HOST PATHS (verified against tesseract.js v5.1.1 sources):
// - workerPath points at the worker.min.js FILE
//   (src/worker/browser/defaultOptions.js defaults to .../dist/worker.min.js).
// - corePath is the DIRECTORY BASE: worker getCore() strips a trailing slash
//   and appends /tesseract-core[-simd][-lstm].wasm.js, picking the SIMD/LSTM
//   build for the device (src/worker-script/browser/getCore.js). Setting it
//   to a specific .js file is strongly discouraged (legacy fallback only).
// - langPath is the DIRECTORY BASE (no trailing slash per docs): the worker
//   fetches `${langPath}/${lang}.traineddata.gz` (gzip defaults true) via
//   `langPathDownload.replace(/\/$/, '')` (src/worker-script/index.js).
//   Default OEM is LSTM-only, so only the *-lstm core files are ever picked.

import { TesseractEngine } from '../../lib/ocr/engine';
import { parseScreenshot, type OcrInputLine } from '../../lib/ocr/parse';
import { buildPreprocessPlan, contrastStretchValue } from '../../lib/ocr/preprocess';
import type { BBox, ParsedScreenshot } from '../../lib/types';

const SELF_HOST = {
  workerPath: '/tesseract/worker.min.js',
  corePath: '/tesseract',
  langPath: '/tesseract',
} as const;

let engine: TesseractEngine | null = null;

/** Singleton engine (worker + WASM + language data load once, then cached). */
export function getEngine(): TesseractEngine {
  if (engine === null) {
    engine = new TesseractEngine({
      workerPath: SELF_HOST.workerPath,
      corePath: SELF_HOST.corePath,
      langPath: SELF_HOST.langPath,
    });
  }
  return engine;
}

/**
 * Best-effort warm-up: start loading the worker/WASM/language data when the
 * browser is idle so the first real OCR is faster. Failures are swallowed —
 * runOcr() will simply load on demand instead.
 */
export function warmUpOcr(): void {
  const kick = (): void => {
    getEngine()
      .warmUp('eng')
      .catch(() => undefined);
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => {
      kick();
    });
  } else {
    window.setTimeout(kick, 1500);
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * Map an engine bbox (pixels in the cropped preprocessed bitmap) back to
 * normalized 0..1 coordinates relative to the SOURCE image, so
 * ScreenshotOverlay (which draws over the original upload) lines up.
 *
 * Engine px -> target px (re-add the cropped top strip) -> source px
 * (scale by src/target) -> normalized (divide by source dims). The src
 * factors cancel, leaving: x = (bx)/targetW, y = (by+topCut)/targetH.
 */
function toNormalizedSource(
  b: BBox,
  targetW: number,
  targetH: number,
  topCutPx: number,
): BBox {
  const x = clamp01(b.x / targetW);
  const y = clamp01((b.y + topCutPx) / targetH);
  const w = Math.min(clamp01(b.w / targetW), 1 - x);
  const h = Math.min(clamp01(b.h / targetH), 1 - y);
  return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
}

function canvas2d(
  canvas: HTMLCanvasElement,
  frequentReads: boolean,
): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', frequentReads ? { willReadFrequently: true } : undefined);
  if (ctx === null) throw new Error('canvas 2d unavailable');
  return ctx;
}

/** Mean relative luminance (0..1) of a ~2% probe of the source bitmap. */
function probeLuminance(src: ImageBitmap): number {
  const probeW = Math.max(1, Math.round(src.width / 7));
  const probeH = Math.max(1, Math.round(src.height / 7));
  const probe = document.createElement('canvas');
  probe.width = probeW;
  probe.height = probeH;
  const pctx = canvas2d(probe, true);
  pctx.drawImage(src, 0, 0, probeW, probeH);
  const data = pctx.getImageData(0, 0, probeW, probeH).data;
  const px = probeW * probeH;
  let sum = 0;
  for (let i = 0; i < px; i++) {
    const r = data[i * 4] ?? 0;
    const g = data[i * 4 + 1] ?? 0;
    const b = data[i * 4 + 2] ?? 0;
    sum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  return px === 0 ? 1 : sum / px;
}

/**
 * Full screenshot -> ParsedScreenshot pipeline. Throws when the image cannot
 * be decoded or OCR fails (caller shows the manual-edit fallback).
 */
export async function runOcr(
  file: File,
  onProgress?: (p: number, stage: string) => void,
): Promise<ParsedScreenshot> {
  const report = (p: number, stage: string): void => {
    onProgress?.(p, stage);
  };
  report(0, 'read');

  let src: ImageBitmap | null = null;
  try {
    src = await createImageBitmap(file);
    const srcW = src.width;
    const srcH = src.height;
    if (srcW <= 0 || srcH <= 0) throw new Error('unreadable image');

    const plan = buildPreprocessPlan(srcW, srcH, probeLuminance(src));
    if (plan.targetW <= 0 || plan.targetH <= 0) throw new Error('unreadable image');

    // Resize with high-quality smoothing (upscaling legibility > speed).
    const full = document.createElement('canvas');
    full.width = plan.targetW;
    full.height = plan.targetH;
    const fctx = canvas2d(full, true);
    fctx.imageSmoothingEnabled = true;
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(src, 0, 0, plan.targetW, plan.targetH);

    // Grayscale + dark-mode invert + contrast stretch.
    const img = fctx.getImageData(0, 0, plan.targetW, plan.targetH);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] ?? 0;
      const g = d[i + 1] ?? 0;
      const b = d[i + 2] ?? 0;
      let v = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (plan.invert) v = 255 - v;
      const out = contrastStretchValue(v, plan.contrastLow, plan.contrastHigh);
      d[i] = out;
      d[i + 1] = out;
      d[i + 2] = out;
    }
    fctx.putImageData(img, 0, 0);

    // Drop the OS status-bar strip, then hand an ImageBitmap to the engine.
    const topCut = Math.max(0, Math.min(plan.topCutPx, plan.targetH - 1));
    const cropH = plan.targetH - topCut;
    const crop = document.createElement('canvas');
    crop.width = plan.targetW;
    crop.height = Math.max(1, cropH);
    if (cropH > 0) {
      const cctx = canvas2d(crop, false);
      cctx.drawImage(full, 0, topCut, plan.targetW, cropH, 0, 0, plan.targetW, cropH);
    }

    // NOTE (verified against tesseract.js v5.1.1
    // src/worker/browser/loadImage.js): the browser loader accepts
    // string/File/Blob/IMG/VIDEO/CANVAS/OffscreenCanvas but NOT ImageBitmap
    // (an ImageBitmap falls through and becomes garbage bytes -> "Image file
    // /input cannot be read!"). So the preprocessed CANVAS itself is handed
    // to the engine (it PNG-encodes via toBlob internally); the cast only
    // bridges lib/ocr/engine.ts, whose parameter is typed ImageBitmap.
    const res = await getEngine().recognize(crop as unknown as ImageBitmap, {
      lang: 'eng',
      onProgress: (p, stage) => report(p, stage),
    });

    // Engine confidences are 0..100; parse expects 0..1. Bboxes are mapped
    // back to normalized source coordinates BEFORE parsing so every field
    // bbox produced downstream (unions included) is already overlay-ready.
    const lines: OcrInputLine[] = res.lines.map((l) => ({
      text: l.text,
      confidence: clamp01(l.confidence / 100),
      bbox: toNormalizedSource(l.bbox, plan.targetW, plan.targetH, topCut),
    }));
    const parsed = parseScreenshot(lines);
    return { ...parsed, ocrMs: res.ms, fieldsEdited: false };
  } finally {
    src?.close();
  }
}
