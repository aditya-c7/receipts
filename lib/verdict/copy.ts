// Single source of truth for every user-facing verdict string.
// (Banned-words list lives in tests/unit/copy-banned.test.ts — keep it out
// of this file so the guardrail scans only user-facing copy.)
export const VERDICT_COPY: Record<string, { title: (score: number | null) => string; body: string }> = {
  MATCH_STRONG: {
    title: (s) => `Archived original found — ${s == null ? '?' : Math.round(s * 100)}% match.`,
    body: 'A capture of this post says almost exactly what your screenshot says. This shows the text existed then. It can’t confirm everything in the screenshot (replies, counts, images).',
  },
  MATCH_LIKELY: {
    title: (s) => `Likely match — ${s == null ? '?' : Math.round(s * 100)}%. A few words differ.`,
    body: 'Differences can come from reading mistakes or edited posts.',
  },
  MATCH_PARTIAL: {
    title: (s) => `Closest archived post only partly matches (${s == null ? '?' : Math.round(s * 100)}%).`,
    body: 'It may be a different post, an edited post, or a reading error. Compare below.',
  },
  POST_EXISTS_TEXT_UNREADABLE: {
    title: () => 'A post from this account was archived at the time shown.',
    body: 'The timing lines up. We couldn’t read its text — open the capture to compare.',
  },
  NO_MATCH: {
    title: () => 'No archive match found. That does not mean it is not real.',
    body: 'Most posts are never archived, and accounts get renamed or deleted. Here’s what to check next.',
  },
  INSUFFICIENT_INPUT: {
    title: () => 'We couldn’t read enough to search.',
    body: 'Fill in the highlighted fields and we’ll re-check.',
  },
  ARCHIVE_UNAVAILABLE: {
    title: () => 'The Wayback Machine didn’t respond, so we couldn’t check.',
    body: 'This is not a ‘no match’ — try again in a minute.',
  },
  UNSUPPORTED_PLATFORM: {
    title: () => 'We can only check X/Twitter posts right now.',
    body: 'If this is an X post, use the “this is an X post” override.',
  },
};
