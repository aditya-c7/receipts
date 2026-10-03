// PaddleOCR (PP-OCRv5 mobile, EN) on-device OCR engine — strong-OCR track.
//
// Ground rules (SPEC + AGENTS.md), same as the Tesseract path:
// - Screenshot pixels NEVER leave the device. det/rec run fully local via
//   onnxruntime-web (WASM) on vendored models (public/paddle/). Never log
//   image bytes, never upload the bitmap.
// - First-load JS budget (<150kB gz): this module statically imports NOTHING
//   from 'onnxruntime-web' — only `import type` (erased at compile). The heavy
//   ORT runtime chunk loads via dynamic import() only when OCR actually runs.
// - $0 forever: no paid APIs, no cloud OCR, no keys. Models were downloaded
//   ONCE (see public/paddle/README.md) and are served same-origin.
//
// Pipeline (direction classifier skipped — screenshots are upright):
//   1. DB detection (det.onnx): RGB, ImageNet normalize, padded to x32,
//      run at NATIVE crop resolution (Paddle mobile defaults to long-side 960;
//      native keeps small UI text legible at a modest WASM cost).
//      Postprocess: threshold 0.3 -> 4-connected components -> box score
//      (mean prob, keep >= 0.5) -> unclip (area*1.5/perimeter expand, the
//      standard DB formula on the bbox approximation) -> clamp to image.
//   2. Recognition (en_rec.onnx, height-48 CTC): each box cropped from the
//      source pixels, aspect-kept resize to height 48 with UNBOUNDED width
//      (the export keeps the width axis dynamic), Otsu-anchored per-box
//      contrast expansion, ImageNet normalize, greedy CTC decode with
//      en_dict.txt (index 0 = blank, char i = dict[i-1], trailing class =
//      space — see ctcDecode).
//   3. Lines: ONE per detected box (per track contract), reading-order sorted
//      (row-grouped by y-centre, left-to-right within a row). Words: whole-line
//      fallback (one word per line, same text/bbox/confidence) — documented as
//      acceptable by the track spec.
//   NOTE on spaces: the EN dict FILE has no space line, but the rec head was
//   trained with PaddleOCR `use_space_char: true`, which appends SPACE as the
//   trailing class (438 = 436 dict + space + CTC blank 0 — verified against
//   the measured output dims and the official training configs). Multi-word
//   boxes therefore decode WITH spaces ("Oct 3, 2026"); single-word boxes
//   (the common DB outcome on spaced print) are unaffected either way.
//
// WASM threading: onnxruntime-web is pinned to 1.19.0, whose default bundle
// uses the classic threaded SIMD build RUN single-threaded (numThreads = 1,
// main-thread only), so NO COOP/COEP headers are required. (Newer ORT majors
// ship only a ~28MB JSEP build that breaks the 25MiB single-file deploy limit
// and whose extern-wasm variant cannot run under the vite dev server —
// measured, see docs/DECISIONS.md.) Devices without WASM SIMD (very old
// Safari) fail session creation -> we THROW and the caller falls back to
// Tesseract. All errors throw (caller falls back); warmUp failures are
// swallowed by the caller, not here.

import type { InferenceSession, Tensor } from 'onnxruntime-web';
import type {
  OcrEngine,
  OcrLine,
  OcrWord,
  RecognizeOptions,
  RecognizeResult,
} from '../../lib/ocr/engine';

type OrtModule = typeof import('onnxruntime-web');

const DET_URL = '/paddle/det.onnx';
const REC_URL = '/paddle/en_rec.onnx';
const DICT_URL = '/paddle/en_dict.txt';

// ImageNet normalization (PaddleOCR det + rec preprocess).
const NORM_MEAN = [0.485, 0.456, 0.406];
const NORM_STD = [0.229, 0.224, 0.225];

// DB postprocess knobs (Paddle defaults, recall-leaning box threshold for
// small UI text: upstream det_db_box_thresh is 0.6; we keep 0.5).
const DET_THRESH = 0.3;
const BOX_THRESH = 0.5;
const UNCLIP_RATIO = 1.5;
const MIN_BOX_SIDE = 6;
const MAX_BOXES = 150;

// PP-OCRv5 rec input geometry (configs/rec/PP-OCRv5 image_shape [3,48,320]).
// Height is fixed at 48; WIDTH is dynamic (the exported ONNX keeps the width
// axis dynamic, and the official TensorRT profile spans 160..3200). Upstream
// training/inference caps width at 320 for BATCHING, squeezing wider lines —
// but we run one box at a time, so width follows the box aspect uncapped and
// glyphs are never crushed (a full-width screenshot line decodes with spaces
// instead of collapsing to its first word).
const REC_H = 48;
const REC_FALLBACK_H = 32;

interface DetBox {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

let ortModule: OrtModule | null = null;
let detSession: InferenceSession | null = null;
let recSession: InferenceSession | null = null;
let recHeight = REC_H;
let dictChars: string[] | null = null;
let loadPromise: Promise<void> | null = null;

async function ensureOrt(): Promise<OrtModule> {
  if (ortModule !== null) return ortModule;
  // Dynamic import ONLY — keeps onnxruntime out of the first-load bundle.
  // The bundler inlines a same-origin reference to the WASM binary, so no
  // COOP/COEP-exempt CDN is involved; numThreads = 1 keeps execution
  // single-threaded (no SharedArrayBuffer requirement).
  const ort = await import('onnxruntime-web');
  ort.env.wasm.numThreads = 1;
  ortModule = ort;
  return ort;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`paddle asset fetch failed: ${url} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

async function loadDict(): Promise<string[]> {
  const res = await fetch(DICT_URL);
  if (!res.ok) throw new Error(`paddle dict fetch failed (${res.status})`);
  const text = await res.text();
  const chars = text.replace(/\r\n/g, '\n').split('\n');
  // Drop the single trailing empty string from the final newline.
  if (chars.length > 0 && chars[chars.length - 1] === '') chars.pop();
  if (chars.length === 0) throw new Error('paddle dict empty');
  return chars;
}

async function ensureLoaded(): Promise<void> {
  if (detSession !== null && recSession !== null && dictChars !== null) return;
  if (loadPromise !== null) {
    await loadPromise;
    return;
  }
  loadPromise = (async () => {
    const ort = await ensureOrt();
    const [detBytes, recBytes, chars] = await Promise.all([
      fetchBytes(DET_URL),
      fetchBytes(REC_URL),
      loadDict(),
    ]);
    const opts = { executionProviders: ['wasm'] } as const;
    detSession = await ort.InferenceSession.create(detBytes, {
      executionProviders: [...opts.executionProviders],
    });
    recSession = await ort.InferenceSession.create(recBytes, {
      executionProviders: [...opts.executionProviders],
    });
    recHeight = REC_H;
    dictChars = chars;
  })();
  try {
    await loadPromise;
  } finally {
    loadPromise = null;
  }
}

function canvasFromInput(img: ImageBitmap): HTMLCanvasElement {
  const maybeCanvas = img as unknown;
  if (maybeCanvas instanceof HTMLCanvasElement) return maybeCanvas;
  const c = document.createElement('canvas');
  const bitmap = img as ImageBitmap;
  c.width = Math.max(1, bitmap.width);
  c.height = Math.max(1, bitmap.height);
  const ctx = c.getContext('2d');
  if (ctx === null) throw new Error('canvas 2d unavailable');
  ctx.drawImage(bitmap, 0, 0);
  return c;
}

function readPixels(canvas: HTMLCanvasElement): {
  data: Uint8ClampedArray;
  w: number;
  h: number;
} {
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('canvas 2d unavailable');
  const w = Math.max(1, canvas.width);
  const h = Math.max(1, canvas.height);
  const img = ctx.getImageData(0, 0, w, h);
  return { data: img.data, w, h };
}

function pad32(n: number): number {
  return Math.max(32, Math.ceil(n / 32) * 32);
}

/** RGBA -> normalized NCHW Float32Array, zero-padded to (pw, ph). */
function detInputTensor(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  pw: number,
  ph: number,
): Float32Array {
  const out = new Float32Array(1 * 3 * ph * pw);
  const plane = ph * pw;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const r = (rgba[s] ?? 0) / 255;
      const g = (rgba[s + 1] ?? 0) / 255;
      const b = (rgba[s + 2] ?? 0) / 255;
      const d = y * pw + x;
      out[d] = (r - (NORM_MEAN[0] ?? 0)) / (NORM_STD[0] ?? 1);
      out[plane + d] = (g - (NORM_MEAN[1] ?? 0)) / (NORM_STD[1] ?? 1);
      out[2 * plane + d] = (b - (NORM_MEAN[2] ?? 0)) / (NORM_STD[2] ?? 1);
    }
  }
  return out;
}

/** DB postprocess: threshold + 4-connected components + score + unclip. */
function dbBoxes(prob: Float32Array, w: number, h: number): DetBox[] {
  const labels = new Int32Array(w * h).fill(-1);
  const boxes: DetBox[] = [];
  let compId = 0;
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if ((prob[i] ?? 0) <= DET_THRESH || (labels[i] ?? -1) !== -1) continue;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    let count = 0;
    let sum = 0;
    stack.length = 0;
    stack.push(i);
    labels[i] = compId;
    while (stack.length > 0) {
      const p = stack.pop();
      if (p === undefined) break;
      const px = p % w;
      const py = Math.floor(p / w);
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      count++;
      sum += prob[p] ?? 0;
      // 4-neighbours.
      if (px > 0) {
        const q = p - 1;
        if ((prob[q] ?? 0) > DET_THRESH && (labels[q] ?? -1) === -1) {
          labels[q] = compId;
          stack.push(q);
        }
      }
      if (px + 1 < w) {
        const q = p + 1;
        if ((prob[q] ?? 0) > DET_THRESH && (labels[q] ?? -1) === -1) {
          labels[q] = compId;
          stack.push(q);
        }
      }
      if (py > 0) {
        const q = p - w;
        if ((prob[q] ?? 0) > DET_THRESH && (labels[q] ?? -1) === -1) {
          labels[q] = compId;
          stack.push(q);
        }
      }
      if (py + 1 < h) {
        const q = p + w;
        if ((prob[q] ?? 0) > DET_THRESH && (labels[q] ?? -1) === -1) {
          labels[q] = compId;
          stack.push(q);
        }
      }
    }
    compId++;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    if (bw < MIN_BOX_SIDE || bh < MIN_BOX_SIDE || count === 0) continue;
    const score = sum / count;
    if (score < BOX_THRESH) continue;
    // Standard DB unclip on the bbox approximation.
    const d = (count * UNCLIP_RATIO) / Math.max(1, 2 * (bw + bh));
    const x0 = Math.max(0, minX - d);
    const y0 = Math.max(0, minY - d);
    boxes.push({
      x: x0,
      y: y0,
      w: Math.min(w, maxX + d + 1) - x0,
      h: Math.min(h, maxY + d + 1) - y0,
      score,
    });
  }
  const kept = boxes.filter((b) => b.w >= MIN_BOX_SIDE && b.h >= MIN_BOX_SIDE);
  kept.sort((a, b) => b.w * b.h - a.w * a.h);
  return kept.length > MAX_BOXES ? kept.slice(0, MAX_BOXES) : kept;
}

/** Reading-order sort: row-group by y-centre, top-down rows, L-to-R inside. */
function sortReadingOrder(boxes: DetBox[]): DetBox[] {
  if (boxes.length <= 1) return [...boxes];
  const heights = boxes.map((b) => b.h).sort((a, b) => a - b);
  const medH = heights[Math.floor(heights.length / 2)] ?? 16;
  const tol = Math.max(4, medH * 0.6);
  const byY = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: DetBox[][] = [];
  for (const b of byY) {
    const cy = b.y + b.h / 2;
    let placed = false;
    for (const row of rows) {
      const first = row[0];
      if (first === undefined) continue;
      if (Math.abs(cy - (first.y + first.h / 2)) <= tol) {
        row.push(b);
        placed = true;
        break;
      }
    }
    if (!placed) rows.push([b]);
  }
  const out: DetBox[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    out.push(...row);
  }
  return out;
}

/** Bilinear resize of an RGB float (0..255) patch to (dw, dh). */
function resizeRgbBilinear(
  src: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float32Array {
  const out = new Float32Array(dw * dh * 3);
  const sx = sw / dw;
  const sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const gy = (y + 0.5) * sy - 0.5;
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(gy)));
    const y1 = Math.max(0, Math.min(sh - 1, y0 + 1));
    const fy = Math.max(0, Math.min(1, gy - y0));
    for (let x = 0; x < dw; x++) {
      const gx = (x + 0.5) * sx - 0.5;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(gx)));
      const x1 = Math.max(0, Math.min(sw - 1, x0 + 1));
      const fx = Math.max(0, Math.min(1, gx - x0));
      for (let c = 0; c < 3; c++) {
        const p00 = src[(y0 * sw + x0) * 3 + c] ?? 0;
        const p10 = src[(y0 * sw + x1) * 3 + c] ?? 0;
        const p01 = src[(y1 * sw + x0) * 3 + c] ?? 0;
        const p11 = src[(y1 * sw + x1) * 3 + c] ?? 0;
        out[(y * dw + x) * 3 + c] =
          p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
      }
    }
  }
  return out;
}

/**
 * Crop a box from RGBA pixels, aspect-kept resize to height H (NO width cap —
 * see REC note above), per-box contrast expansion, ImageNet-normalize.
 * Returns the tensor data + width.
 */
function recInputTensor(
  rgba: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  box: DetBox,
  targetH: number,
): { data: Float32Array; width: number } {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(imgW, Math.ceil(box.x + box.w));
  const y1 = Math.min(imgH, Math.ceil(box.y + box.h));
  const sw = Math.max(1, x1 - x0);
  const sh = Math.max(1, y1 - y0);
  const crop = new Float32Array(sw * sh * 3);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const s = ((y0 + y) * imgW + (x0 + x)) * 4;
      const d = (y * sw + x) * 3;
      crop[d] = rgba[s] ?? 0;
      crop[d + 1] = rgba[s + 1] ?? 0;
      crop[d + 2] = rgba[s + 2] ?? 0;
    }
  }
  const rw = Math.max(8, Math.ceil((targetH * sw) / sh));
  // Per-box Otsu-anchored contrast expansion: dim UI grays (#aaa handle, #888
  // timestamp on dark-mode cards) survive the shared pipeline's global
  // stretch as mid-gray (~140-185 on white), which the rec head misreads
  // ('t'->'l', ':'->'1', 'c'->'0'). Otsu finds each box's own text/bg split
  // (bimodal text crops); values are then expanded around it — text side to
  // [0..64], background side to [192..255] — restoring near-black strokes
  // while PRESERVING anti-aliasing gradients (hard 0/255 binarization was
  // measured to notch small 'O' into 'Q'). Same job adaptive thresholding
  // does inside Tesseract. Flat boxes (max-min < 12) skip it.
  let lo = 255;
  let hi = 0;
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < crop.length; i += 3) {
    const r = crop[i] ?? 0;
    const g = crop[i + 1] ?? 0;
    const b = crop[i + 2] ?? 0;
    const lum = Math.max(0, Math.min(255, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)));
    if (lum < lo) lo = lum;
    if (lum > hi) hi = lum;
    const h = hist[lum];
    hist[lum] = (h ?? 0) + 1;
  }
  if (hi - lo >= 12) {
    const total = sw * sh;
    let sumAll = 0;
    for (let i = 0; i < 256; i++) sumAll += i * (hist[i] ?? 0);
    let sumBg = 0;
    let wBg = 0;
    let bestT = 128;
    let bestVar = -1;
    for (let t = 0; t < 256; t++) {
      wBg += hist[t] ?? 0;
      if (wBg === 0) continue;
      const wFg = total - wBg;
      if (wFg === 0) break;
      sumBg += t * (hist[t] ?? 0);
      const mBg = sumBg / wBg;
      const mFg = (sumAll - sumBg) / wFg;
      const between = wBg * wFg * (mBg - mFg) * (mBg - mFg);
      if (between > bestVar) {
        bestVar = between;
        bestT = t;
      }
    }
    const darkSpan = Math.max(1, bestT - lo);
    const lightSpan = Math.max(1, hi - bestT);
    for (let i = 0; i < crop.length; i++) {
      const v = crop[i] ?? 0;
      crop[i] =
        v <= bestT ? (64 * (v - lo)) / darkSpan : 255 - (64 * (hi - v)) / lightSpan;
    }
  }
  const resized = resizeRgbBilinear(crop, sw, sh, rw, targetH);
  const out = new Float32Array(1 * 3 * targetH * rw);
  const plane = targetH * rw;
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < rw; x++) {
      const s = (y * rw + x) * 3;
      const d = y * rw + x;
      out[d] = ((resized[s] ?? 0) / 255 - (NORM_MEAN[0] ?? 0)) / (NORM_STD[0] ?? 1);
      out[plane + d] =
        ((resized[s + 1] ?? 0) / 255 - (NORM_MEAN[1] ?? 0)) / (NORM_STD[1] ?? 1);
      out[2 * plane + d] =
        ((resized[s + 2] ?? 0) / 255 - (NORM_MEAN[2] ?? 0)) / (NORM_STD[2] ?? 1);
    }
  }
  return { data: out, width: rw };
}

/** Greedy CTC decode (blank 0 dropped, repeats collapsed) with mean-char confidence.
 *
 * Class layout follows PaddleOCR training (`use_space_char: true`, blank 0):
 * class c in 1..N maps to dict[c-1]; when the head emits N+2 classes the
 * trailing class (N+1) is the appended SPACE (so multi-word boxes decode with
 * real spaces — e.g. "Oct 3, 2026"). Heads exported without the space slot
 * (N+1 classes) are also accepted.
 */
function ctcDecode(
  logits: Float32Array,
  steps: number,
  classes: number,
  chars: string[],
  spaceClass: number | null,
): {
  text: string;
  confidence: number;
} {
  let text = '';
  let probSum = 0;
  let kept = 0;
  let prev = -1;
  // Some paddle2onnx exports already end in Softmax (per-row sums ~= 1); a
  // second softmax would flatten confidences to noise, so detect and skip it.
  let rowSum = 0;
  if (steps > 0) {
    for (let c = 0; c < classes; c++) rowSum += logits[c] ?? 0;
  }
  const alreadyProbs = steps > 0 && Math.abs(rowSum - 1) < 0.05;
  for (let t = 0; t < steps; t++) {
    const row = t * classes;
    let best = 0;
    let bestV = logits[row] ?? Number.NEGATIVE_INFINITY;
    for (let c = 1; c < classes; c++) {
      const v = logits[row + c] ?? Number.NEGATIVE_INFINITY;
      if (v > bestV) {
        bestV = v;
        best = c;
      }
    }
    let prob: number;
    if (alreadyProbs) {
      prob = Math.max(0, Math.min(1, bestV));
    } else {
      // Softmax max-prob for the winning class (numerically stable).
      let maxV = Number.NEGATIVE_INFINITY;
      for (let c = 0; c < classes; c++) {
        const v = logits[row + c] ?? 0;
        if (v > maxV) maxV = v;
      }
      let denom = 0;
      for (let c = 0; c < classes; c++) denom += Math.exp((logits[row + c] ?? 0) - maxV);
      prob = Math.exp(bestV - maxV) / Math.max(1e-9, denom);
    }
    if (best !== 0 && best !== prev) {
      if (spaceClass !== null && best === spaceClass) {
        text += ' ';
        probSum += prob;
        kept++;
      } else {
        const ch = chars[best - 1];
        if (ch !== undefined) {
          text += ch;
          probSum += prob;
          kept++;
        }
      }
    }
    prev = best;
  }
  return { text, confidence: kept === 0 ? 0 : (probSum / kept) * 100 };
}

export class PaddleOcrEngine implements OcrEngine {
  async warmUp(_lang?: string): Promise<void> {
    await ensureLoaded();
  }

  async recognize(img: ImageBitmap, opts: RecognizeOptions): Promise<RecognizeResult> {
    const started = Date.now();
    const report = opts.onProgress ?? ((): void => undefined);
    await ensureLoaded();
    const ort = await ensureOrt();
    const det = detSession;
    const rec = recSession;
    const chars = dictChars;
    if (det === null || rec === null || chars === null) {
      throw new Error('paddle sessions not loaded');
    }
    const detInputName = det.inputNames[0];
    const detOutputName = det.outputNames[0];
    const recInputName = rec.inputNames[0];
    const recOutputName = rec.outputNames[0];
    if (
      detInputName === undefined ||
      detOutputName === undefined ||
      recInputName === undefined ||
      recOutputName === undefined
    ) {
      throw new Error('paddle session missing input/output names');
    }

    report(0.1, 'load');
    const canvas = canvasFromInput(img);
    const { data, w, h } = readPixels(canvas);
    const pw = pad32(w);
    const ph = pad32(h);

    // --- Detection.
    report(0.25, 'detect');
    const detData = detInputTensor(data, w, h, pw, ph);
    const detTensor = new ort.Tensor('float32', detData, [1, 3, ph, pw]);
    const detOut = await det.run({ [detInputName]: detTensor });
    const detResult = detOut[detOutputName];
    if (detResult === undefined || !(detResult.data instanceof Float32Array)) {
      throw new Error('paddle det output not float32');
    }
    const dims = detResult.dims;
    if (dims.length !== 4 || dims[0] !== 1 || dims[1] !== 1) {
      throw new Error(`unexpected paddle det output dims [${dims.join(',')}]`);
    }
    const dh = dims[2] ?? 0;
    const dw = dims[3] ?? 0;
    if (dh <= 0 || dw <= 0 || detResult.data.length < dw * dh) {
      throw new Error('paddle det output too small');
    }
    // Downsample the prob map back to padded-input size when the model
    // stride differs (mobile DB downsamples 4x: map is (ph/4, pw/4)).
    const prob = new Float32Array(pw * ph);
    if (dw === pw && dh === ph) {
      prob.set(detResult.data.subarray(0, pw * ph));
    } else {
      const sy = dh / ph;
      const sx = dw / pw;
      for (let y = 0; y < ph; y++) {
        for (let x = 0; x < pw; x++) {
          const my = Math.min(dh - 1, Math.floor(y * sy));
          const mx = Math.min(dw - 1, Math.floor(x * sx));
          prob[y * pw + x] = detResult.data[my * dw + mx] ?? 0;
        }
      }
    }
    const boxes = sortReadingOrder(dbBoxes(prob, pw, ph)).map((b) => ({
      x: Math.min(b.x, w - 1),
      y: Math.min(b.y, h - 1),
      w: Math.min(b.w, w - b.x),
      h: Math.min(b.h, h - b.y),
      score: b.score,
    })).filter((b) => b.w >= MIN_BOX_SIDE && b.h >= MIN_BOX_SIDE);
    if (boxes.length === 0) return { lines: [], words: [], ms: Date.now() - started };

    // --- Recognition, one box at a time (batching = future opt; screenshots
    // yield a handful of boxes and per-box runs stay in the low seconds).
    const lines: OcrLine[] = [];
    const words: OcrWord[] = [];
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i] as DetBox;
      report(0.4 + (0.55 * i) / boxes.length, 'recognize');
      const recIn = recInputTensor(data, w, h, box, recHeight);
      const recTensor = new ort.Tensor('float32', recIn.data, [1, 3, recHeight, recIn.width]);
      let recOut: Record<string, Tensor>;
      try {
        recOut = await rec.run({ [recInputName]: recTensor });
      } catch (err) {
        // Height fallback: a future EN rec export could use the v3-era 32px
        // input; retry once at 32px before giving up on the whole image.
        if (recHeight !== REC_FALLBACK_H) {
          recHeight = REC_FALLBACK_H;
          const retryIn = recInputTensor(data, w, h, box, recHeight);
          const retryTensor = new ort.Tensor('float32', retryIn.data, [
            1,
            3,
            recHeight,
            retryIn.width,
          ]);
          recOut = await rec.run({ [recInputName]: retryTensor });
        } else {
          throw err;
        }
      }
      const out = recOut[recOutputName];
      if (out === undefined || !(out.data instanceof Float32Array)) {
        throw new Error('paddle rec output not float32');
      }
      const rd = out.dims;
      if (rd.length !== 3 || rd[0] !== 1) {
        throw new Error(`unexpected paddle rec output dims [${rd.join(',')}]`);
      }
      const steps = rd[1] ?? 0;
      const classes = rd[2] ?? 0;
      // PaddleOCR `use_space_char: true` appends the space AFTER the dict
      // (blank is 0): EN mobile rec ships 438 = 436 dict + space + blank.
      let spaceClass: number | null = null;
      if (classes === chars.length + 2) {
        spaceClass = chars.length + 1;
      } else if (classes !== chars.length + 1) {
        throw new Error(`paddle rec/dict mismatch (classes ${classes}, dict ${chars.length})`);
      }
      const { text, confidence } = ctcDecode(out.data, steps, classes, chars, spaceClass);
      if (text.trim() === '') continue;
      const lineIndex = lines.length;
      const bbox = { x: box.x, y: box.y, w: box.w, h: box.h };
      lines.push({ text, confidence, bbox });
      // Whole-line word fallback (track contract): one word per line.
      words.push({ text, confidence, bbox: { ...bbox }, lineIndex });
    }
    report(1, 'recognize');
    return { lines, words, ms: Date.now() - started };
  }
}

let paddleSingleton: PaddleOcrEngine | null = null;

/** Singleton (sessions + dict load once, then cached — mirrors getEngine). */
export function getPaddleEngine(): PaddleOcrEngine {
  if (paddleSingleton === null) paddleSingleton = new PaddleOcrEngine();
  return paddleSingleton;
}
