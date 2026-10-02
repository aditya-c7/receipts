// Receipts API (Hono on Cloudflare Workers).
// maxDuration: 30 (hints Vercel-style timeouts; Workers use CPU limits instead).
//
// Security headers note: API responses carry nosniff + no-referrer +
// frame-deny. The SPA previews Wayback captures in a sandboxed iframe
// (sandbox="" + referrerpolicy) — never inline.
//
// zod schemas and GET /api/health below are frozen (Track C must not break them).
import { Hono } from 'hono';
import { z } from 'zod';
import { toErrorJson, AppError } from '../lib/errors';
import { log } from '../lib/log';
import { scorePair } from '../lib/match/score';
import { decide } from '../lib/verdict/engine';
import { archiveUrl, extractTweetId } from '../lib/wayback/urls';
import { idToMs } from '../lib/wayback/snowflake';
import { checkDateConsistent, checkTimeConsistent } from '../lib/wayback/timeConsistency';
import { makeCache } from './cache/redis';
import { checkRateLimit } from './ratelimit/upstash';
import { getReceipt, saveReceipt, type D1Database } from './db/receipts';
import { fetchCandidates } from './wayback/cdx';
import { fetchSnapshot } from './wayback/snapshot';

type Bindings = {
  RECEIPTS_DB?: D1Database;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  WAYBACK_USER_AGENT?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Security headers for every API response.
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Frame-Options', 'DENY');
});

app.get('/api/health', (c) => c.json({ ok: true, service: 'receipts', ts: Date.now() }));

function clientIp(c: { req: { header(name: string): string | undefined } }): string {
  const cf = c.req.header('cf-connecting-ip');
  if (cf) return cf;
  const fwd = c.req.header('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

const searchSchema = z.object({
  platform: z.literal('x'),
  handle: z.string().regex(/^[A-Za-z0-9_]{1,15}$/),
  window: z.object({ fromMs: z.number().int().nonnegative(), toMs: z.number().int().nonnegative() }),
});

app.post('/api/wayback/search', async (c) => {
  try {
    const body = searchSchema.parse(await c.req.json());
    const rl = await checkRateLimit(c.env, 'search', clientIp(c));
    if (!rl.ok) {
      return c.json(
        { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many searches — try again shortly.', retryAfterMs: rl.retryAfterMs } },
        429,
      );
    }
    log('wayback.search', { handleLen: body.handle.length });
    const cache = makeCache(c.env);
    const result = await fetchCandidates(body.handle, body.window.fromMs, body.window.toMs, c.env, cache);
    return c.json({ ok: true, cached: result.cached, candidates: result.candidates, coverage: result.coverage });
  } catch (e) {
    if (e instanceof z.ZodError) return c.json(toErrorJson(new AppError('BAD_INPUT', 'Invalid search input')), 400);
    return c.json(toErrorJson(e), 500);
  }
});

const snapshotSchema = z.object({
  snapshotTs: z.string().regex(/^\d{14}$/),
  originalUrl: z.string().regex(/^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+$/),
});

app.post('/api/wayback/snapshot', async (c) => {
  try {
    const body = snapshotSchema.parse(await c.req.json());
    const rl = await checkRateLimit(c.env, 'snapshot', clientIp(c));
    if (!rl.ok) {
      return c.json(
        { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many snapshot fetches — try again shortly.', retryAfterMs: rl.retryAfterMs } },
        429,
      );
    }
    log('wayback.snapshot', { ts: body.snapshotTs.slice(0, 8) });
    const cache = makeCache(c.env);
    try {
      const snap = await fetchSnapshot(body.snapshotTs, body.originalUrl, c.env, cache);
      return c.json({ ok: true, cached: snap.cached, archiveUrl: snap.archiveUrl, extracted: snap.extracted });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'snapshot fetch failed';
      if (/timeout|abort/i.test(msg)) return c.json(toErrorJson(new AppError('ARCHIVE_TIMEOUT', 'Archive timed out')), 504);
      return c.json(toErrorJson(new AppError('ARCHIVE_ERROR', 'Archive fetch failed')), 502);
    }
  } catch (e) {
    if (e instanceof z.ZodError) return c.json(toErrorJson(new AppError('BAD_INPUT', 'Invalid snapshot input')), 400);
    return c.json(toErrorJson(e), 500);
  }
});

const receiptSchema = z.object({
  platform: z.literal('x'),
  handle: z.string().regex(/^[A-Za-z0-9_]{1,15}$/),
  claimedDateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  claimedTimeMinute: z.number().int().min(0).max(1439).optional(),
  claimedText: z.string().max(2000),
  fieldsEdited: z.boolean(),
  snapshotTs: z.string().regex(/^\d{14}$/),
  originalUrl: z.string().regex(/^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+$/),
});

app.post('/api/receipt', async (c) => {
  try {
    const body = receiptSchema.parse(await c.req.json());
    const rl = await checkRateLimit(c.env, 'receipt', clientIp(c));
    if (!rl.ok) {
      return c.json(
        { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many receipts — try again later.', retryAfterMs: rl.retryAfterMs } },
        429,
      );
    }
    if (!c.env.RECEIPTS_DB) {
      return c.json(
        toErrorJson(new AppError('INTERNAL', 'Receipt store unavailable in this environment (no D1 binding). Run wrangler dev with D1 or use `wrangler d1` to provision.')),
        501,
      );
    }
    // Server recompute (anti-forgery): re-fetch from cache/network with the
    // SAME shared libs as the client, never trust the client score.
    const cache = makeCache(c.env);
    let snapExtracted: { text: string | null; extractor: 'ldjson' | 'og' | 'classic' | 'embeddedJson' | 'title' | 'none' } | null = null;
    try {
      const snap = await fetchSnapshot(body.snapshotTs, body.originalUrl, c.env, cache);
      snapExtracted = snap.extracted;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'snapshot fetch failed';
      if (/timeout|abort/i.test(msg)) return c.json(toErrorJson(new AppError('ARCHIVE_TIMEOUT', 'Archive timed out')), 504);
      return c.json(toErrorJson(new AppError('ARCHIVE_ERROR', 'Could not re-fetch the archived capture for this receipt')), 502);
    }
    const archivedText = snapExtracted?.text ?? null;
    const extractable = archivedText != null && archivedText.trim() !== '';
    const tweetId = extractTweetId(body.originalUrl) ?? '';
    const idTimeMs = tweetId !== '' ? idToMs(tweetId) : NaN;
    const dateOK = checkDateConsistent(body.claimedDateIso, idTimeMs);
    const timeConsistent = checkTimeConsistent(body.claimedDateIso, body.claimedTimeMinute, idTimeMs);
    const gated = scorePair(body.claimedText, archivedText, {
      handleOK: true,
      dateOK: dateOK === true,
      timeConsistent,
    });
    const candidate = {
      tweetId,
      idTimeMs: Number.isFinite(idTimeMs) ? idTimeMs : 0,
      snapshotTs: body.snapshotTs,
      originalUrl: body.originalUrl,
      archiveUrl: archiveUrl(body.snapshotTs, body.originalUrl),
      statusCode: 200,
    };
    const archived = {
      text: archivedText,
      handle: body.handle,
      extractor: snapExtracted?.extractor ?? ('none' as const),
    };
    const verdict = decide({
      platform: 'x',
      handleOk: true,
      dateOk: dateOK,
      hasDates: true,
      best: {
        score: extractable ? gated.score : 0,
        textSim: extractable ? gated.textSim : null,
        timeConsistent,
        extractable,
        candidate,
        archived,
      },
      alternates: [],
      coverage: {
        capturesFound: 1,
        capturesCompared: 1,
        truncated: false,
        from: body.claimedDateIso,
        to: body.claimedDateIso,
      },
      archiveError: false,
    });
    const { id } = await saveReceipt(c.env.RECEIPTS_DB, {
      verdictCode: verdict.code,
      score: verdict.score,
      handle: body.handle,
      claimedDateIso: body.claimedDateIso,
      snapshotTs: body.snapshotTs,
      originalUrl: body.originalUrl,
      archiveSnippet: archivedText ?? '',
      fieldsEdited: body.fieldsEdited,
    });
    log('receipt.created', { idLen: id.length, verdictLen: verdict.code.length });
    return c.json({ ok: true, id, url: `/r/${id}` });
  } catch (e) {
    if (e instanceof z.ZodError) return c.json(toErrorJson(new AppError('BAD_INPUT', 'Invalid receipt input')), 400);
    return c.json(toErrorJson(e), 500);
  }
});

const receiptIdParam = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{10}$/) });

app.get('/api/receipt/:id', async (c) => {
  try {
    const parsed = receiptIdParam.safeParse({ id: c.req.param('id') });
    if (!parsed.success) return c.json(toErrorJson(new AppError('BAD_INPUT', 'Invalid receipt id')), 400);
    if (!c.env.RECEIPTS_DB) {
      return c.json(toErrorJson(new AppError('INTERNAL', 'Receipt store unavailable in this environment (no D1 binding).')), 501);
    }
    const row = await getReceipt(c.env.RECEIPTS_DB, parsed.data.id);
    if (!row) return c.json(toErrorJson(new AppError('BAD_INPUT', 'Receipt not found')), 404);
    return c.json({ ok: true, receipt: row });
  } catch (e) {
    return c.json(toErrorJson(e), 500);
  }
});

export default app;
