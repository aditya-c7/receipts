# Receipts

> Drop a screenshot of an X post and find its archived original — with on-device OCR, Wayback lookup, and live-X triangulation.

[![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=111827&style=flat-square)](https://react.dev/)
[![Vite 5](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white&style=flat-square)](https://vitejs.dev/)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white&style=flat-square)](https://tailwindcss.com/)
[![TypeScript 5 Strict](https://img.shields.io/badge/TypeScript-5_Strict-3178C6?logo=typescript&logoColor=white&style=flat-square)](https://www.typescriptlang.org/)

[![Hono 4](https://img.shields.io/badge/Hono-4-E36002?logo=hono&logoColor=white&style=flat-square)](https://hono.dev/)
[![Cloudflare Workers + D1](https://img.shields.io/badge/Cloudflare_Workers_%2B_D1-F48120?logo=cloudflare&logoColor=white&style=flat-square)](https://workers.cloudflare.com/)
[![Upstash Redis](https://img.shields.io/badge/Upstash_Redis-00E9A3?logo=redis&logoColor=white&style=flat-square)](https://upstash.com/)
[![PaddleOCR v5](https://img.shields.io/badge/PaddleOCR-v5-0062B0?style=flat-square)](https://github.com/PaddlePaddle/PaddleOCR)
[![ONNX Runtime 1.19](https://img.shields.io/badge/ONNX_Runtime-1.19-005CED?logo=onnx&logoColor=white&style=flat-square)](https://onnxruntime.ai/)
[![Tesseract.js 5](https://img.shields.io/badge/Tesseract.js-5-5A5A5A?style=flat-square)](https://tesseract.projectnaptha.com/)

[![Vitest](https://img.shields.io/badge/Vitest-2-6E9F18?logo=vitest&logoColor=white&style=flat-square)](https://vitest.dev/)
[![Playwright E2E](https://img.shields.io/badge/Playwright-E2E-2EAD33?logo=playwright&logoColor=white&style=flat-square)](https://playwright.dev/)
[![pnpm 9](https://img.shields.io/badge/pnpm-9-F69220?logo=pnpm&logoColor=white&style=flat-square)](https://pnpm.io/)
[![License MIT](https://img.shields.io/badge/License-MIT-22C55E?style=flat-square)](https://opensource.org/licenses/MIT)
[![CI](https://img.shields.io/github/actions/workflow/status/aditya-c7/receipts/ci.yml/CI?branch=main&logo=githubactions&logoColor=white&style=flat-square)](https://github.com/aditya-c7/receipts/actions/workflows/ci.yml)

## Why it is interesting

- **Private by design:** OCR runs in the browser, so receipt images and extracted text do not need to leave the device.
- **Archive-first search:** A Snowflake timestamp inferred from a post URL narrows Wayback queries to the relevant capture window.
- **Evidence triangulation:** Archive results, live-X data, and extracted screenshot text are compared to surface the strongest match.

## Tech stack

| Area | Choice | Version | Purpose |
| --- | --- | --- | --- |
| Frontend | React, Vite, Tailwind CSS, TypeScript | 18, 5, 4, 5 | Fast, typed browser experience |
| Edge API | Hono on Cloudflare Workers | 4 | Lightweight edge endpoints and integrations |
| Data | Cloudflare D1, Upstash Redis | — | Persistent lookup data and rate-limit/cache support |
| OCR | PaddleOCR, ONNX Runtime, Tesseract.js | v5, 1.19, 5 | On-device text extraction with fallback engines |
| Quality | Vitest, Playwright, GitHub Actions | — | Unit tests, end-to-end coverage, and continuous integration |

## Architecture

```mermaid
flowchart LR
    U[User screenshot] --> B[Browser: React + TypeScript]
    B --> O[On-device OCR\nPaddleOCR / ONNX / Tesseract.js]
    B --> W[Cloudflare Worker\nHono API]
    W --> D[(Cloudflare D1)]
    W --> R[(Upstash Redis)]
    W --> A[Wayback Machine]
    W --> X[Live X sources]
    O --> M[Match and evidence view]
    A --> M
    X --> M
    subgraph Privacy boundary
      B
      O
    end
```

Receipt images and OCR output remain in the browser; the edge layer receives lookup inputs only.

## How it works

1. Upload or paste a screenshot containing an X post.
2. Run OCR locally to identify post text, usernames, timestamps, and URLs.
3. Query archive and live sources through the Worker, then rank candidate matches.
4. Review the matched post alongside its supporting archive and live evidence.

## Privacy

| Data | Handling |
| --- | --- |
| Screenshot image | Processed locally in the browser |
| OCR text | Kept client-side for matching unless explicitly used in a lookup |
| External queries | Sent only to the sources required for archive/live verification |

## Quick start

**Requirements:** Node.js 20+, pnpm 9+, and a Cloudflare account for Worker/D1 bindings.

```bash
git clone https://github.com/aditya-c7/receipts.git
cd receipts
pnpm install
cp .env.example .env
cp .dev.vars.example .dev.vars
pnpm dev
```

On Windows, use `host-local.cmd` to start the local hosting flow configured by the project.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the Vite development server |
| `pnpm build` | Create a production build |
| `pnpm preview` | Preview the production build locally |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run Vitest tests |
| `pnpm test:e2e` | Run Playwright end-to-end tests |

## Live testing

Run the local app with valid environment bindings, upload a representative screenshot, and verify that the returned evidence links resolve before relying on a match.

## Credits and license

Built by [Aditya C](https://github.com/aditya-c7). Licensed under the [MIT License](LICENSE).
