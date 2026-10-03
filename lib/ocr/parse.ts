// OCR lines -> ParsedScreenshot fields (Track A). Pure function.
//
// Layout assumption (X screenshot, top to bottom):
//   displayName / @handle (header) ... body ... timestamp ... engagement.
// - platform: 'x' when an @handle exists AND any line carries an X signal
//   word (Views/Reposts/Quotes/Retweets/Likes/Bookmarks/Post/Tweet/
//   Replying to/Show this thread), else 'unknown'.
// - handle: first /[@©Q€]\s?([A-Za-z0-9_]{1,15})/ match (©/Q/€ cover common
//   @ misreads), lowercased, X-rules validated.
// - displayName: line above the handle, else first line.
// - text: lines between header and timestamp line, noise-stripped, merged
//   (hyphen-wrap join + whitespace collapse).
// - dates: parseDateCandidates() on the nearest-bottom line that yields any.

import type { BBox, DateCandidate, Field, ParsedScreenshot } from '../types';
import { parseDateCandidates } from './dates';
import { isNoiseLine } from './noiseLines';

export interface OcrInputLine {
  text: string;
  bbox: BBox;
  confidence: number;
}

export type ScreenshotParse = Omit<ParsedScreenshot, 'ocrMs' | 'fieldsEdited' | 'language'> & {
  language: 'eng';
};

const HANDLE_RE = /[@©Q€]\s?([A-Za-z0-9_]{1,15})/;
const HANDLE_GLOBAL_RE = new RegExp(HANDLE_RE.source, 'g');
const HANDLE_VALID_RE = /^[A-Za-z0-9_]{1,15}$/;
const PLATFORM_SIGNALS = [
  'views',
  'reposts',
  'quotes',
  'retweets',
  'likes',
  'bookmarks',
  'post',
  'tweet',
  'replying to',
  'show this thread',
];

interface FoundHandle {
  value: string;
  lineIndex: number;
  matchIndex: number;
  confidence: number;
  bbox: BBox;
}

interface ScoredHandle extends FoundHandle {
  wholeLine: boolean;
}

/**
 * Scored handle selection (not first-match-wins). Avatar/logo OCR garbage
 * (e.g. a "©"/"Q" misread yielding "@qe"-style 1–3 char tokens on an early
 * line) must not beat the real @handle line. Rules:
 * - scan EVERY match on EVERY line (a line can hold several @-mentions);
 * - skip mid-word matches ("foo@bar.com", "a@b" inside a word) and matches
 *   glued to a domain suffix (".com") — those are emails/URLs, not handles;
 * - prefer whole-line "@handle" lines (X renders the handle alone);
 * - then longer handles (garbage tokens are short);
 * - then earlier lines / earlier matches.
 */
function findHandle(lines: OcrInputLine[]): FoundHandle | null {
  const cands: ScoredHandle[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const text = line.text;
    HANDLE_GLOBAL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HANDLE_GLOBAL_RE.exec(text)) !== null) {
      const cap = m[1];
      if (cap === undefined) continue;
      const before = text.slice(0, m.index);
      const after = text.slice(m.index + m[0].length);
      // Mid-word: the char before the @-sigil is a word char → email/word.
      if (/[A-Za-z0-9_.]$/.test(before)) continue;
      // Domain suffix: "@name.com" → email/URL, not a handle.
      if (/^\.[A-Za-z]/.test(after)) continue;
      const lower = cap.toLowerCase();
      if (!HANDLE_VALID_RE.test(lower)) continue;
      cands.push({
        value: lower,
        lineIndex: i,
        matchIndex: m.index,
        confidence: line.confidence,
        bbox: line.bbox,
        wholeLine: before.trim() === '' && after.trim() === '',
      });
    }
  }
  if (cands.length === 0) return null;
  cands.sort((a, b) => {
    if (a.wholeLine !== b.wholeLine) return a.wholeLine ? -1 : 1;
    if (a.value.length !== b.value.length) return b.value.length - a.value.length;
    if (a.lineIndex !== b.lineIndex) return a.lineIndex - b.lineIndex;
    return a.matchIndex - b.matchIndex;
  });
  const best = cands[0] as ScoredHandle;
  return { value: best.value, lineIndex: best.lineIndex, matchIndex: best.matchIndex, confidence: best.confidence, bbox: best.bbox };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function unionBboxes(boxes: BBox[]): BBox | undefined {
  let acc: BBox | undefined = undefined;
  for (const b of boxes) {
    if (acc === undefined) {
      acc = { x: b.x, y: b.y, w: b.w, h: b.h };
      continue;
    }
    const x0 = Math.min(acc.x, b.x);
    const y0 = Math.min(acc.y, b.y);
    const x1 = Math.max(acc.x + acc.w, b.x + b.w);
    const y1 = Math.max(acc.y + acc.h, b.y + b.h);
    acc = { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  }
  return acc;
}

/** Hyphen-wrap join + whitespace collapse. */
function mergeBody(parts: string[]): string {
  let out = '';
  for (const part of parts) {
    const t = part.trim().replace(/\s+/g, ' ');
    if (t === '') continue;
    if (out === '') {
      out = t;
      continue;
    }
    out = out.endsWith('-') ? out.slice(0, -1) + t : `${out} ${t}`;
  }
  return out;
}

export function parseScreenshot(lines: OcrInputLine[], opts?: { now?: Date }): ScreenshotParse {
  const found = findHandle(lines);

  const lowerAll = lines.map((l) => l.text.toLowerCase());
  const hasSignal = lowerAll.some((t) => PLATFORM_SIGNALS.some((s) => t.includes(s)));
  const platform = found !== null && hasSignal ? 'x' : 'unknown';

  // Display name: line above handle, else same-line prefix, else first line.
  let dnValue: string | null = null;
  let dnConf = 0;
  let dnBox: BBox | undefined = undefined;
  let dnIndex = -1;
  if (found !== null) {
    if (found.lineIndex > 0) {
      const above = lines[found.lineIndex - 1];
      const t = above?.text.trim() ?? '';
      if (t !== '' && above !== undefined) {
        dnValue = t;
        dnConf = above.confidence;
        dnBox = above.bbox;
        dnIndex = found.lineIndex - 1;
      }
    } else {
      const first = lines[0];
      const prefix = (first?.text.slice(0, found.matchIndex) ?? '').trim();
      if (prefix !== '' && first !== undefined) {
        dnValue = prefix;
        dnConf = first.confidence;
        dnBox = first.bbox;
        dnIndex = 0;
      }
    }
  } else {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      if (line.text.trim() !== '') {
        dnValue = line.text.trim();
        dnConf = line.confidence;
        dnBox = line.bbox;
        dnIndex = i;
        break;
      }
    }
  }

  // Timestamp: nearest-bottom line yielding date candidates.
  let tsIndex = -1;
  let dateCands: DateCandidate[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined) continue;
    const t = line.text.trim();
    if (t === '') continue;
    const c = parseDateCandidates(t, opts?.now);
    if (c.length > 0) {
      tsIndex = i;
      dateCands = c;
      break;
    }
  }

  // Body: between header and timestamp, noise-stripped.
  const headerEnd = found !== null ? found.lineIndex : dnIndex;
  const end = tsIndex >= 0 ? tsIndex : lines.length;
  const bodyLines: OcrInputLine[] = [];
  const bodyTexts: string[] = [];
  for (let i = headerEnd + 1; i < end; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const t = line.text.trim();
    if (t === '' || isNoiseLine(t)) continue;
    bodyLines.push(line);
    bodyTexts.push(t);
  }
  const body = mergeBody(bodyTexts);

  const displayName: Field<string> =
    dnBox === undefined
      ? { value: dnValue, confidence: dnConf, source: 'ocr' }
      : { value: dnValue, confidence: dnConf, bbox: dnBox, source: 'ocr' };
  const handle: Field<string> =
    found === null
      ? { value: null, confidence: 0, source: 'ocr' }
      : { value: found.value, confidence: found.confidence, bbox: found.bbox, source: 'ocr' };
  const bodyBox = unionBboxes(bodyLines.map((l) => l.bbox));
  const text: Field<string> =
    body === '' || bodyBox === undefined
      ? { value: body === '' ? null : body, confidence: body === '' ? 0 : mean(bodyLines.map((l) => l.confidence)), source: 'ocr' }
      : { value: body, confidence: mean(bodyLines.map((l) => l.confidence)), bbox: bodyBox, source: 'ocr' };
  const tsLine = tsIndex >= 0 ? lines[tsIndex] : undefined;
  const dates: Field<DateCandidate[]> =
    tsLine === undefined
      ? { value: [], confidence: 0, source: 'ocr' }
      : { value: dateCands, confidence: tsLine.confidence, bbox: tsLine.bbox, source: 'ocr' };

  return { platform, displayName, handle, text, dates, language: 'eng' };
}
