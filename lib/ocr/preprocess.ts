// Pure, synchronous preprocessing helpers (Track A).
//
// All canvas/ImageBitmap work stays in the CALLER (async, DOM-side). This
// module only computes geometry/threshold parameters so every function here
// is deterministic and unit-testable. Never log image bytes.

import { OCR_MAX_DIM, OCR_MIN_WIDTH } from '../config';

/** Caller-side canvas pipeline (descriptive — implemented by the caller):
 *  1. size = computeTargetSize(srcW, srcH); draw to an offscreen canvas at
 *     size with ctx.imageSmoothingEnabled = true, ctx.imageSmoothingQuality =
 *     'high' (upscaling legibility matters more than speed here).
 *  2. Compute mean relative luminance (0..1) on a small downscaled gray copy;
 *     invert = shouldInvert(mean). Dark-mode screenshots (light text on dark)
 *     OCR far better inverted to dark-on-light.
 *  3. Optional contrast stretch per pixel: out = contrastStretchValue(v, low,
 *     high) with low ~= 5th percentile, high ~= 95th percentile gray value.
 *  4. Drop the top strip: topCutPx = topBarCutoffPx(targetH) removes the OS
 *     status bar (clock/battery) which only adds OCR noise.
 *  5. toImageBitmap(canvas) -> feed to OcrEngine.recognize().
 */
export const PREPROCESS_CANVAS_NOTES =
  'resize(smoothing high) -> luminance mean -> optional invert -> ' +
  'contrast stretch [low,high]->[0,255] -> drop top 6% status bar -> ImageBitmap';

/** Planned preprocessing for one screenshot (pure data for the caller). */
export interface PreprocessPlan {
  srcW: number;
  srcH: number;
  targetW: number;
  targetH: number;
  /** True when the caller should invert (dark-mode screenshot). */
  invert: boolean;
  /** Pixels to drop from the top (status bar). */
  topCutPx: number;
  /** Contrast stretch input range (output is always 0..255). */
  contrastLow: number;
  contrastHigh: number;
}

/**
 * Target bitmap size: enforce the OCR_MIN_WIDTH floor first, then cap the
 * longest side at OCR_MAX_DIM. The cap wins on pathological aspect ratios so
 * memory stays bounded (longest side of the result is always <= OCR_MAX_DIM).
 * Caller must use high-quality smoothing when resizing.
 */
export function computeTargetSize(w: number, h: number): { w: number; h: number } {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { w: 0, h: 0 };
  }
  let tw = w;
  let th = h;
  if (tw < OCR_MIN_WIDTH) {
    const s = OCR_MIN_WIDTH / tw;
    tw *= s;
    th *= s;
  }
  const longest = Math.max(tw, th);
  if (longest > OCR_MAX_DIM) {
    const s = OCR_MAX_DIM / longest;
    tw *= s;
    th *= s;
  }
  return { w: Math.max(1, Math.round(tw)), h: Math.max(1, Math.round(th)) };
}

/**
 * Dark-mode heuristic: invert when mean relative luminance (0..1) is below
 * 0.45, so the recognizer sees dark text on a light background.
 */
export function shouldInvert(luminanceMean: number): boolean {
  if (!Number.isFinite(luminanceMean)) return false;
  return luminanceMean < 0.45;
}

/** Height in px of the OS status-bar strip to drop from the top (top 6%). */
export function topBarCutoffPx(imageH: number): number {
  if (!Number.isFinite(imageH) || imageH <= 0) return 0;
  return Math.floor(imageH * 0.06);
}

/** Clamp a single sample to a byte (rounds, maps NaN to 0). */
export function clampByte(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(255, Math.max(0, Math.round(v)));
}

/**
 * Linear contrast stretch: maps [low, high] -> [0, 255] with clamping.
 * Defaults suit dark-on-light screenshots (tune low/high from the 5th/95th
 * gray percentiles). Degenerate range (high <= low) just clamps.
 */
export function contrastStretchValue(v: number, low = 32, high = 224): number {
  if (!Number.isFinite(v)) return 0;
  if (!(high > low)) return clampByte(v);
  return clampByte(((v - low) * 255) / (high - low));
}

/** Clamp every sample of one scanline to byte range (pure). */
export function clampLine(line: readonly number[]): number[] {
  return line.map(clampByte);
}

/** Convenience: full plan from source size + measured luminance. */
export function buildPreprocessPlan(
  srcW: number,
  srcH: number,
  luminanceMean: number,
  contrast?: { low?: number; high?: number },
): PreprocessPlan {
  const target = computeTargetSize(srcW, srcH);
  const low = contrast?.low ?? 32;
  const high = contrast?.high ?? 224;
  return {
    srcW,
    srcH,
    targetW: target.w,
    targetH: target.h,
    invert: shouldInvert(luminanceMean),
    topCutPx: topBarCutoffPx(target.h),
    contrastLow: low,
    contrastHigh: high,
  };
}
