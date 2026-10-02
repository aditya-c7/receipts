import { describe, it, expect } from 'vitest';
import {
  computeTargetSize,
  shouldInvert,
  topBarCutoffPx,
  clampByte,
  contrastStretchValue,
  clampLine,
  buildPreprocessPlan,
} from '../../lib/ocr/preprocess';
import { OCR_MAX_DIM, OCR_MIN_WIDTH } from '../../lib/config';

describe('computeTargetSize', () => {
  it('caps the longest side at OCR_MAX_DIM', () => {
    expect(computeTargetSize(3000, 2000)).toEqual({ w: 2400, h: 1600 });
    const r = computeTargetSize(1000, 5000);
    expect(Math.max(r.w, r.h)).toBeLessThanOrEqual(OCR_MAX_DIM);
  });

  it('upscales narrow images to OCR_MIN_WIDTH', () => {
    expect(computeTargetSize(800, 600)).toEqual({ w: 1200, h: 900 });
    expect(computeTargetSize(500, 500)).toEqual({ w: 1200, h: 1200 });
  });

  it('leaves good sizes unchanged', () => {
    expect(computeTargetSize(1500, 1000)).toEqual({ w: 1500, h: 1000 });
    expect(computeTargetSize(OCR_MIN_WIDTH, 800)).toEqual({ w: OCR_MIN_WIDTH, h: 800 });
  });

  it('keeps the cap winning on extreme aspects (bounded memory)', () => {
    const r = computeTargetSize(800, 3000);
    expect(Math.max(r.w, r.h)).toBeLessThanOrEqual(OCR_MAX_DIM);
    expect(r).toEqual({ w: 640, h: 2400 });
  });

  it('returns zeros for invalid input', () => {
    expect(computeTargetSize(0, 100)).toEqual({ w: 0, h: 0 });
    expect(computeTargetSize(-5, 100)).toEqual({ w: 0, h: 0 });
    expect(computeTargetSize(Number.NaN, 100)).toEqual({ w: 0, h: 0 });
  });
});

describe('shouldInvert', () => {
  it('inverts dark screenshots only', () => {
    expect(shouldInvert(0.2)).toBe(true);
    expect(shouldInvert(0.44)).toBe(true);
    expect(shouldInvert(0.45)).toBe(false);
    expect(shouldInvert(0.9)).toBe(false);
    expect(shouldInvert(Number.NaN)).toBe(false);
  });
});

describe('topBarCutoffPx', () => {
  it('cuts the top 6%', () => {
    expect(topBarCutoffPx(1000)).toBe(60);
    expect(topBarCutoffPx(1080)).toBe(64);
    expect(topBarCutoffPx(0)).toBe(0);
    expect(topBarCutoffPx(-10)).toBe(0);
  });
});

describe('contrast helpers', () => {
  it('clamps bytes', () => {
    expect(clampByte(-3)).toBe(0);
    expect(clampByte(300)).toBe(255);
    expect(clampByte(12.6)).toBe(13);
  });

  it('stretches [low,high] to [0,255]', () => {
    expect(contrastStretchValue(32, 32, 224)).toBe(0);
    expect(contrastStretchValue(224, 32, 224)).toBe(255);
    expect(contrastStretchValue(128, 32, 224)).toBe(128);
    expect(contrastStretchValue(-50, 32, 224)).toBe(0);
    expect(contrastStretchValue(999, 32, 224)).toBe(255);
  });

  it('clamps whole scanlines', () => {
    expect(clampLine([-5, 100.4, 300])).toEqual([0, 100, 255]);
  });
});

describe('buildPreprocessPlan', () => {
  it('combines size, invert, topbar', () => {
    const p = buildPreprocessPlan(800, 600, 0.2);
    expect(p.targetW).toBe(1200);
    expect(p.targetH).toBe(900);
    expect(p.invert).toBe(true);
    expect(p.topCutPx).toBe(Math.floor(900 * 0.06));
  });
});
