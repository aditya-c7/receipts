# DECISIONS

- Stack S over Vercel+Firebase for few-users simplicity: Cloudflare Workers (100k req/day free, commercial OK) + Upstash Redis Free (500k cmds/mo, TTL-native) + D1 (receipts durability). Memory cache remains as fallback interface.
- SPA (Vite) + Hono worker in one Worker project instead of Next.js App Router (avoids next-on-pages CPU/RAM friction, keeps lib/ pure TS portable).
- Banned-words vs NO_MATCH wording conflict (§0.6 vs §4.7 "does not mean it's fake"): honest meaning preserved as "That does not mean it is not real." so the guardrail test passes. Guardrail uses whole-word match (avoids false positives like "replies" containing "lie"); banned list lives only in the test file, never in copy.ts.
- CDX discovery: SPEC ID-prefix-bucket search now SHIPPED (worker/wayback/cdx.ts drives lib/wayback/buckets + buildCdxUrl/parse/dedupe/filter — no duplicate parsers). Capture-time `from=` lower bound ONLY (never `to=` — a capture can postdate the post by years). x.com buckets first, twitter.com as fall-through when x.com yields nothing (same tweet IDs, halves typical volume); bucket fetches capped at concurrency 3 against the archive's ~60 req/min ceiling. Exact Snowflake ID-time filter client-side.
- Pre-2010 (non-Snowflake) IDs: kept in candidate set (idTimeMs 0 = unknown) rather than dropped, since their Snowflake decode is meaningless.
- Screenshot date window: SPEC ±50h ([date 00:00 − 14h, 23:59 + 12h] UTC) in src/lib/check-client.ts windowFromParsed.
- vite 5.4.x (not 6): vitest 2.1.8 bundles vite 5 types; vite 6 breaks vitest.config.ts typecheck. Revisit on vitest 3.
