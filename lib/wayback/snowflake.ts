// Snowflake <-> time conversion (X/Twitter).
// TWITTER_EPOCH = 1288834974657 (2010-11-04T01:42:54.657Z).
//
// NOTE (pre-2010 non-snowflake fallback): tweet IDs below ~2^22 (e.g. "20")
// predate Snowflake (first tweets 2006-2010 used sequential IDs, not
// timestamp-embedded). idToMs() maps them to ~TWITTER_EPOCH, which is wrong
// as a wall time — callers must treat ids < 2^22 (or ms <= epoch) as
// "pre-snowflake, time unknown" and fall back to date-only matching.

export const TWITTER_EPOCH = 1288834974657n;

const SEQ_BITS = 22n;
const SEQ_MASK = (1n << SEQ_BITS) - 1n;

function parseId(id: string): bigint {
  const trimmed = id.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`invalid tweet id: ${id}`);
  }
  // Strip leading zeros but keep at least one digit.
  const norm = trimmed.replace(/^0+(?=\d)/, '');
  return BigInt(norm);
}

/** Snowflake id -> creation time ms since unix epoch. */
export function idToMs(id: string): number {
  const big = parseId(id);
  const ms = (big >> SEQ_BITS) + TWITTER_EPOCH;
  return Number(ms);
}

/** Smallest snowflake id that could have been created during millisecond `ms`. */
export function msToMinId(ms: number): bigint {
  const m = BigInt(Math.floor(ms));
  if (m <= TWITTER_EPOCH) return 0n;
  return (m - TWITTER_EPOCH) << SEQ_BITS;
}

/** Largest snowflake id that could have been created during millisecond `ms`. */
export function msToMaxId(ms: number): bigint {
  const m = BigInt(Math.floor(ms));
  if (m <= TWITTER_EPOCH) return SEQ_MASK;
  return ((m - TWITTER_EPOCH + 1n) << SEQ_BITS) - 1n;
}
