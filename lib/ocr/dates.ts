// Timestamp-line -> DateCandidate[] (Track A). No tz shifts: isoDate is the
// calendar date AS DISPLAYED in the screenshot, built by zero-padding the
// parsed fields (never via Date.toISOString, which would shift timezones).

import * as chrono from 'chrono-node';
import type { DateCandidate } from '../types';

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONTH_SRC =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?' +
  '|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const ORD = '(?:st|nd|rd|th)?';
const COLON = '[:\\uFF1A;]';
// Separators OCR garbles between time and date (· • * |) are normalized away;
// time and date are located independently so any separator works.

// Note: (?<!\d)/(?!\d) guards keep us from matching digit runs inside longer numbers.
const TIME12_RE = new RegExp(`(?<!\\d)(\\d{1,2})\\s*${COLON}\\s*(\\d{2})(?!\\d)\\s*([APap])\\s*\\.?\\s*[Mm]\\s*\\.?`);
const TIME24_RE = new RegExp(`(?<!\\d)(\\d{1,2})\\s*${COLON}\\s*(\\d{2})(?!\\d)`);
const MDY_RE = new RegExp(`(${MONTH_SRC})\\b\\s+(\\d{1,2})(?!\\d)${ORD}\\s*(?:[,.;*·•\\-\\u2013\\u2014]\\s*)?(\\d{2,4})(?!\\d)`, 'i');
const DMY_RE = new RegExp(`(?<!\\d)(\\d{1,2})${ORD}\\s+(${MONTH_SRC})\\b\\s*,?\\s*(\\d{2,4})(?!\\d)`, 'i');
const YMD_RE = /(?<!\d)(\d{4})(?!\d)\s*[/.-]\s*(\d{1,2})(?!\d)\s*[/.-]\s*(\d{1,2})(?!\d)/;
const SLASH_RE = /(?<!\d)(\d{1,2})(?!\d)\s*[/.-]\s*(\d{1,2})(?!\d)\s*[/.-]\s*(\d{2,4})(?!\d)/;
const MD_NOYEAR_RE = new RegExp(
  `(${MONTH_SRC})\\b\\s+(\\d{1,2})${ORD}\\b(?!\\s*[,.;*·•\\-\\u2013\\u2014]?\\s*\\d)`,
  'i',
);
const DM_NOYEAR_RE = new RegExp(`(?<!\\d)(\\d{1,2})${ORD}\\s+(${MONTH_SRC})\\b(?!\\s*,?\\s*\\d)`, 'i');
// Relative timestamps ("3h", "2d", "15m", "4 hours ago") carry no date.
const RELATIVE_RE =
  /^\s*\d+\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)\b\s*(ago)?\s*$/i;

function toInt(s: string | undefined): number | null {
  if (s === undefined || !/^\d+$/.test(s)) return null;
  return Number.parseInt(s, 10);
}

function fullYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

function daysInMonth(y: number, mo: number): number {
  return new Date(y, mo, 0).getDate();
}

function isoDate(y: number, mo: number, d: number): string {
  return (
    `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  );
}

function mkCandidate(
  iso: string,
  minute: number | null,
  raw: string,
  extra?: { yearInferred?: boolean; dayMonthAmbiguous?: boolean },
): DateCandidate {
  const c: DateCandidate = { isoDate: iso, raw };
  if (minute !== null) c.localMinuteOfDay = minute;
  if (extra?.yearInferred === true) c.yearInferred = true;
  if (extra?.dayMonthAmbiguous === true) c.dayMonthAmbiguous = true;
  return c;
}

/** Minutes since midnight, preferring 12h+meridiem over bare 24h. */
function findTime(text: string): number | null {
  const m12 = TIME12_RE.exec(text);
  if (m12 !== null) {
    const h = toInt(m12[1]);
    const mm = toInt(m12[2]);
    const ap = (m12[3] ?? '').toLowerCase();
    if (h !== null && mm !== null && h >= 1 && h <= 12 && mm <= 59) {
      return ((h % 12) + (ap === 'p' ? 12 : 0)) * 60 + mm;
    }
  }
  const m24 = TIME24_RE.exec(text);
  if (m24 !== null) {
    const h = toInt(m24[1]);
    const mm = toInt(m24[2]);
    if (h !== null && mm !== null && h <= 23 && mm <= 59) return h * 60 + mm;
  }
  return null;
}

/**
 * Parse date candidates from one timestamp line. Supports month-name dates
 * ("Dec 5, 2024", "5 Dec 2024"), numeric ("5/12/24", "2024-12-05"), 12h/24h
 * times, and garbled separators (· • . - *). No-year dates yield current +
 * previous year with yearInferred. Ambiguous numerics yield both readings
 * with dayMonthAmbiguous. Relative-only lines ("3h") yield []. chrono-node
 * is a last resort when every regex misses.
 */
export function parseDateCandidates(raw: string, now?: Date): DateCandidate[] {
  const ref = now ?? new Date();
  if (raw.trim() === '') return [];
  const text = raw.replace(/[·•*|]/g, ' ').replace(/[–—]/g, '-');
  const minute = findTime(text);
  // Set when any date-shaped pattern matches, even an invalid one (e.g.
  // "32/01/24"): the line already shows its date intent, so the chrono
  // fallback must not hallucinate a different date from digit fragments.
  let sawDateLike = false;

  // "h:mm AM/PM · Mon D, YYYY" style.
  const mdy = MDY_RE.exec(text);
  if (mdy !== null) {
    sawDateLike = true;
    const mo = MONTH_MAP[(mdy[1] ?? '').toLowerCase()];
    const d = toInt(mdy[2]);
    const yRaw = toInt(mdy[3]);
    if (mo !== undefined && d !== null && yRaw !== null) {
      const y = fullYear(yRaw);
      if (d >= 1 && d <= daysInMonth(y, mo)) {
        return [mkCandidate(isoDate(y, mo, d), minute, raw)];
      }
    }
  }

  // "h:mm AM/PM - D Mon YYYY" style.
  const dmy = DMY_RE.exec(text);
  if (dmy !== null) {
    sawDateLike = true;
    const d = toInt(dmy[1]);
    const mo = MONTH_MAP[(dmy[2] ?? '').toLowerCase()];
    const yRaw = toInt(dmy[3]);
    if (d !== null && mo !== undefined && yRaw !== null) {
      const y = fullYear(yRaw);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo)) {
        return [mkCandidate(isoDate(y, mo, d), minute, raw)];
      }
    }
  }

  // "YYYY-MM-DD" (before SLASH: "24-12-05" would otherwise match inside it).
  const ymd = YMD_RE.exec(text);
  if (ymd !== null) {
    sawDateLike = true;
    const y = toInt(ymd[1]);
    const mo = toInt(ymd[2]);
    const d = toInt(ymd[3]);
    if (y !== null && mo !== null && d !== null && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo)) {
      return [mkCandidate(isoDate(y, mo, d), minute, raw)];
    }
  }

  // "D/M/YY" ~ "M/D/YY": ambiguous unless one reading is invalid.
  const sl = SLASH_RE.exec(text);
  if (sl !== null) {
    sawDateLike = true;
    const a = toInt(sl[1]);
    const b = toInt(sl[2]);
    const yRaw = toInt(sl[3]);
    if (a !== null && b !== null && yRaw !== null) {
      const y = fullYear(yRaw);
      const out: DateCandidate[] = [];
      const seen = new Set<string>();
      const pushDM = (d: number, mo: number): void => {
        if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return;
        const iso = isoDate(y, mo, d);
        if (seen.has(iso)) return;
        seen.add(iso);
        out.push(mkCandidate(iso, minute, raw));
      };
      pushDM(a, b);
      pushDM(b, a);
      if (out.length === 2) {
        for (const c of out) c.dayMonthAmbiguous = true;
      }
      if (out.length > 0) return out;
    }
  }

  // No year: current + previous year (Feb 29 skips non-leap years).
  const mdny = MD_NOYEAR_RE.exec(text);
  const dmny = mdny === null ? DM_NOYEAR_RE.exec(text) : null;
  if (mdny !== null || dmny !== null) sawDateLike = true;
  const noYearMo =
    mdny !== null ? MONTH_MAP[(mdny[1] ?? '').toLowerCase()] : dmny !== null ? MONTH_MAP[(dmny[2] ?? '').toLowerCase()] : undefined;
  const noYearDay = mdny !== null ? toInt(mdny[2]) : dmny !== null ? toInt(dmny[1]) : null;
  if (noYearMo !== undefined && noYearDay !== null) {
    const cur = ref.getFullYear();
    const out: DateCandidate[] = [];
    for (const y of [cur, cur - 1]) {
      if (noYearDay >= 1 && noYearDay <= daysInMonth(y, noYearMo)) {
        out.push(mkCandidate(isoDate(y, noYearMo, noYearDay), minute, raw, { yearInferred: true }));
      }
    }
    if (out.length > 0) return out;
  }

  // Relative-only lines carry no date; never let chrono resolve them.
  if (RELATIVE_RE.test(raw)) return [];

  // A date-shaped but invalid match means "invalid date", not "ask chrono".
  if (sawDateLike) return [];

  // chrono-node fallback (regex missed: ordinals, odd punctuation, ...).
  try {
    const results = chrono.parse(raw, ref);
    const first = results[0];
    if (first === undefined) return [];
    const s = first.start;
    // Time-only lines ("10:30 PM") must not resolve to "today": require at
    // least one calendar component to be explicit in the text.
    if (!s.isCertain('year') && !s.isCertain('month') && !s.isCertain('day')) return [];
    const y = s.get('year');
    const mo = s.get('month');
    const d = s.get('day');
    if (y === null || mo === null || d === null) return [];
    let hm: number | null = null;
    if (s.isCertain('hour')) {
      const h = s.get('hour') ?? 0;
      const mi = s.get('minute') ?? 0;
      if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) hm = h * 60 + mi;
    }
    if (!s.isCertain('year')) {
      const cur = ref.getFullYear();
      const out: DateCandidate[] = [];
      for (const yy of [cur, cur - 1]) {
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(yy, mo)) {
          out.push(mkCandidate(isoDate(yy, mo, d), hm, raw, { yearInferred: true }));
        }
      }
      return out;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return [];
    return [mkCandidate(isoDate(y, mo, d), hm, raw)];
  } catch {
    return [];
  }
}
