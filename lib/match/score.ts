// Pair scoring with context gates.
import { textSimilarity } from './similarity';

export interface ScoreOpts {
  handleOK: boolean | null;
  dateOK: boolean | null;
  timeConsistent: boolean | null;
}

export interface ScoreResult {
  score: number;
  textSim: number;
  cappedBy: string | null;
}

/**
 * Gates: score=textSim when handleOK && dateOK, else min(textSim, 0.60);
 * timeConsistent===false caps at 0.74. Number/short caps live inside textSim.
 */
export function scorePair(
  claimed: string,
  archived: string | null | undefined,
  opts: ScoreOpts,
): ScoreResult {
  if (archived == null || archived.trim() === '') {
    return { score: 0, textSim: 0, cappedBy: 'unreadable' };
  }
  const sim = textSimilarity(claimed, archived);
  const textSim = sim.score;
  let score = textSim;
  let cappedBy: string | null = sim.detail.cappedBy;

  if (opts.handleOK !== true || opts.dateOK !== true) {
    if (score > 0.6) {
      score = 0.6;
      cappedBy = cappedBy ? `${cappedBy}+context` : 'context';
    } else if (cappedBy == null) {
      // Already below cap; still record context as limiting when mismatch.
      cappedBy = null;
    }
    // Ensure a context cap is recorded when gates fail and textSim was high.
    if (textSim > 0.6 && cappedBy == null) cappedBy = 'context';
  }
  if (opts.timeConsistent === false && score > 0.74) {
    score = 0.74;
    cappedBy = cappedBy ? `${cappedBy}+time` : 'time';
  }
  return { score, textSim, cappedBy };
}
