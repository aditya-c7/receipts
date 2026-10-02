// Client orchestrator: search -> rank -> verify top N -> verdict.
import {
  EARLY_EXIT_SCORE,
  MAX_SNAPSHOTS_PER_CHECK,
  VERIFY_CONCURRENCY,
  VERIFY_TIME_BUDGET_MS,
} from './config';
import type { ArchivedPost, Candidate, ParsedScreenshot, Verdict } from './types';
import { decide } from './verdict/engine';
import { checkTimeConsistent, checkDateConsistent, rankByTimeConsistency } from './wayback/timeConsistency';
import { scorePair } from './match/score';
import { wordDiff } from './match/diff';

export type CheckPhase = 'reading' | 'searching' | 'comparing' | 'done';

export interface CheckProgress {
  phase: CheckPhase;
  compared?: number;
  total?: number;
}

export interface SearchWindow {
  fromMs: number;
  toMs: number;
}

export type SearchFn = (
  handle: string,
  window: SearchWindow,
) => Promise<Candidate[] | { candidates: Candidate[] }>;

export type SnapshotFn = (snapshotTs: string, originalUrl: string) => Promise<ArchivedPost>;

export interface CheckDeps {
  search: SearchFn;
  snapshot: SnapshotFn;
  onProgress?: (ev: CheckProgress) => void;
  signal?: AbortSignal;
}

function windowFromIsoDate(iso: string): { fromMs: number; toMs: number } {
  const midnight = Date.parse(`${iso}T00:00:00Z`);
  // Cover all valid tz offsets: UTC = local - offset, offset in [-720, +840].
  return { fromMs: midnight - 840 * 60000, toMs: midnight + 86400000 + 720 * 60000 };
}

function handleFromUrl(url: string): string | null {
  const m = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([^/]+)\/status\/\d+/i.exec(url);
  return m?.[1] ? (m[1] as string) : null;
}

function normalizeCandidates(input: Candidate[] | { candidates: Candidate[] }): Candidate[] {
  return Array.isArray(input) ? input : input.candidates;
}

/** Run the full client-side check. Never throws for archive outages (verdict instead). */
export async function runCheck(parsed: ParsedScreenshot, deps: CheckDeps): Promise<Verdict> {
  const { signal } = deps;
  const emit = (ev: CheckProgress): void => {
    try {
      deps.onProgress?.(ev);
    } catch {
      // ignore progress errors
    }
  };
  emit({ phase: 'reading' });

  const claimedHandle = parsed.handle.value;
  const claimedText = parsed.text.value ?? '';
  const dates = parsed.dates.value ?? [];
  const hasDates = dates.length > 0;
  const primary = dates[0];
  const shotDateIso = primary?.isoDate ?? '';
  const shotMinute = primary?.localMinuteOfDay;

  const emptyCoverage: Verdict['coverage'] = {
    capturesFound: 0,
    capturesCompared: 0,
    truncated: false,
    from: shotDateIso,
    to: shotDateIso,
  };

  if (parsed.platform === 'unknown') {
    const v = decide({
      platform: parsed.platform,
      handleOk: claimedHandle ? true : null,
      dateOk: hasDates ? true : null,
      hasDates,
      best: null,
      alternates: [],
      coverage: emptyCoverage,
      archiveError: false,
    });
    emit({ phase: 'done' });
    return v;
  }

  if (!claimedHandle || !hasDates) {
    const v = decide({
      platform: parsed.platform,
      handleOk: claimedHandle ? true : null,
      dateOk: null,
      hasDates,
      best: null,
      alternates: [],
      coverage: emptyCoverage,
      archiveError: false,
    });
    emit({ phase: 'done' });
    return v;
  }

  // Window = union over claimed dates.
  let fromMs = Infinity;
  let toMs = -Infinity;
  for (const d of dates) {
    const w = windowFromIsoDate(d.isoDate);
    if (w.fromMs < fromMs) fromMs = w.fromMs;
    if (w.toMs > toMs) toMs = w.toMs;
  }
  const coverageFrom = new Date(fromMs).toISOString();
  const coverageTo = new Date(toMs).toISOString();

  emit({ phase: 'searching' });
  let candidates: Candidate[];
  try {
    const res = await deps.search(claimedHandle, { fromMs, toMs });
    candidates = normalizeCandidates(res);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    const isArchive =
      code === 'ARCHIVE_RATE_LIMITED' || code === 'ARCHIVE_TIMEOUT' || code === 'ARCHIVE_ERROR';
    const v = decide({
      platform: parsed.platform,
      handleOk: true,
      dateOk: true,
      hasDates,
      best: null,
      alternates: [],
      coverage: { capturesFound: 0, capturesCompared: 0, truncated: false, from: coverageFrom, to: coverageTo },
      archiveError: isArchive ? true : true,
    });
    emit({ phase: 'done' });
    return v;
  }

  if (signal?.aborted) {
    const v = decide({
      platform: parsed.platform,
      handleOk: true,
      dateOk: true,
      hasDates,
      best: null,
      alternates: [],
      coverage: {
        capturesFound: candidates.length,
        capturesCompared: 0,
        truncated: candidates.length > 0,
        from: coverageFrom,
        to: coverageTo,
      },
      archiveError: false,
    });
    emit({ phase: 'done' });
    return v;
  }

  const ranked = rankByTimeConsistency(candidates, shotDateIso, shotMinute);
  const top = ranked.slice(0, MAX_SNAPSHOTS_PER_CHECK);

  emit({ phase: 'comparing', compared: 0, total: top.length });

  const start = Date.now();
  const holder: {
    best: {
      candidate: Candidate;
      archived: ArchivedPost;
      score: number;
      textSim: number;
      timeConsistent: boolean | null;
      extractable: boolean;
    } | null;
  } = { best: null };
  const scored: Array<{ candidate: Candidate; archived: ArchivedPost; score: number; textSim: number }> = [];
  let compared = 0;
  let archiveFailures = 0;
  let earlyExit = false;
  let idx = 0;

  async function worker(): Promise<void> {
    while (true) {
      if (signal?.aborted || earlyExit) return;
      if (Date.now() - start > VERIFY_TIME_BUDGET_MS) return;
      const i = idx++;
      const cand = top[i];
      if (!cand) return;
      let archived: ArchivedPost;
      try {
        archived = await deps.snapshot(cand.snapshotTs, cand.originalUrl);
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === 'ARCHIVE_RATE_LIMITED' || code === 'ARCHIVE_TIMEOUT' || code === 'ARCHIVE_ERROR') {
          archiveFailures++;
        }
        compared++;
        emit({ phase: 'comparing', compared, total: top.length });
        continue;
      }
      compared++;
      const tc = hasDates ? checkTimeConsistent(shotDateIso, shotMinute, cand.idTimeMs) : null;
      const dateOnly = hasDates ? checkDateConsistent(shotDateIso, cand.idTimeMs) : null;
      const candHandle = handleFromUrl(cand.originalUrl);
      const effHandle = archived.handle ?? candHandle;
      const handleOK: boolean | null =
        claimedHandle == null ? null : effHandle != null ? effHandle.toLowerCase() === claimedHandle.toLowerCase() : null;
      const dateOK: boolean | null = dateOnly;
      const r = scorePair(claimedText, archived.text, {
        handleOK: handleOK ?? false,
        dateOK: dateOK ?? false,
        timeConsistent: tc,
      });
      // scorePair expects non-null booleans for gates; missing handle/date counts as not-OK (capped).
      const extractable = archived.text != null && archived.text.trim() !== '';
      scored.push({ candidate: cand, archived, score: r.score, textSim: r.textSim });
      if (!holder.best || r.score > holder.best.score) {
        holder.best = { candidate: cand, archived, score: r.score, textSim: r.textSim, timeConsistent: tc, extractable };
      }
      emit({ phase: 'comparing', compared, total: top.length });
      if (r.score >= EARLY_EXIT_SCORE) {
        earlyExit = true;
        return;
      }
    }
  }

  const workers: Promise<void>[] = [];
  const n = Math.min(VERIFY_CONCURRENCY, top.length);
  for (let w = 0; w < n; w++) workers.push(worker());
  await Promise.all(workers);

  scored.sort((a, b) => b.score - a.score);
  const curBest = holder.best;
  const alternates = scored
    .filter((s) => (curBest ? s.candidate.originalUrl !== curBest.candidate.originalUrl || s.candidate.snapshotTs !== curBest.candidate.snapshotTs : true))
    .slice(0, 5)
    .map((s) => ({ candidate: s.candidate, textSim: s.textSim }));

  // If every snapshot failed with an archive error and nothing was compared, surface unavailable.
  if (!curBest && top.length > 0 && archiveFailures >= top.length && compared > 0 && scored.length === 0) {
    const v = decide({
      platform: parsed.platform,
      handleOk: true,
      dateOk: true,
      hasDates,
      best: null,
      alternates: [],
      coverage: {
        capturesFound: candidates.length,
        capturesCompared: compared,
        truncated: candidates.length > compared,
        from: coverageFrom,
        to: coverageTo,
      },
      archiveError: true,
    });
    emit({ phase: 'done' });
    return v;
  }

  const verdict = decide({
    platform: parsed.platform,
    handleOk: true,
    dateOk: true,
    hasDates,
    best: curBest
      ? {
          score: curBest.score,
          textSim: curBest.textSim,
          timeConsistent: curBest.timeConsistent,
          extractable: curBest.extractable,
          candidate: curBest.candidate,
          archived: curBest.archived,
        }
      : null,
    alternates,
    coverage: {
      capturesFound: candidates.length,
      capturesCompared: compared,
      truncated: candidates.length > compared,
      from: coverageFrom,
      to: coverageTo,
    },
    archiveError: false,
    ...(curBest && curBest.archived.text
      ? { diff: wordDiff(claimedText, curBest.archived.text) }
      : {}),
  });
  emit({ phase: 'done' });
  return verdict;
}
