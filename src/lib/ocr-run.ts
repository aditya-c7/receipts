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

function meanConfidence(lines: Array<{ confidence: number }>): number {
  if (lines.length === 0) return 0;
  let sum = 0;
  for (const l of lines) sum += l.confidence;
  return sum / lines.length;
}

/** Union of line bboxes (crop px), padded and clamped to the crop size. */
function bandUnion(
  lines: Array<{ bbox: BBox }>,
  cropW: number,
  cropH: number,
  pad = 8,
): BBox | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const l of lines) {
    x0 = Math.min(x0, l.bbox.x);
    y0 = Math.min(y0, l.bbox.y);
    x1 = Math.max(x1, l.bbox.x + l.bbox.w);
    y1 = Math.max(y1, l.bbox.y + l.bbox.h);
  }
  if (!Number.isFinite(x0)) return null;
  x0 = Math.max(0, Math.floor(x0 - pad));
  y0 = Math.max(0, Math.floor(y0 - pad));
  x1 = Math.min(cropW, Math.ceil(x1 + pad));
  y1 = Math.min(cropH, Math.ceil(y1 + pad));
  if (x1 - x0 < 40 || y1 - y0 < 12) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Header band: first 3 non-empty full-pass lines (name + @handle live here). */
function headerBand(
  lines: Array<{ text: string; bbox: BBox }>,
  cropW: number,
  cropH: number,
): BBox | null {
  const head = lines.filter((l) => l.text.trim() !== '').slice(0, 3);
  const band = bandUnion(head, cropW, cropH);
  if (band === null) return null;
  // Avatars sit in the left column and OCR as ©/Q-letter garbage that can
  // out-score the real handle. Exclude the left 12% from the re-OCR band
  // (the full pass still covers it — this only narrows the zoomed re-read).
  const cut = cropW * 0.12;
  if (band.x + band.w <= cut) return null;
  if (band.x < cut) {
    const shift = cut - band.x;
    band.x = cut;
    band.w = Math.max(0, band.w - shift);
  }
  if (band.w < 40) return null;
  return band;
}

const DATE_HINT_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b|\d{1,2}[:/.-]\d|\b(am|pm)\b/i;

/** Date band: bottom-most line that looks like a timestamp line. */
function dateBand(
  lines: Array<{ text: string; bbox: BBox }>,
  cropW: number,
  cropH: number,
): BBox | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l !== undefined && DATE_HINT_RE.test(l.text)) {
      return bandUnion([l], cropW, cropH);
    }
  }
  return null;
}

interface CropLine {
  text: string;
  confidence: number;
  bbox: BBox;
}

/**
 * Re-OCR one band at 3x with PSM single-line. Returns crop-px lines, or null
 * when the pass fails or is empty. Callers keep whichever pass (full vs band)
 * has the higher mean confidence.
 */
async function reOcrBand(
  eng: TesseractEngine,
  crop: HTMLCanvasElement,
  band: BBox,
  report: (p: number, stage: string) => void,
): Promise<CropLine[] | null> {
  const SCALE = 3;
  const sw = Math.max(1, Math.round(band.w));
  const sh = Math.max(1, Math.round(band.h));
  const big = document.createElement('canvas');
  big.width = sw * SCALE;
  big.height = sh * SCALE;
  const bctx = canvas2d(big, false);
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(crop, band.x, band.y, sw, sh, 0, 0, big.width, big.height);
  try {
    const res = await eng.recognizeWithParams(big as unknown as ImageBitmap, { lang: 'eng' }, {
      tessedit_pageseg_mode: '7',
    });
    const out = res.lines
      .filter((l) => l.text.trim() !== '')
      .map((l) => ({
        text: l.text,
        confidence: l.confidence,
        bbox: {
          x: band.x + l.bbox.x / SCALE,
          y: band.y + l.bbox.y / SCALE,
          w: l.bbox.w / SCALE,
          h: l.bbox.h / SCALE,
        },
      }));
    report(0.85, 'recognize');
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Replace overlapped originals with band lines when the band wins on confidence. */
function mergeBand(cropLines: CropLine[], band: BBox, bandLines: CropLine[]): CropLine[] {
  const overlapped = cropLines.filter(
    (l) =>
      l.bbox.x + l.bbox.w / 2 >= band.x &&
      l.bbox.x + l.bbox.w / 2 <= band.x + band.w &&
      l.bbox.y + l.bbox.h / 2 >= band.y &&
      l.bbox.y + l.bbox.h / 2 <= band.y + band.h,
  );
  if (overlapped.length === 0) return cropLines;
  if (meanConfidence(bandLines) <= meanConfidence(overlapped)) return cropLines;
  const insertAt = cropLines.indexOf(overlapped[0] as CropLine);
  const overlappedSet = new Set(overlapped);
  const kept = cropLines.filter((l) => !overlappedSet.has(l));
  const sorted = [...bandLines].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  kept.splice(Math.max(0, insertAt), 0, ...sorted);
  return kept;
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
    const eng = getEngine();
    const res = await eng.recognize(crop as unknown as ImageBitmap, {
      lang: 'eng',
      onProgress: (p, stage) => report(p, stage),
    });

    // SPEC §4.1 pass 2 — region re-OCR for precision: header (name+handle)
    // and timestamp line are re-read at 3x with PSM single-line; whichever
    // pass has the higher mean confidence wins, per band. Never throws: a
    // failed re-OCR keeps the full-pass lines.
    const pxW = crop.width;
    const pxH = crop.height;
    let cropLines: CropLine[] = res.lines.map((l) => ({
      text: l.text,
      confidence: l.confidence,
      bbox: { ...l.bbox },
    }));
    for (const band of [headerBand(cropLines, pxW, pxH), dateBand(cropLines, pxW, pxH)]) {
      if (band === null) continue;
      const bandLines = await reOcrBand(eng, crop, band, report);
      if (bandLines !== null) cropLines = mergeBand(cropLines, band, bandLines);
    }

    // Engine confidences are 0..100; parse expects 0..1. Bboxes are mapped
    // back to normalized source coordinates BEFORE parsing so every field
    // bbox produced downstream (unions included) is already overlay-ready.
    const lines: OcrInputLine[] = cropLines.map((l) => ({
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
