// Chrome/UI noise-line filtering for OCR text (Track A). Pure functions.
//
// Quote-card heuristic (nested quoted post content) is deliberately LEFT TO
// THE CALLER: only the caller knows bounding-box geometry (e.g. an indented
// card region below the main body), so this module never tries to detect
// quote cards from text alone.

const REPLYING_RE = /^\s*replying to\s+@/i;
const SHOW_MORE_RE = /^\s*show more(\s*\.\.\.)?\s*$/i;
const TRANSLATE_RE = /^\s*translate\s+(post|tweet)\s*$/i;
const SHOW_THREAD_RE = /^\s*show this thread(\s*\.\.\.)?\s*$/i;
const PROMOTED_RE = /^\s*(promoted|sponsored)\b/i;
const AD_RE = /^\s*ad\s*$/i;
const FROM_PLACE_RE = /^\s*from\s+\S/i;
// "1.2M Views" / "12,345 Views" / bare "Views".
const VIEWS_RE = /^\s*(?:[\d][\d\s,.\-–—·•*]*[kmb]?)?\s*views?\s*$/i;

const ENGAGEMENT_TOKEN =
  '(?:reposts?|quotes?|likes?|retweets?|bookmarks?|replies|views?|posts?|tweets?)';
// A line that consists ONLY of counts + engagement keywords (with common OCR
// separators between metric groups), e.g. "1.2K Reposts 300 Quotes 5K Likes".
const ENGAGEMENT_FULL_RE = new RegExp(
  `^[\\d\\s,._\\-–—·•*|kmb]+(?:${ENGAGEMENT_TOKEN}[\\d\\s,._\\-–—·•*|kmb]*)+$`,
  'i',
);
const ENGAGEMENT_TOKEN_RE = new RegExp(`\\b${ENGAGEMENT_TOKEN}\\b`, 'gi');

/** True for UI chrome rows that must never become post body text. */
export function isNoiseLine(line: string): boolean {
  const t = line.trim();
  if (t === '') return false;
  if (REPLYING_RE.test(t)) return true;
  if (SHOW_MORE_RE.test(t)) return true;
  if (TRANSLATE_RE.test(t)) return true;
  if (SHOW_THREAD_RE.test(t)) return true;
  if (PROMOTED_RE.test(t)) return true;
  if (AD_RE.test(t)) return true;
  if (FROM_PLACE_RE.test(t)) return true;
  if (VIEWS_RE.test(t)) return true;
  if (hasEngagementRow(t)) return true;
  return false;
}

function hasEngagementRow(t: string): boolean {
  if (!/\d/.test(t)) return false;
  if (ENGAGEMENT_FULL_RE.test(t)) return true;
  // Fallback: digit(s) plus at least two engagement keywords, e.g. metric
  // groups glued without clean separators by OCR.
  const hits = t.match(ENGAGEMENT_TOKEN_RE);
  return (hits?.length ?? 0) >= 2;
}

/** Trim, drop empties, and drop UI noise lines. */
export function stripNoise(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t === '' || isNoiseLine(t)) continue;
    out.push(t);
  }
  return out;
}
