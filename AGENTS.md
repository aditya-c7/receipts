# AGENTS.md — operating + ground rules (SPEC §0 + §2)

1. Work phase by phase. After each phase: `pnpm typecheck && pnpm lint && pnpm test` green → commit `phase-N: <summary>` → append note to `docs/PROGRESS.md`. Continue unless blocked.
2. Do not ask about SPEC §12 decisions. If truly uncovered, choose simplest, record in `docs/DECISIONS.md`, continue.
3. TypeScript `strict: true`. No `any` without comment. Pure logic in `lib/` with unit tests; React thin.
4. Tweet IDs exceed 2^53. Never `number`. Use `string` or `BigInt`.
5. Never log screenshots, OCR text, raw IPs.
6. Verdict strings live in `lib/verdict/copy.ts`. Unit test fails if banned words appear: `fake, forged, fraud, hoax, lie, liar, debunked, doctored`.
7. No paid services/keys beyond `.env.example` (Upstash Redis, D1, Wayback).
8. Tests alongside code. Network mocked (msw) with fixtures. `@live` skipped in CI.
9. Perf budget: first-load JS < 150kB gz. OCR/WASM lazy + cached.
10. Boring pinned libs. `pnpm audit` clean high/critical.

Ground rules: screenshot pixels never leave device; OCR text leaves only on explicit "Create receipt"; missing archive proves nothing — never output fake-verdict; receipt proves "text X existed in archive Y at Z with S", not screenshot untouched; zero-cost; good citizen to archive.org (UA + contact, cache, backoff ≤3 concurrency, credit + donate link); user edits re-run, flagged on receipts.
