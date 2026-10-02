// Verdict engine: first-match decision order. Returns code+score+checks only.
import { SCORE_STRONG, SCORE_LIKELY, SCORE_PARTIAL } from '../config';
import type { ArchivedPost, Candidate, Platform, Verdict } from '../types';

export interface DecideBest {
  score: number;
  textSim?: number | null;
  timeConsistent: boolean | null;
  extractable: boolean;
  candidate?: Candidate;
  archived?: ArchivedPost;
}

export interface DecideInput {
  platform: Platform;
  handleOk: boolean | null;
  dateOk: boolean | null;
  hasDates: boolean;
  best: DecideBest | null;
  alternates: Array<{ candidate: Candidate; textSim: number }>;
  coverage: Verdict['coverage'];
  archiveError: boolean;
  diff?: Verdict['diff'];
}

/** First-match order per spec § verdict. */
export function decide(input: DecideInput): Verdict {
  const { platform, handleOk, dateOk, best, alternates, coverage, archiveError, hasDates } = input;

  const mkChecks = (textSim: number | null, timeConsistent: boolean | null): Verdict['checks'] => ({
    handle: handleOk,
    date: dateOk,
    timeConsistent,
    textSim,
  });

  if (platform === 'unknown') {
    return {
      code: 'UNSUPPORTED_PLATFORM',
      score: null,
      checks: mkChecks(null, best?.timeConsistent ?? null),
      alternates,
      coverage,
    };
  }
  if (handleOk === null || !hasDates) {
    return {
      code: 'INSUFFICIENT_INPUT',
      score: null,
      checks: mkChecks(null, best?.timeConsistent ?? null),
      alternates,
      coverage,
    };
  }
  if (archiveError) {
    return {
      code: 'ARCHIVE_UNAVAILABLE',
      score: best?.score ?? null,
      checks: mkChecks(best?.textSim ?? best?.score ?? null, best?.timeConsistent ?? null),
      ...(best?.candidate && best?.archived ? { best: { candidate: best.candidate, archived: best.archived } } : {}),
      alternates,
      coverage,
    };
  }

  const score = best?.score ?? null;
  const textSim = best?.textSim ?? best?.score ?? null;
  const timeConsistent = best?.timeConsistent ?? null;
  const withBest =
    best?.candidate && best?.archived ? { best: { candidate: best.candidate, archived: best.archived } } : {};
  const diff = input.diff ? { diff: input.diff } : {};

  if (best && score != null && score >= SCORE_STRONG) {
    return { code: 'MATCH_STRONG', score, checks: mkChecks(textSim, timeConsistent), ...withBest, alternates, coverage, ...diff };
  }
  if (best && score != null && score >= SCORE_LIKELY) {
    return { code: 'MATCH_LIKELY', score, checks: mkChecks(textSim, timeConsistent), ...withBest, alternates, coverage, ...diff };
  }
  if (best && score != null && score >= SCORE_PARTIAL) {
    return { code: 'MATCH_PARTIAL', score, checks: mkChecks(textSim, timeConsistent), ...withBest, alternates, coverage, ...diff };
  }
  if (best && timeConsistent === true && !best.extractable) {
    return { code: 'POST_EXISTS_TEXT_UNREADABLE', score, checks: mkChecks(textSim, timeConsistent), ...withBest, alternates, coverage, ...diff };
  }
  return { code: 'NO_MATCH', score, checks: mkChecks(textSim, timeConsistent), ...withBest, alternates, coverage, ...diff };
}
