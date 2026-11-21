# Maintenance tools

Node scripts for keeping the translations in `assets/locales/` up to date when a new Antigravity release ships, and for testing the DOM translation engine (`assets/patches/engine.jsfrag`). They are developer tools: the Go application does not need them.

```
cd tools
npm install        # once; node_modules is git-ignored
npm test           # engine tests (node engine.test.js)
```

Node 18 or newer. The bundle scripts parse a 12 MB minified file with acorn and recurse deeply, so run those as `node --stack-size=8000 <script>` (shown in each usage line).

## Conventions

- Scripts that read or write a locale take an optional `--locale <code|path>`. A bare code (`zh-TW`) means `assets/locales/<code>.json`; anything with a path separator or ending in `.json` is read as a file. The default is `zh-TW`.
- Scripts that **modify the locale in place** (`merge*.js`, `order-rules.js`, and the historical `fix*.js`, `greet.js`, `tune-sentence.js`) rewrite the file they are pointed at. Work on a copy with `--locale <copy.json>` when experimenting, or rely on git to review the diff.
- Every script prints a usage line and exits 1 when required arguments are missing; `--help` prints it and exits 0.
- Shared helpers live in `lib/`: `lib/locale.js` (`repoRoot`, `loadLocale`, `saveLocale`, `buildPreloadFragment`, which mirrors `buildPreloadFragment` in `internal/core/locale.go`) and `lib/cli.js` (argument parsing).
- `translation-prompts/` holds the instructions given to the translators (people or models) for each kind of work file: `INSTRUCTIONS.md` (batches), `GAP-INSTRUCTIONS.md`, `SWEEP-INSTRUCTIONS.md`, `SENTENCE-INSTRUCTIONS.md`.
- `examples/2.34/` is a historical, end-to-end example of patching the 2.34 release (see the end of this file).

## Where things live on Windows

| What | Where |
| --- | --- |
| Antigravity install | `%LOCALAPPDATA%\Programs\antigravity` (the patched archive is `resources\app.asar`) |
| React UI bundle | Served by `resources\bin\language_server.exe` and cached by Chromium in `%APPDATA%\antigravity\Cache\Cache_Data`. The `f_*` files that start with a gzip header contain it; the largest decompressed one (about 12 MB) is `main.js`. `ungz.js` extracts gzip members. |
| Other UI code | The Swarm board is plain JavaScript in small uncompressed cache files (`f_*` that start with `/*`); `ui-notes.js` accepts them as extra bundles. Font files (`wOF2`) can be ignored. |
| Marketplace plugin descriptions | `~/.gemini/antigravity/cache/marketplaces/<name>/marketplace.json` |

The cache can hold several versions of the bundle (the file modification time tells which is newest; the new release has strings the old one lacks). Open the app once after updating so the new bundle is cached.

## Typical workflow after a new Antigravity release

1. **Get the bundle.** Run Antigravity once, then extract the newest large gzip file from the Chromium cache:
   `node ungz.js "%APPDATA%\antigravity\Cache\Cache_Data\f_XXXXXX" scratch/bundle` and keep the largest `blob-NNN.bin` as `main.js`. Keep scratch files outside the repository.
2. **Find the gaps.** `extract.js` (UI props and children), `sweep.js` (every sentence-like literal) and `sentences.js` (sentences split across elements) list what the locale does not cover. `splits.js`, `server-copy.js` and `server-names.js` give extra views; `gap.js`/`overlap.js` compare with another project's dictionary.
3. **Translate.** Turn the work files into batches (`batches.js`, or the sweep/gap files directly) and translate them following `translation-prompts/*.md`. The result files are `batch-N.out.json`, `sweep-N.out.json`, `gap-N.out.json` and `sent-N.out.json`.
4. **Merge.** `merge.js`, `merge-sweep.js`, `merge-gap.js`, `merge-sent.js` add the translations to the locale and warn about suspicious values.
5. **Order the rules.** `order-rules.js` puts the pattern rules in their final order so none is shadowed. Always run it after merging.
6. **Lint.** `lint.js` (terminology, punctuation, Mainland vocabulary) and `patcheck.js` (pattern rules). `gloss.js` shows glossary consistency.
7. **Engine tests.** `npm test`, then `node sent-e2e.js <trDir>` to check that every split sentence renders translated in jsdom, and `node bench.js` for timing.
8. **Go tests.** From the repository root: `go test ./...`. The Go side is the authority on locale validity (including RE2 compatibility of every pattern), so a locale is only done when it passes there.
9. **Refresh the screen-location hints** with `ui-notes.js` (below) so the exported translation template stays accurate.

## Scripts

### lib/locale.js, lib/cli.js

Helpers, not run directly. `loadLocale('zh-TW')`, `saveLocale(codeOrPath, locale)`, `buildPreloadFragment(locale, enginePath?)`.

### ungz.js

Finds gzip members embedded in a binary and writes each decompressed blob.
`node ungz.js <binary> <outDir>` writes `<outDir>/blob-NNN.bin` and prints offset, size and a preview. Works on Chromium cache files and on `language_server.exe`.

### extract.js

Collects user-visible English strings that the locale does not cover yet, from React `createElement`/`jsx` children, UI-ish props (`title`, `placeholder`, `aria-label`, ...) and return statements.
`node --stack-size=8000 extract.js <out.json> <bundle.js>... [--locale <code|path>]`
Output: `{ strings, templates }` with usage kinds and code context.

### batches.js

Splits the output of `extract.js` into translation batches.
`node batches.js <missing.json> <outDir> [nBatches]` (default 4) writes `batch-N.json`.

### sweep.js

Broad sweep: every sentence-like string or template literal not covered by the locale, wherever it sits. Skips developer-only text (thrown errors, logging).
`node --stack-size=8000 sweep.js <bundle.js> <out.json> [--locale <code|path>]`
Output: `[{ en, type, pos, context }]`; translate following `SWEEP-INSTRUCTIONS.md` into `sweep-N.out.json`.

### sentences.js

Finds React elements whose sentence is split across several children (text pieces, inline elements, dynamic values) and writes the joined form the engine's sentence layer will see.
`node --stack-size=8000 sentences.js <bundle.js> <out.json> [--locale <code|path>]`
Output: `sentences.json`; translate following `SENTENCE-INSTRUCTIONS.md` into `sent-N.out.json`.

### splits.js

Counts split sentences and how many have all their English pieces in the dictionary.
`node --stack-size=8000 splits.js <bundle.js> [--locale <code|path>]`

### server-copy.js, server-names.js

Print UI copy shipped inside the language server's feature-flag JSON (onboarding role cards, suggestion chips, marketplace categories), which the bundle receives at runtime. `server-names.js` lists the short single-word names that `server-copy.js` filters out. `OK` marks covered strings, `--` missing ones.
`node server-copy.js <language_server.exe> [--locale <code|path>]`

### gap.js, overlap.js

Compare the locale with another dictionary (for example a sibling project's zh-Hant file): `gap.js` lists the other dictionary's keys that occur in the bundle but are missing here (with the other rendering as a reference, split into `gap-1.json`/`gap-2.json`); `overlap.js` prints key overlap statistics.
`node gap.js <other-dictionary.json> <bundle.js> <outDir> [--locale ...]`
`node overlap.js <other-dictionary.json> <bundle.js> [--locale ...]`

### merge.js, merge-sweep.js, merge-gap.js, merge-sent.js

Merge translated files into the locale (in place), normalise terminology (zh-TW term tables), guard short generic templates, and report anything suspicious.
`node merge.js <trDir> [--locale ...]` reads `batch-N.out.json`; `merge-sweep.js` reads `sweep-N.out.json`; `merge-gap.js` reads `gap-N.out.json`; `merge-sent.js` reads `sent-N.out.json` plus `sentences.json`.

### order-rules.js

Final order of the pattern rules: specific sentence rules, per-node rules, short sentence rules, then a shadowing pass. Idempotent.
`node order-rules.js [--locale ...]`

### lint.js

Quality report for a Traditional Chinese dictionary: Mainland terms and simplified characters (OpenCC), 你/您, whitespace and ellipsis drift, half-width punctuation, near-duplicate keys, glossary consistency; optionally a comparison with another dictionary.
`node lint.js [--locale ...] [--upstream <other-dictionary.json>]`

### patcheck.js

Checks pattern rules: own sample matches, shadowing, rules that also match dictionary keys, rules with very short fixed text.
`node patcheck.js [--locale ...]`

### gloss.js

Counts how each glossary term (Agent, Workspace, Sandbox, ...) is rendered across the dictionary. The term table is for zh-TW.
`node gloss.js [--locale ...]`

### to-tw.js

Bulk-replaces unambiguous Mainland terms in the values of a Traditional Chinese dictionary and stamps it as zh-TW.
`node to-tw.js <source-dictionary.json> <out.json>`

### engine.test.js, sent-e2e.js, sent-e2e-all.js, bench.js

Engine tests and benchmarks in jsdom, using the real `engine.jsfrag` and locale data.
`npm test` (or `node engine.test.js`); `node sent-e2e.js <trDir> [--locale ...]` (`sent-e2e-all.js` lists every failing sentence instead of the first 25); `node bench.js [--locale ...] [--engine <engine.jsfrag>]`.

### ui-notes.js

Builds `assets/catalog/notes.json`, the screen-location hints for the "export translation template" feature: for each English key that occurs as a string literal in the bundle, how it is used (Button, Tooltip, Input placeholder, Heading, ...) and up to three other known strings that sit next to it in the same component.
`node --stack-size=8000 ui-notes.js <bundle.js>... [--locale zh-TW] [--out ../assets/catalog/notes.json] [--app-version 2.34.0]`
Pass `main.js` plus any extra JavaScript cache blobs (the Swarm board files). Keys not found in a bundle (native menus, dialogs, strings that no longer exist) are simply omitted.

### Historical one-off scripts

`fix.js`, `fix-escapes.js`, `greet.js` and `tune-sentence.js` are one-time patches from earlier releases, kept as templates for similar clean-ups. They contain release-specific data, so read them before running; each modifies the locale in place.

## examples/2.34

`examples/2.34/tr234` and `examples/2.34/tr234b` are the scripts that patched the 2.34 release end to end: building the work files from the extract/sweep deltas and the marketplace cache, hand-written translations, review fixes, validation, narrow short rules, and the split-sentence translations (`tr234/sent`). They are historical examples of the workflow above, with their data files turned into arguments; each prints its usage when run without arguments.
