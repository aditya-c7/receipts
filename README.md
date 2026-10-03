# Receipts - "Did they really post that?"

Drop in a screenshot of an X/Twitter post. In about 10 seconds the app tells
you whether an archived copy of the original exists in the Internet Archive's
Wayback Machine, shows it side by side with what the screenshot claims, and
produces a shareable receipt.

**Wow moment:** `Archived original found - 96% match` with a link, a
three-check breakdown (Handle / Date / Text), a word-level diff, and a
shareable receipt card. Or, when nothing is found: `No archive match found.
That does not mean it is not real` plus coverage stats.

Live posts get a second, authoritative check: the app cross-checks the
candidate tweet ID against X itself and can show
`Verified against X + archive` with a link to the original post.

## How it works

1. You drop, paste, or pick a screenshot. It is decoded locally.
2. **On-device OCR** (PaddleOCR PP-OCRv5 primary, Tesseract fallback) reads
   handle, date/time, and body text. The image never leaves your device.
3. The client sends **only the handle + a date window** to our API, which
   queries the Wayback CDX API using Snowflake ID-prefix buckets (X post IDs
   encode their creation time, so the archive can be searched by time).
4. Candidate captures are fetched, text is extracted, and fuzzy matching +
   time-consistency scoring runs **in your browser**.
5. The best candidate's tweet ID is cross-checked against X's public
   syndication endpoint for author + text agreement.
6. You get a verdict, a neutral word-level diff, archive/preview links, the
   original post link, and an optional shareable receipt.

## Privacy: what leaves your device

| Data | Leaves device? | When |
|---|---|---|
| Screenshot pixels | Never | - |
| OCR text (post body) | Only with consent | Create-receipt dialog |
| Handle + date window | Yes | Every check (search request) |
| Snapshot pointer (timestamp + URL) | Yes | Every check (snapshot request) |
| Public tweet ID | Yes | Live cross-check (`/api/x/tweet`) |
| IP address | Hashed with a daily salt | Rate limiting only; raw IPs are never logged |

The in-app **Privacy & details** panel shows the exact JSON payload of every
request. A missing archive match proves nothing: most posts are never
archived, and the app never declares anything fake.

## Zero-cost stack

| Need | Choice | Cost |
|---|---|---|
| Hosting + API | Cloudflare Workers (free tier, commercial OK) | $0 |
| Cache + rate limiting | Upstash Redis (free tier, TTL-native) | $0 |
| Receipt + SDK store | Cloudflare D1 (free tier) | $0 |
| OCR | PaddleOCR + Tesseract, self-hosted WASM/models | $0 |
| Archive data | Wayback Machine CDX + captures (public APIs) | $0 |
| CI | GitHub Actions | $0 |

No paid services, no API keys, no per-request costs. Be a good citizen to the
Internet Archive: descriptive User-Agent with contact, aggressive caching,
backoff on 429/503, max 3 concurrent archive requests, and credit + donate
link in the UI.

## Quickstart (Windows)

Prerequisites: Node 22+ and pnpm.

```powershell
# pnpm lives in your user npm dir (corepack shims need admin); add once:
$env:PATH = "$env:USERPROFILE\.npm-global;$env:PATH"
npm install --global pnpm@9.12.0
```

```powershell
cd D:\Workspace\finder
pnpm install

# copy env template and fill in your values (never commit this file)
copy .dev.vars.example .dev.vars

# provision the receipts database (needs `wrangler login` once)
pnpm wrangler d1 create receipts-db   # paste the id into wrangler.toml
pnpm wrangler d1 migrations apply receipts-db --local
```

| Command | What it does |
|---|---|
| `pnpm dev:all` | Web (vite :5173) + API (`wrangler dev` :8787) together for development |
| `pnpm dev` | Web only |
| `pnpm dev:worker` | API only |
| `host-local.cmd` | One-click local hosting: builds and serves app + API from `http://127.0.0.1:8787` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint, zero warnings allowed |
| `pnpm test` | Vitest unit suite (network mocked; `@live` skipped without `LIVE=1`) |
| `pnpm e2e` | Playwright end-to-end (needs `pnpm exec playwright install`) |
| `pnpm build` | Production build (first-load JS budget: 150 kB gz) |
| `pnpm deploy` | Build + `wrangler deploy --dry-run` (remove `--dry-run` for real) |

Environment variables (see `.env.example`):

| Variable | Purpose |
|---|---|
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Cache + rate limiting |
| `WAYBACK_USER_AGENT` | `Receipts/1.0 (+https://YOUR_DOMAIN; contact: you@example.com)` |
| `NEXT_PUBLIC_SITE_URL` | Public origin for receipt links |

## Project structure

```
finder/
  src/                  # SPA: components + check-client orchestrator
    components/ui/      # shadcn-style primitives (button, card, dialog, ...)
    lib/ocr-run.ts      # canvas pipeline -> Paddle/Tesseract -> parse
    lib/paddle-engine.ts# PP-OCRv5 onnxruntime-web engine
    lib/check-client.ts # search -> rank -> compare -> cross-check -> verdict
  worker/               # Hono API (Cloudflare Workers)
    api.ts              # /api/wayback/*, /api/x/tweet, /api/receipt*
    wayback/            # CDX discovery, snapshot fetch
    x/syndication.ts    # live-tweet cross-check proxy
    cache/ db/ ratelimit/ # Upstash cache, D1 receipts, sliding windows
  lib/                  # shared pure logic (tested): ocr, wayback, match, verdict
  tests/unit|e2e        # vitest + playwright (+ @live smoke, opt-in)
  public/tesseract|paddle # self-hosted OCR runtimes + models
  migrations/           # D1 schema (wrangler copy; source: worker/db/schema.sql)
```

## API contracts

All responses are `{ ok: boolean, ... }`. Errors carry typed codes
(`ARCHIVE_RATE_LIMITED`, `ARCHIVE_TIMEOUT`, `ARCHIVE_ERROR`, `BAD_INPUT`,
`RATE_LIMITED`, `INTERNAL`) with matching HTTP statuses.

- `POST /api/wayback/search` `{ platform, handle, window: { fromMs, toMs } }`
  returns `{ candidates[], coverage }` (cached flag included).
- `POST /api/wayback/snapshot` `{ snapshotTs, originalUrl }` returns the
  extracted archived text (server builds the Wayback URL; SSRF-guarded).
- `POST /api/x/tweet` `{ id }` returns the live post (`live`) or
  `unavailable` (only the public tweet ID is sent).
- `POST /api/receipt` (opt-in, server recomputes the score to prevent forged
  receipts) returns `{ id, url }`; `GET /api/receipt/:id` reads it back.

## Verdicts

| Code | Meaning |
|---|---|
| `MATCH_STRONG` / `MATCH_LIKELY` | Archived (or live) text matches at >= 0.90 / 0.75 |
| `MATCH_PARTIAL` | Closest post only partly matches |
| `POST_EXISTS_TEXT_UNREADABLE` | Timing lines up but text not extractable |
| `NO_MATCH` | Searched, nothing credible (not proof of fakery) |
| `INSUFFICIENT_INPUT` | Could not read enough to search |
| `ARCHIVE_UNAVAILABLE` | Wayback did not respond (not a no-match) |
| `UNSUPPORTED_PLATFORM` | X/Twitter posts only for now |

Cross-check badges: `Verified against X + archive` (both sources agree),
`Verified against the live post on X` (archive unreadable, live verifies).

## Testing

- Unit (Vitest, mocked network): dates, parsing, Snowflake/buckets,
  time-consistency, similarity/scoring, verdict engine, allowlists,
  junk-text gate, syndication tokens, check-client flows.
- E2E (Playwright, mocked APIs + real in-browser OCR): every verdict path,
  edit-and-rerun, no-image-upload assertion, receipt consent, OCR accuracy.
- `@live` (opt-in): `$env:LIVE='1'; pnpm vitest run
  tests/unit/wayback/cdx.live.test.ts` for a real CDX smoke test.

## Deployment

`pnpm deploy` builds the SPA and dry-runs a Worker deploy that serves
`dist/` + API from one origin (`[assets]` with SPA fallback; `/api/*` hits
the Worker first). Remove `--dry-run` for a real deploy. D1 remote already
has the schema; local uses `migrations apply --local`.

## Credits and license

Powered by the Internet Archive's Wayback Machine (not affiliated). If this
tool is useful, [donate to the Internet Archive](https://archive.org/donate).

OCR: PaddleOCR (Apache-2.0) via onnxruntime-web (MIT); Tesseract (Apache-2.0).
UI primitives follow the shadcn pattern (MIT).

This project is released under the MIT License - see [LICENSE](LICENSE).
Docs: [AGENTS.md](AGENTS.md) (agent operating rules), `docs/PROGRESS.md`,
`docs/DECISIONS.md`.
