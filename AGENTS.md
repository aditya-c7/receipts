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

## Windows env note
- `pnpm` lives in `%USERPROFILE%\.npm-global` (corepack shims unwritable without admin). Prefix package-manager commands with `$env:PATH="$env:USERPROFILE\.npm-global;$env:PATH";` or set PATH for the session.
- `pnpm dev:all` starts web (vite :5173) + API (`wrangler dev` :8787) together; vite proxies `/api` → 127.0.0.1:8787. `pnpm dev` is web-only, `pnpm dev:worker` is API-only.
- One-command prod parity: `wrangler dev`/`deploy` also serves `dist/` + API from `wrangler.toml` `[assets]` (SPA fallback; `/api/*` runs the Worker first). Run `pnpm build` before `wrangler deploy`. `pnpm deploy` is dry-run only; remove `--dry-run` for a real deploy.
- D1: `worker/db/schema.sql` is the source copy; `migrations/0001_schema.sql` is the byte-identical wrangler copy (`migrations_dir = "migrations"`). Local verify: `wrangler d1 migrations list receipts-db --local`. Never touch remote without being asked.
- Never commit `.dev.vars` (gitignored; overrides `[vars]` in `wrangler dev`).
