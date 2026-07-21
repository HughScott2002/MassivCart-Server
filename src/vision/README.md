# vision

Image → validated `ReceiptData`, provider-agnostic. This folder is a lib: it
imports nothing from the rest of the app except the shared `lib/result` and
`lib/assert` primitives. The app wires it up in one place (`src/api/receipt.ts`).

```
upload ──▶ extractReceipt(upload, analyze, log?) ──▶ Result<ReceiptData, VisionError>
                          │
                          └─ analyze: AnalyzeImage — the ONLY provider contract:
                             (system, prompt, image, maxTokens, jsonSchema?) → Result<string>
```

- `extract.ts` — orchestration: assertions, bounded retry, parse, postconditions
- `prompt.ts` — the extraction prompt + the JSON schema (one contract, co-located)
- `receipt.ts` — `ReceiptData` types, zod validation, normalization
- `openrouter.ts` — the one `AnalyzeImage` implementation (OpenRouter, timeout-bounded)
- `types.ts` — provider contract + `VisionError` union

## Rules (TigerStyle)

- Expected failures return `Result`; only programmer errors throw (via `assert`).
- Limits on everything: request timeout, retry count, item count, image bytes,
  logged/error string lengths. No unbounded anything.
- `VisionError.retryable` is the escalation-policy input: provider trouble is
  retryable, model garbage is not. A future tier system keys off this.
- No `process.env` reads in this folder — config is injected by the caller.

## Work on it standalone

```sh
OPENROUTER_API_KEY=... npx tsx scripts/vision-extract.ts path/to/receipt.jpg
node --import tsx --test tests/vision.test.ts   # offline, fake analyzer
```

Swapping/adding a model = one new `AnalyzeImage` implementation. Model id is
config (`OPENROUTER_MODEL`), default `google/gemini-3-flash-preview`.
