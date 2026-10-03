# Vendored PaddleOCR assets (PP-OCRv5 mobile, English)

Downloaded ONCE (dev/build time) from free sources, served same-origin under
`/paddle/`, cached by the browser. Screenshot pixels are OCR'd fully
on-device via onnxruntime-web (WASM); nothing ever leaves the device.

## Files

| File         | Source (HuggingFace `OllmOne/PP-OCRv5`, Apache-2.0)                     | Bytes   |
| ------------ | ----------------------------------------------------------------------- | ------- |
| `det.onnx`   | `pp-ocrv5_mobile_det.onnx` — PP-OCRv5 mobile DB detection (language-agnostic) | 4,826,518 |
| `en_rec.onnx`| `en_pp-ocrv5_mobile_rec.onnx` — PP-OCRv5 mobile English recognition (SVTR-style, CTC) | 7,876,014 |
| `en_dict.txt`| `ppocrv5_en_dict.txt` — 436-char English charset (index `i+1`; `0` = CTC blank, `437` = SPACE appended by training with `use_space_char: true`, so the head emits 438 classes). Includes `-` and `@` | 1,416 |

Total ≈ 12.4 MB — each file well under the Cloudflare 25 MiB single-file limit.

Raw URLs (`main` pinned by content hash at download time):

- https://huggingface.co/OllmOne/PP-OCRv5/resolve/main/pp-ocrv5_mobile_det.onnx
- https://huggingface.co/OllmOne/PP-OCRv5/resolve/main/en_pp-ocrv5_mobile_rec.onnx
- https://huggingface.co/OllmOne/PP-OCRv5/resolve/main/ppocrv5_en_dict.txt

Upstream training: PaddlePaddle PaddleOCR (Apache-2.0). Converter: third-party
`paddle2onnx` export mirrored on HuggingFace (no official PaddlePaddle `.onnx`
release exists; the PaddlePaddle org only ships Paddle static-graph models).

## Fallback considered (not vendored)

`SWHL/RapidOCR` (Apache-2.0, widely mirrored, documented):

- `PP-OCRv4/ch_PP-OCRv4_det_infer.onnx` (4,745,517 bytes)
- `PP-OCRv3/en_PP-OCRv3_rec_infer.onnx` (8,967,018 bytes — no EN v4 rec
  exists in that repo; EN v4 rec only via `xberg-io` conversions)

PP-OCRv5 mobile EN was preferred: newer, smaller total (~12.4 MB vs ~13.7 MB),
English-specific rec head with hyphen/`@` coverage.

## onnxruntime-web WASM (companion, same-origin)

`onnxruntime-web@1.19.0` (MIT) is a lazy JS chunk (dynamic `import()` only —
never in the first-load bundle). Its WASM binary is emitted by vite into
`dist/assets/` from the npm package and served same-origin, so OCR works
offline and no CDN is involved at runtime. Execution is pinned to
`numThreads = 1` (single-threaded, no COOP/COEP requirement).

Version note: ORT ≥ 1.22 defaults to a ~28MB JSEP build (breaks the 25MiB
single-file deploy limit) and its extern-wasm variant cannot load its `.mjs`
glue under the vite dev server; 1.19.0's default bundle references the
classic ~10.5MB threaded SIMD build instead. Measured during track
development — see `docs/DECISIONS.md`.
