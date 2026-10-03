// Client check flow (privacy-preserving).
//
// Sends ONLY {platform,handle,window} to /api/wayback/search,
// {snapshotTs,originalUrl} to /api/wayback/snapshot, and the public tweet ID
// to /api/x/tweet. Screenshot bytes and OCR body text NEVER leave the device
// except via explicit createReceipt(body) -> POST /api/receipt.
//
// Scoring uses the SAME shared libs as the server receipt path:
// lib/match (similarity/score/diff), lib/verdict (decide), lib/wayback
// (timeConsistency).
import {
  EARLY_EXIT_SCORE,
  MAX_SNAPSHOTS_PER_CHECK,
  SCORE_LIKELY,
  SCORE_STRONG,
  VERIFY_CONCURRENCY,
  VERIFY_TIME_BUDGET_MS,
} from '../../lib/config';
import { textSimilarity } from '../../lib/match/similarity';
import { scorePair } from '../../lib/match/score';
import { diffForDisplay } from '../../lib/match/diff';
import { decide } from '../../lib/verdict/engine';
import {
  checkDateConsistent,
  checkTimeConsistent,
  rankByTimeConsistency,
} from '../../lib/wayback/timeConsistency';
import type { ArchivedPost, Candidate, CrossCheck, ParsedScreenshot, Verdict, VerdictCode } from '../../lib/types';

export interface CheckCallbacks {
  onStage?: (stage: string) => void;
  onProgress?: (compared: number, total: number) => void;
  signal?: AbortSignal;
}

export interface ReceiptInput {
  platform: 'x';
  handle: string;
  claimedDateIso: string;
  claimedTimeMinute?: number;
  claimedText: string;
  fieldsEdited: boolean;
  snapshotTs: string;
  originalUrl: string;
}

/** 0..1 similarity via the shared lib (caps/guards included). */
export function similarityScore(a: string, b: string): number {
  return textSimilarity(a, b).score;
}

export function toWordDiff(claimed: string, archived: string): Verdict['diff'] {
  return diffForDisplay(claimed, archived);
}

/**
 * SPEC §4.3 window: [date 00:00 − 14h, date 23:59:59 + 12h] UTC (covers
 * UTC−12…UTC+14). Ambiguous dates union the windows. Returns null when no
 * usable date exists (caller emits INSUFFICIENT_INPUT — never guess).
 */
export function windowFromParsed(p: ParsedScreenshot): { fromMs: number; toMs: number } | null {
  const dates = p.dates.value ?? [];
  if (dates.length === 0) return null;
  let fromMs = Infinity;
  let toMs = -Infinity;
  for (const d of dates) {
    const start = Date.parse(`${d.isoDate}T00:00:00Z`);
    const end = Date.parse(`${d.isoDate}T23:59:59Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    fromMs = Math.min(fromMs, start - 14 * 3600_000);
    toMs = Math.max(toMs, end + 12 * 3600_000);
  }
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  return { fromMs, toMs };
}

interface SearchApiOk {
  ok: true;
  cached: boolean;
  candidates: Candidate[];
  coverage: {
    buckets: number;
    totalCaptures: number;
    truncated: boolean;
    handleHasAnyCaptures: boolean;
    repairedHandle?: string;
  };
}

interface SnapshotApiOk {
  ok: true;
  cached: boolean;
  archiveUrl: string;
  extracted: ArchivedPost;
}

async function postJson<T>(url: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  const json = (await res.json()) as unknown;
  if (!res.ok) {
    const err = json as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `request failed: ${url}`);
  }
  return json as T;
}

function insufficient(reason: 'platform' | 'fields', code: VerdictCode): Verdict {
  void reason;
  return {
    code,
    score: null,
    checks: { handle: null, date: null, timeConsistent: null, textSim: null },
    alternates: [],
    coverage: { capturesFound: 0, capturesCompared: 0, truncated: false, from: '', to: '' },
  };
}

export async function runCheckFlow(parsed: ParsedScreenshot, cb: CheckCallbacks = {}): Promise<Verdict> {
  const { signal } = cb;
  const claimedText = parsed.text.value ?? '';
  const handle = (parsed.handle.value ?? '').trim().toLowerCase();
  const dateIso = parsed.dates.value?.[0]?.isoDate;
  const claimedMinute = parsed.dates.value?.[0]?.localMinuteOfDay;

  if (parsed.platform !== 'x') return insufficient('platform', 'UNSUPPORTED_PLATFORM');
  if (!handle || !claimedText.trim()) return insufficient('fields', 'INSUFFICIENT_INPUT');

  const window = windowFromParsed(parsed);
  if (!window || !dateIso) return insufficient('fields', 'INSUFFICIENT_INPUT');
  const { fromMs, toMs } = window;
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();

  cb.onStage?.('search');
  let search: SearchApiOk;
  try {
    // Privacy: only handle + window leave the device here.
    search = await postJson<SearchApiOk>('/api/wayback/search', { platform: 'x', handle, window: { fromMs, toMs } }, signal);
  } catch {
    return {
      code: 'ARCHIVE_UNAVAILABLE',
      score: null,
      checks: { handle: null, date: null, timeConsistent: null, textSim: null },
      alternates: [],
      coverage: { capturesFound: 0, capturesCompared: 0, truncated: false, from: fromIso, to: toIso },
    };
  }

  const ranked = rankByTimeConsistency(search.candidates, dateIso, claimedMinute).slice(0, MAX_SNAPSHOTS_PER_CHECK);
  // Repaired handle (server fell back to an OCR-confusable variant):
  // score with handleOK=false so the context cap applies, and flag it.
  const repairedHandle = search.coverage.repairedHandle;
  const handleOK = repairedHandle === undefined;
  const repairFlag = repairedHandle !== undefined ? { repairedHandle } : {};
  if (ranked.length === 0) {
    return {
      code: 'NO_MATCH',
      score: null,
      checks: { handle: false, date: null, timeConsistent: null, textSim: null },
      alternates: [],
      coverage: {
        capturesFound: search.candidates.length,
        capturesCompared: 0,
        truncated: search.coverage.truncated,
        from: fromIso,
        to: toIso,
        ...repairFlag,
      },
    };
  }

  cb.onStage?.('snapshots');
  const deadline = Date.now() + VERIFY_TIME_BUDGET_MS;
  const scored: Array<{
    candidate: Candidate;
    archived: ArchivedPost;
    score: number;
    textSim: number;
    timeConsistent: boolean | null;
    dateOK: boolean | null;
  }> = [];
  let compared = 0;
  let cursor = 0;
  let bestScore = 0;

  async function worker(): Promise<void> {
    while (cursor < ranked.length) {
      if (signal?.aborted) break;
      if (Date.now() > deadline) break;
      if (bestScore >= EARLY_EXIT_SCORE) break;
      const idx = cursor;
      cursor += 1;
      const cand = ranked[idx];
      if (!cand) continue;
      try {
        // Privacy: only snapshot pointer leaves the device here.
        const snap = await postJson<SnapshotApiOk>(
          '/api/wayback/snapshot',
          { snapshotTs: cand.snapshotTs, originalUrl: cand.originalUrl },
          signal,
        );
        const archivedText = snap.extracted.text;
        const dateOK = checkDateConsistent(dateIso as string, cand.idTimeMs);
        const tc = checkTimeConsistent(dateIso as string, claimedMinute, cand.idTimeMs);
        const gated = scorePair(claimedText, archivedText, {
          handleOK,
          dateOK: dateOK === true,
          timeConsistent: tc,
        });
        scored.push({ candidate: cand, archived: snap.extracted, score: gated.score, textSim: gated.textSim, timeConsistent: tc, dateOK });
        if (gated.score > bestScore) bestScore = gated.score;
      } catch {
        // per-candidate failure: skip
      } finally {
        compared += 1;
        cb.onProgress?.(compared, ranked.length);
      }
    }
  }

  const poolSize = Math.min(VERIFY_CONCURRENCY, ranked.length);
  await Promise.all(Array.from({ length: poolSize }, () => worker()));

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const coverage = {
    capturesFound: search.candidates.length,
    capturesCompared: compared,
    truncated: search.coverage.truncated,
    from: fromIso,
    to: toIso,
    ...repairFlag,
  };
  if (!best) {
    // Snapshots all failed but candidates exist: searched, found pointers,
    // could not compare text. The live cross-check can still verify.
    const first = ranked[0];
    const base: Verdict = decide({
      platform: 'x',
      handleOk: handleOK,
      dateOk: null,
      hasDates: true,
      best: null,
      alternates: [],
      coverage,
      archiveError: false,
    });
    if (!first) return base;
    return withCrossCheck(base, {
      candidate: first,
      claimedText,
      handle,
      dateIso: dateIso as string,
      claimedMinute,
      handleOK,
      signal,
    });
  }
  const extractable = (best.archived.text ?? '').trim() !== '';
  const base: Verdict = decide({
    platform: 'x',
    handleOk: handleOK,
    dateOk: best.dateOK,
    hasDates: true,
    best: {
      score: best.score,
      textSim: best.textSim,
      timeConsistent: best.timeConsistent,
      extractable,
      candidate: best.candidate,
      archived: best.archived,
    },
    alternates: scored.slice(1, 4).map((s) => ({ candidate: s.candidate, textSim: s.textSim })),
    coverage,
    archiveError: false,
    diff: best.archived.text ? diffForDisplay(claimedText, best.archived.text) : undefined,
  });
  return withCrossCheck(base, {
    candidate: best.candidate,
    claimedText,
    handle,
    dateIso: dateIso as string,
    claimedMinute,
    handleOK,
    signal,
  });
}

interface CrossCheckCtx {
  candidate: Candidate;
  claimedText: string;
  handle: string;
  dateIso: string;
  claimedMinute: number | undefined;
  handleOK: boolean;
  signal?: AbortSignal;
}

// NOTE: the /api/x/tweet contract is { ok, cached, tweet: { status, id,
// text, screenName, ... } }, but runtime parsing below is shape-hardened
// inline (mocks/proxies/upstream changes must never crash the check), so no
// static response type is asserted here.

/**
 * Authoritative live-post cross-check (Part 2/4 of the accuracy upgrade).
 * Asks /api/x/tweet for the best candidate's PUBLIC tweet ID only, then:
 * - archive MATCH + live agrees (same author, text sim >= 0.75) →
 *   crossCheck.verifiedBy = 'archive+x' ("Verified against X + archive");
 * - archive unreadable/failed + live verifies (same author, sim >= 0.90) →
 *   upgrades to MATCH_STRONG (0.75–0.89 → MATCH_LIKELY) with the live text
 *   as evidence ('x-live'). Never downgrades an archive match.
 * Returns the input verdict unchanged on any failure/timeout (archive path
 * always stands alone; the endpoint is unofficial).
 */
async function withCrossCheck(base: Verdict, ctx: CrossCheckCtx): Promise<Verdict> {
  const { candidate, claimedText, handle, dateIso, claimedMinute, handleOK } = ctx;
  let api: { tweet?: unknown } | null = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch('/api/x/tweet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: candidate.tweetId }),
        signal: ctx.signal?.aborted ? ctx.signal : ctrl.signal,
      });
      if (res.ok) api = (await res.json()) as { tweet?: unknown };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return base;
  }
  // Shape-hardened: mocks, proxies, or upstream changes must never crash the
  // check or attach a half-parsed cross-check. Unknown shape = no evidence.
  if (api === null) return base;
  const tw = api.tweet;
  if (tw === null || typeof tw !== 'object') return base;
  const t = tw as { status?: unknown; text?: unknown; screenName?: unknown };
  const screenName = typeof t.screenName === 'string' ? t.screenName : null;
  if (t.status !== 'live' || typeof t.text !== 'string' || t.text.trim() === '') {
    const cc: CrossCheck = {
      tweetId: candidate.tweetId,
      originalUrl: candidate.originalUrl,
      status: 'unavailable',
      screenName,
      liveTextSim: null,
      authorMatch: null,
      verified: false,
      verifiedBy: null,
    };
    return { ...base, crossCheck: cc };
  }
  const liveText: string = t.text;
  const authorMatch = (screenName ?? '').toLowerCase() === handle;
  const liveSim = textSimilarity(claimedText, liveText).score;
  const dateOK = checkDateConsistent(dateIso, candidate.idTimeMs);
  const tc = checkTimeConsistent(dateIso, claimedMinute, candidate.idTimeMs);
  const liveArchived: ArchivedPost = {
    text: liveText,
    handle: screenName ?? undefined,
    extractor: 'syndication',
  };
  const strong = authorMatch && liveSim >= SCORE_STRONG;
  const likely = authorMatch && liveSim >= SCORE_LIKELY;
  const archiveMatched = base.code === 'MATCH_STRONG' || base.code === 'MATCH_LIKELY';

  if (archiveMatched && likely) {
    // Both independent sources agree.
    const cc: CrossCheck = {
      tweetId: candidate.tweetId,
      originalUrl: candidate.originalUrl,
      status: 'live',
      screenName,
      liveTextSim: liveSim,
      authorMatch,
      verified: true,
      verifiedBy: 'archive+x',
    };
    return { ...base, crossCheck: cc };
  }
  if (!archiveMatched && (strong || likely) && handleOK) {
    // Archive text unreadable (or snapshots failed) but the live post
    // verifies author + text: upgrade with live evidence.
    const gated = scorePair(claimedText, liveText, {
      handleOK: true,
      dateOK: dateOK === true,
      timeConsistent: tc,
    });
    const upgraded = decide({
      platform: 'x',
      handleOk: true,
      dateOk: dateOK,
      hasDates: true,
      best: {
        score: gated.score,
        textSim: gated.textSim,
        timeConsistent: tc,
        extractable: true,
        candidate,
        archived: liveArchived,
      },
      alternates: base.alternates,
      coverage: base.coverage,
      archiveError: false,
      diff: diffForDisplay(claimedText, liveText),
    });
    const cc: CrossCheck = {
      tweetId: candidate.tweetId,
      originalUrl: candidate.originalUrl,
      status: 'live',
      screenName,
      liveTextSim: liveSim,
      authorMatch,
      verified: true,
      verifiedBy: 'x-live',
    };
    return { ...upgraded, crossCheck: cc };
  }
  const cc: CrossCheck = {
    tweetId: candidate.tweetId,
    originalUrl: candidate.originalUrl,
    status: 'live',
    screenName,
    liveTextSim: liveSim,
    authorMatch,
    verified: false,
    verifiedBy: null,
  };
  return { ...base, crossCheck: cc };
}

/** Explicit opt-in only: uploads OCR/body text to create a shareable receipt. */
export async function createReceipt(input: ReceiptInput): Promise<{ id: string; url: string }> {
  const res = await fetch('/api/receipt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = (await res.json()) as { ok: boolean; id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !json.id || !json.url) throw new Error(json.error?.message ?? 'receipt failed');
  return { id: json.id, url: json.url };
}
