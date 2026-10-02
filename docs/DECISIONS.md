# DECISIONS

- Stack S over Vercel+Firebase for few-users simplicity: Cloudflare Workers (100k req/day free, commercial OK) + Upstash Redis Free (500k cmds/mo, TTL-native) + D1 (receipts durability). Memory cache remains as fallback interface.
- SPA (Vite) + Hono worker in one Worker project instead of Next.js App Router (avoids next-on-pages CPU/RAM friction, keeps lib/ pure TS portable).
- Banned-words vs NO_MATCH wording conflict (§0.6 vs §4.7 "does not mean it's fake"): honest meaning preserved as "That does not mean it is not real." so the guardrail test passes. Guardrail uses whole-word match (avoids false positives like "replies" containing "lie"); banned list lives only in the test file, never in copy.ts.
- CDX discovery (few-users simplification): wildcard `x.com/{handle}/status/*` + `twitter.com/...` queries with capture-time `from=` lower bound ONLY (no `to=` upper bound — a capture can't predate the post but can postdate it by years, SPEC §4.3 gotcha), then exact Snowflake ID-time filter client-side. Full ID-prefix bucket search (lib/wayback/buckets.ts, already unit-tested) is wired as the follow-up if recall proves insufficient.
- Pre-2010 (non-Snowflake) IDs: kept in candidate set (idTimeMs 0 = unknown) rather than dropped, since their Snowflake decode is meaningless.
- Screenshot date window: SPEC ±50h ([date 00:00 − 14h, 23:59 + 12h] UTC) in src/lib/check-client.ts windowFromParsed.
- vite 5.4.x (not 6): vitest 2.1.8 bundles vite 5 types; vite 6 breaks vitest.config.ts typecheck. Revisit on vitest 3.
