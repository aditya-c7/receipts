// Tunables — single source of truth (SPEC §0 rule 10, §12 APP_NAME).
export const APP_NAME = 'Receipts';

export const OCR_MAX_DIM = 2400;
export const OCR_MIN_WIDTH = 1200;

export const SEARCH_MAX_BUCKETS = 12;
export const CDX_LIMIT = 500;
export const CDX_TIMEOUT_MS = 6000;
export const SNAPSHOT_TIMEOUT_MS = 5000;
export const SNAPSHOT_MAX_BYTES = 600_000;

export const VERIFY_CONCURRENCY = 3;
export const VERIFY_TIME_BUDGET_MS = 8000;
export const MAX_SNAPSHOTS_PER_CHECK = 10;
export const EARLY_EXIT_SCORE = 0.93;

export const SCORE_STRONG = 0.9;
export const SCORE_LIKELY = 0.75;
export const SCORE_PARTIAL = 0.55;

// Cache TTLs (seconds for Upstash, ms elsewhere — see lib/cache/redis.ts)
export const CDX_TTL_DAYS = 30;
export const CDX_EMPTY_TTL_HOURS = 6;
export const SNAP_TTL_DAYS = 180;

// Rate limits (per hashed IP window)
export const RL_SEARCH = { limit: 30, windowSec: 600 };
export const RL_SNAPSHOT = { limit: 60, windowSec: 600 };
export const RL_SYNDICATION = { limit: 60, windowSec: 600 };
export const RL_RECEIPT = { limit: 5, windowSec: 3600 };
