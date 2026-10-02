// Time-consistency: does the screenshot's claimed local date/time plausibly
// match the tweet's UTC creation time in *some* real timezone?
//
// VALID_TZ_OFFSETS_MIN covers every 15-minute offset from -720 (-12:00) to
// +840 (+14:00), which includes all real IANA zones incl. odd ones like
// +5:30 (330), +5:45 (345), +8:45 (525), +9:30 (570), +12:45 (765), +13:00...

const OFFSETS: number[] = [];
for (let m = -720; m <= 840; m += 15) OFFSETS.push(m);

/** All valid tz offsets in minutes (-720..840 step 15). */
export const VALID_TZ_OFFSETS_MIN: readonly number[] = OFFSETS;

function dayStringOfUtcMs(utcMs: number, offsetMin: number): string {
  const local = new Date(utcMs + offsetMin * 60000);
  return local.toISOString().slice(0, 10);
}

/**
 * Implied offset in minutes: shot wall time (date+minute as if UTC) minus
 * tweet UTC time, rounded to the nearest minute.
 */
export function impliedOffset(shotDateIso: string, shotMinute: number, idTimeMs: number): number {
  const wallMs = Date.parse(`${shotDateIso}T00:00:00Z`) + shotMinute * 60000;
  return Math.round((wallMs - idTimeMs) / 60000);
}

/** Alias kept for compatibility. */
export const impliedOffsetMinutes = impliedOffset;

function nearestValidDistance(impliedMin: number): number {
  let best = Infinity;
  for (const o of VALID_TZ_OFFSETS_MIN) {
    const d = Math.abs(impliedMin - o);
    if (d < best) best = d;
  }
  return best;
}

/**
 * True when shot date+time is consistent with idTimeMs in some valid
 * timezone; false when inconsistent; null when there is no claimed time to
 * check (missing/invalid date, missing minute, or non-finite id time).
 *
 * With minute: true if implied offset is within 2 min of a valid offset
 * (covers second-truncation in screenshots). The implied-offset check covers
 * both date and time, since wallMs encodes the date.
 */
export function checkTimeConsistent(
  shotDateIso: string,
  shotMinute: number | undefined,
  idTimeMs: number,
): boolean | null {
  if (!shotDateIso) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shotDateIso)) return null;
  if (!Number.isFinite(idTimeMs)) return null;
  if (shotMinute === undefined) return null;
  if (!Number.isFinite(shotMinute) || shotMinute < 0 || shotMinute > 1439) return null;
  const implied = impliedOffset(shotDateIso, shotMinute, idTimeMs);
  return nearestValidDistance(implied) <= 2;
}

/** Date-only consistency (ignores minute): true if idTime falls on shotDate in any valid tz. */
export function checkDateConsistent(shotDateIso: string, idTimeMs: number): boolean | null {
  if (!shotDateIso) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shotDateIso)) return null;
  if (!Number.isFinite(idTimeMs)) return null;
  for (const o of VALID_TZ_OFFSETS_MIN) {
    if (dayStringOfUtcMs(idTimeMs, o) === shotDateIso) return true;
  }
  return false;
}

/** Sort candidates: consistent first, unknown middle, inconsistent last (stable). */
export function rankByTimeConsistency<T extends { idTimeMs: number }>(
  cands: T[],
  shotDateIso: string,
  shotMinute?: number,
): T[] {
  const scored = cands.map((c, i) => {
    let v: boolean | null = null;
    try {
      if (shotMinute === undefined) {
        v = checkDateConsistent(shotDateIso, c.idTimeMs);
        // No date to check -> unknown (preserve order).
        if (!shotDateIso) v = null;
      } else {
        v = checkTimeConsistent(shotDateIso, shotMinute, c.idTimeMs);
      }
    } catch {
      v = null;
    }
    const rank = v === true ? 0 : v === null ? 1 : 2;
    return { c, i, rank };
  });
  scored.sort((a, b) => (a.rank === b.rank ? a.i - b.i : a.rank - b.rank));
  return scored.map((s) => s.c);
}
