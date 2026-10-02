// Cache abstraction for Track C (SPEC: zero-cost, good citizen to archive.org).
// TTLs are the single source of truth from lib/config.
import { Redis } from '@upstash/redis';
import { CDX_EMPTY_TTL_HOURS, CDX_TTL_DAYS, SNAP_TTL_DAYS } from '../../lib/config';

export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set(key: string, val: unknown, ttlSec: number): Promise<void>;
}

export interface CacheEnv {
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
}

/** Upstash REST cache. Never throws — returns null / no-op on error (fail-open). */
export class UpstashRedisCache implements Cache {
  private redis: Redis;
  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token });
  }
  async get<T>(key: string): Promise<T | null> {
    try {
      const v = await this.redis.get<T>(key);
      return v ?? null;
    } catch {
      return null;
    }
  }
  async set(key: string, val: unknown, ttlSec: number): Promise<void> {
    try {
      await this.redis.set(key, val, { ex: ttlSec });
    } catch {
      // fail-open: caching is best-effort
    }
  }
}

/** In-memory fallback with expiry + simple LRU-ish eviction. Never throws. */
export class MemoryCache implements Cache {
  private store = new Map<string, { val: unknown; exp: number }>();
  private maxEntries: number;
  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }
  async get<T>(key: string): Promise<T | null> {
    try {
      const entry = this.store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.exp) {
        this.store.delete(key);
        return null;
      }
      return entry.val as T;
    } catch {
      return null;
    }
  }
  async set(key: string, val: unknown, ttlSec: number): Promise<void> {
    try {
      if (this.store.size >= this.maxEntries) {
        const oldest = this.store.keys().next();
        if (!oldest.done) this.store.delete(oldest.value);
      }
      this.store.set(key, { val, exp: Date.now() + ttlSec * 1000 });
    } catch {
      // fail-open
    }
  }
}

let memorySingleton: MemoryCache | null = null;

/** Prefer Upstash when configured; otherwise shared in-memory fallback. Never throws. */
export function makeCache(env: CacheEnv): Cache {
  try {
    if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
      return new UpstashRedisCache(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
    }
  } catch {
    // fall through to memory
  }
  if (!memorySingleton) memorySingleton = new MemoryCache();
  return memorySingleton;
}

// ---- Key helpers ----

export function buildQueryKey(handle: string, fromMs: number, toMs: number): string {
  return `${handle.toLowerCase()}:${fromMs}:${toMs}`;
}

export function cdxKey(queryKey: string): string {
  return `cdx:v1:${queryKey}`;
}

export function snapKey(snapshotTs: string, originalUrl: string): string {
  return `snap:v1:${snapshotTs}:${originalUrl}`;
}

/** TTL for CDX entries: 30d on hits, 6h on empty (avoid caching "nothing" too long). */
export function cdxTtlSec(empty: boolean): number {
  return empty ? CDX_EMPTY_TTL_HOURS * 3600 : CDX_TTL_DAYS * 24 * 3600;
}

/** Snapshot TTL: 180d (archived captures are immutable). */
export function snapTtlSec(): number {
  return SNAP_TTL_DAYS * 24 * 3600;
}
