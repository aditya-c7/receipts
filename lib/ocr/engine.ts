// In-browser OCR engine wrapper (Track A).
//
// Ground rules (SPEC + AGENTS.md):
// - Screenshot pixels NEVER leave the device. `recognize()` runs fully local
//   via tesseract.js (WASM). Never log image bytes, never upload the bitmap.
// - First-load JS budget (<150kB gz): this module statically imports NOTHING
//   from tesseract.js. The heavy WASM/JS chunk is pulled in via dynamic
//   `import('tesseract.js')` only when OCR actually runs (lazy + cached).
//
// SELF-HOSTING (required: zero-cost, good citizen, works offline):
// - Copy the worker/core glue from node_modules/tesseract.js/dist/*.min.js
//   into public/tesseract/ (e.g. worker.min.js, tesseract-core.wasm.js,
//   tesseract-core.wasm + onnxruntime assets) so no cross-origin fetch happens.
// - Do NOT download *.traineddata(.gz) at runtime from a CDN. Place the
//   language data (e.g. eng.traineddata.gz) at public/tesseract/eng.traineddata.gz
//   (same origin) and pass { langPath: '/tesseract/' } via TesseractEngineOptions.
// - Pass { workerPath: '/tesseract/worker.min.js',
//          corePath: '/tesseract/tesseract-core.wasm.js' } so the worker,
//   core, and language data are all same-origin.

import type { BBox } from '../types';

export interface OcrLine {
  text: string;
  /** 0-100 confidence as reported by the recognizer. */
  confidence: number;
  bbox: BBox;
}

export interface OcrWord {
  text: string;
  /** 0-100 confidence as reported by the recognizer. */
  confidence: number;
  bbox: BBox;
  lineIndex: number;
}

export interface RecognizeOptions {
  lang: string;
  onProgress?: (p: number, stage: string) => void;
}

export interface RecognizeResult {
  lines: OcrLine[];
  words: OcrWord[];
  /** Wall-clock milliseconds spent in recognize(). */
  ms: number;
}

export interface OcrEngine {
  warmUp(lang?: string): Promise<void>;
  recognize(img: ImageBitmap, opts: RecognizeOptions): Promise<RecognizeResult>;
}

export interface TesseractEngineOptions {
  workerPath?: string;
  corePath?: string;
  langPath?: string;
}

// Minimal structural view of the tesseract.js worker surface we use, so this
// module never statically imports 'tesseract.js' (keeps first-load JS small).
interface RawBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface RawWord {
  text: string;
  confidence: number;
  bbox: RawBox;
}
interface RawLine {
  text: string;
  confidence: number;
  bbox: RawBox;
  words?: RawWord[];
}
interface RawPage {
  lines?: RawLine[];
  words?: Array<RawWord & { lineIndex?: number }>;
}
interface MinimalWorker {
  recognize: (image: ImageBitmap) => Promise<{ data: RawPage }>;
  terminate: () => Promise<void>;
}

function toBBox(b: RawBox): BBox {
  const x0 = Number.isFinite(b.x0) ? b.x0 : 0;
  const y0 = Number.isFinite(b.y0) ? b.y0 : 0;
  const x1 = Number.isFinite(b.x1) ? b.x1 : x0;
  const y1 = Number.isFinite(b.y1) ? b.y1 : y0;
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

function clampProgress(p: number | undefined): number {
  if (p === undefined || !Number.isFinite(p)) return 0;
  return Math.min(1, Math.max(0, p));
}

export class TesseractEngine implements OcrEngine {
  private workers = new Map<string, Promise<MinimalWorker>>();
  private progressHandler: ((p: number, stage: string) => void) | null = null;

  constructor(private readonly paths: TesseractEngineOptions = {}) {}

  warmUp(lang = 'eng'): Promise<void> {
    // Fire-and-forget creation is intentionally avoided: return the promise so
    // callers can await readiness. Never touches image bytes.
    return this.getWorker(lang).then(() => undefined);
  }

  async recognize(img: ImageBitmap, opts: RecognizeOptions): Promise<RecognizeResult> {
    const worker = await this.getWorker(opts.lang);
    this.progressHandler = opts.onProgress ?? null;
    const started = Date.now();
    try {
      const { data } = await worker.recognize(img);
      const lines: OcrLine[] = [];
      const words: OcrWord[] = [];
      const rawLines = data.lines ?? [];
      for (let i = 0; i < rawLines.length; i++) {
        const raw = rawLines[i];
        if (raw === undefined) continue;
        lines.push({ text: raw.text, confidence: raw.confidence, bbox: toBBox(raw.bbox) });
        const rawWords = raw.words ?? [];
        for (const w of rawWords) {
          words.push({ text: w.text, confidence: w.confidence, bbox: toBBox(w.bbox), lineIndex: i });
        }
      }
      // Fallback: some builds only populate page.words.
      if (lines.length === 0) {
        for (const w of data.words ?? []) {
          words.push({ text: w.text, confidence: w.confidence, bbox: toBBox(w.bbox), lineIndex: w.lineIndex ?? -1 });
        }
      }
      return { lines, words, ms: Date.now() - started };
    } finally {
      this.progressHandler = null;
    }
  }

  /** Terminate cached workers (e.g. on page teardown). */
  async terminate(): Promise<void> {
    const pending = [...this.workers.values()];
    this.workers.clear();
    for (const p of pending) {
      const w = await p;
      await w.terminate();
    }
  }

  private getWorker(lang: string): Promise<MinimalWorker> {
    const key = lang.trim() === '' ? 'eng' : lang;
    const cached = this.workers.get(key);
    if (cached !== undefined) return cached;
    const created = this.createWorker(key);
    this.workers.set(key, created);
    return created;
  }

  private async createWorker(lang: string): Promise<MinimalWorker> {
    // Dynamic import: tesseract.js chunk loads lazily, only on OCR use.
    const { createWorker } = await import('tesseract.js');
    const options: Record<string, unknown> = {
      logger: (m: { status: string; progress?: number }) => {
        const handler = this.progressHandler;
        if (handler === null) return;
        const stage = m.status === 'recognizing text' ? 'recognize' : m.status;
        handler(clampProgress(m.progress), stage);
      },
    };
    if (this.paths.workerPath !== undefined) options['workerPath'] = this.paths.workerPath;
    if (this.paths.corePath !== undefined) options['corePath'] = this.paths.corePath;
    if (this.paths.langPath !== undefined) options['langPath'] = this.paths.langPath;
    // createWorker's own option types are intentionally not imported here so
    // this module stays free of static tesseract.js type references.
    const worker = await createWorker(lang, undefined, {
      logger: options['logger'] as (m: { status: string; progress: number }) => void,
      ...(typeof options['workerPath'] === 'string' ? { workerPath: options['workerPath'] } : {}),
      ...(typeof options['corePath'] === 'string' ? { corePath: options['corePath'] } : {}),
      ...(typeof options['langPath'] === 'string' ? { langPath: options['langPath'] } : {}),
    });
    return worker as unknown as MinimalWorker;
  }
}
