// Per-IP rate limiting via Upstash sliding windows (SPEC: fail-open, PII-free).
// Never logs raw IPs — only truncated hashes. Never throws.
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { RL_RECEIPT, RL_SEARCH, RL_SNAPSHOT } from '../../lib/config';
import { log } from '../../lib/log';

export type RateKind = 'search' | 'snapshot' | 'receipt';

export interface RateEnv {
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
}

export interface RateResult {
  ok: boolean;
  retryAfterMs?: number;
}

/** sha256 hex of `${salt}:${ip}` via WebCrypto. Salt = UTC date string (daily rotation). */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function limitFor(kind: RateKind): { limit: number; windowSec: number } {
  if (kind === 'search') return RL_SEARCH;
  if (kind === 'snapshot') return RL_SNAPSHOT;
  return RL_RECEIPT;
}

/**
 * Sliding-window check. Fail-open (ok:true) when Redis is unconfigured or
 * errors. Never logs the raw IP.
 */
export async function checkRateLimit(env: RateEnv, kind: RateKind, ip: string): Promise<RateResult> {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return { ok: true };
  const cleanIp = ip.trim();
  if (!cleanIp || cleanIp === 'unknown') return { ok: true };
  try {
    const cfg = limitFor(kind);
    const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(cfg.limit, `${cfg.windowSec} s`),
      prefix: `rl:${kind}`,
    });
    const salt = new Date().toISOString().slice(0, 10);
    const hashed = await hashIp(cleanIp, salt);
    const res = await limiter.limit(hashed);
    if (res.success) return { ok: true };
    const retryAfterMs = Math.max(0, res.reset - Date.now());
    log('ratelimit.hit', { kind, hashPrefix: hashed.slice(0, 8), retryAfterMs });
    return { ok: false, retryAfterMs };
  } catch {
    return { ok: true };
  }
}
