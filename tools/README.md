# Maintenance tools

Node scripts for keeping the translations in `assets/locales/` up to date when a new Antigravity release ships, and for testing the DOM translation engine (`assets/patches/engine.jsfrag`). They are developer tools: the Go application does not need them.

```
cd tools
npm install        # once; node_modules is git-ignored
npm test           # engine tests and the batch-workflow round trip (engine.test.js, todo.test.js)
```

Node 18 or newer. The bundle scripts parse a 12 MB minified file with acorn and recurse deeply, so run those as `node --stack-size=8000 <script>` (shown in each usage line).

## Conventions

- Scripts that read or write a locale take an optional `--locale <code|path>`. A bare code (`zh-TW`) means `assets/locales/<code>.json`; anything with a path separator or ending in `.json` is read as a file. The default is `zh-TW`.
- Scripts that **modify the locale in place** (`merge*.js`, `order-rules.js`, and the historical scripts in `archive/`) rewrite the file they are pointed at. Work on a copy with `--locale <copy.json>` when experimenting, or rely on git to review the diff.
- Every script prints a usage line and exits 1 when required arguments are missing; `--help` prints it and exits 0.
- Shared helpers live in `lib/`: `lib/locale.js` (`repoRoot`, `loadLocale`, `saveLocale`, `buildPreloadFragment`, which mirrors `buildPreloadFragment` in `internal/core/locale.go`), `lib/cli.js` (argument parsing) and `lib/catalog.js` (the zh-TW reference catalog, the placeholder checks and the glossary helpers used by the batch workflow).
- `translation-prompts/` holds the instructions given to the translators (people or models) for each kind of work file: `INSTRUCTIONS.md` (batches), `GAP-INSTRUCTIONS.md`, `SWEEP-INSTRUCTIONS.md`, `SENTENCE-INSTRUCTIONS.md`, and `TRANSLATE.md` (the language-neutral `todo-N.json` files of the batch workflow below).
- `glossary/` holds the terminology shared by all languages: `terms.json` (terms with their meaning in Antigravity), `keep.json` (names every language keeps verbatim) and one `<code>.json` per language (`notes` for style and `terms` with the language's rendering of each term: a string, or a list of accepted renderings with the preferred one first). A term marked `"check": false` in `terms.json` (verbs that inflect, words with several senses) is still given to translators but not checked.
- `examples/2.34/` is a historical, end-to-end example of patching the 2.34 release (see the end of this file).

## Batch workflow: adding a language or catching up after a release

The catalog of what a language pack must contain is zh-TW (`assets/locales/zh-TW.json`): its keys are the English source strings and its pattern rules are the regexes every language reuses. `todo.js` compares a pack with the catalog and writes only what is missing, in small files (400 items by default, about 70 KB each; fewer, larger batches spend less on each translator's fixed start-up cost), so a translator never needs a whole 500 KB locale file. `merge-todo.js` validates the translations and puts them back. The work-file format is described in `translation-prompts/TRANSLATE.md`.

**New language**

1. `node new-locale.js <code> --name <native name> --english-name <English name>` creates the empty pack and a glossary stub. (The Go side rejects a pack without any text, so run `go test` only after the first merge.)
2. `node todo.js <dir> --locale <code>` writes `<dir>/todo-N.json` and `manifest.json`. Use a new folder for every run; `--dry` only prints the counts.
3. Translate each `todo-N.json` into `todo-N.out.json` following `translation-prompts/TRANSLATE.md`, for example one model subagent per batch. The first batch starts with the glossary terms.
4. `node merge-todo.js <dir>` writes the valid translations and runs `order-rules.js` on the pack. Read `<dir>/problems.json` (rejected: wrong `{n}` or `<>`, whitespace, bad plural object, unknown id) and `<dir>/review.json` (written but suspicious: equal to English, lost keep name, glossary term not used, lost ellipsis), fix them and merge again; the merge is idempotent.
5. After the first batch is merged, `node glossary-seed.js --locale <code>` fills `glossary/<code>.json` from the pack's own renderings of the terms (edit the `notes` there: formality, punctuation, regional vocabulary). Later batches then carry the glossary. Re-run `todo.js` in a new folder for the items that are still missing (rejected ones and ones the translator skipped) until it reports nothing to translate.
6. `node glossary-check.js --locale <code>` for terminology the pack uses inconsistently, `lint.js` and `patcheck.js` where they apply to the language, then `go test ./...` from the repository root.

**Fixing an existing pack**

`node glossary-check.js` lists, per pack and term, translations that do not use the glossary rendering or lost a name from `keep.json` (for example a translated "Antigravity"). To redo such entries, delete their values from the pack: `todo.js` then lists them again, and the new batch carries the glossary.

**After a new Antigravity release**

Update zh-TW first with the workflow above (it defines the catalog), then run `node todo.js <dir> --locale zh-CN,ja,ko,es,fr,de,pt-BR,ru`. Each new string is sent once for all languages (an item's `need` lists the languages that lack it), and one translator writes all languages for it. Merge with `merge-todo.js` as above.

## Where things live on Windows

| What | Where |
| --- | --- |
| Antigravity install | `%LOCALAPPDATA%\Programs\antigravity` (the patched archive is `resources\app.asar`) |
| React UI bundle | Served by `resources\bin\language_server.exe` and cached by Chromium in `%APPDATA%\antigravity\Cache\Cache_Data`. The `f_*` files that start with a gzip header contain it; the largest decompressed one (about 12 MB) is `main.js`. `cache-js.js` extracts them all; `ungz.js` extracts the gzip members of a single file. |
| Other UI code | The Swarm board is plain JavaScript in small uncompressed cache files (`f_*` that start with `/*`); `ui-notes.js` accepts them as extra bundles. Font files (`wOF2`) can be ignored. |
| Marketplace plugin descriptions | `~/.gemini/antigravity/cache/marketplaces/<name>/marketplace.json` |

The cache can hold several versions of the bundle (the file modification time tells which is newest; the new release has strings the old one lacks). Open the app once after updating so the new bundle is cached.

## Typical workflow after a new Antigravity release

1. **Get the bundle.** Run Antigravity once, then `node cache-js.js scratch/js` extracts every distinct JavaScript file from the Chromium cache, largest first with its date. The newest file of about 12 MB is `main.js` (the cache can still hold the previous release's bundle too). Keep scratch files outside the repository.
2. **Find the gaps.** `extract.js` (UI props and children), `sweep.js` (every sentence-like literal) and `sentences.js` (sentences split across elements) list what the locale does not cover. `splits.js`, `server-copy.js` and `server-names.js` give extra views; `gap.js`/`overlap.js` compare with another project's dictionary.
3. **Translate.** Turn the work files into batches (`batches.js`, or the sweep/gap files directly) and translate them following `translation-prompts/*.md`. The result files are `batch-N.out.json`, `sweep-N.out.json`, `gap-N.out.json` and `sent-N.out.json`.
4. **Merge.** `merge.js`, `merge-sweep.js`, `merge-gap.js`, `merge-sent.js` add the translations to the locale and warn about suspicious values.
5. **Order the rules.** `order-rules.js` puts the pattern rules in their final order so none is shadowed. Always run it after merging.
6. **Lint.** `lint.js` (terminology, punctuation, Mainland vocabulary) and `patcheck.js` (pattern rules). `gloss.js` shows glossary consistency.
7. **Engine tests.** `npm test`, then `node sent-e2e.js <trDir>` to check that every split sentence renders translated in jsdom, and `node bench.js` for timing.
8. **Go tests.** From the repository root: `go test ./...`. The Go side is the authority on locale validity (including RE2 compatibility of every pattern), so a locale is only done when it passes there.
9. **Refresh the screen-location hints** with `ui-notes.js` (below) so the exported translation template stays accurate.

## Scripts

### lib/locale.js, lib/cli.js, lib/catalog.js

Helpers, not run directly. `loadLocale('zh-TW')`, `saveLocale(codeOrPath, locale)`, `buildPreloadFragment(locale, enginePath?)`; `loadCatalog()`, `findMissing(locale, catalog)` and the glossary helpers (`loadGlossary`, `termHits`, `keepHits`).

### new-locale.js, todo.js, merge-todo.js, glossary-seed.js, glossary-check.js

The batch workflow described above.
`node new-locale.js <code> --name <native name> --english-name <English name> [--dir ltr|rtl] [--html-lang <tag>]` creates an empty pack and `glossary/<code>.json`.
`node todo.js <outDir> --locale <code|path>[,...] [--size 400] [--kinds text,menu,dialog,pattern,valueMap,valueRule] [--dry]` lists what the packs lack versus zh-TW (kind `punct` only when named) and writes `todo-N.json` and `manifest.json`.
`node merge-todo.js <outDir> [--no-order]` merges `todo-N.out.json`, writing `problems.json` and `review.json`.
`node glossary-seed.js --locale <code[,...]|all> [--force]` records each pack's rendering of the glossary terms; existing notes and terms are kept unless `--force`.
`node glossary-check.js [--locale <code[,...]|all>] [--term <en>] [--limit 20]` audits whole packs with the same glossary and keep checks `merge-todo.js` applies to new translations.
`todo.test.js` (part of `npm test`) is the round-trip test.

### cache-js.js

Extracts every distinct JavaScript file from the Chromium cache (gzip members decompressed, fonts and duplicates skipped), largest first with its date.
`node cache-js.js <outDir> [--cache <Cache_Data dir>] [--min 2000]`
Pass all of the output to `ui-notes.js`, and the newest large one (`main.js`) to `extract.js`, `sweep.js` and `sentences.js`.

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

`archive/` holds `fix.js`, `fix-escapes.js`, `greet.js` and `tune-sentence.js`, one-time patches from earlier releases, kept as templates for similar clean-ups. They contain release-specific data, so read them before running; each modifies the locale in place.

## examples/2.34

`examples/2.34/tr234` and `examples/2.34/tr234b` are the scripts that patched the 2.34 release end to end: building the work files from the extract/sweep deltas and the marketplace cache, hand-written translations, review fixes, validation, narrow short rules, and the split-sentence translations (`tr234/sent`). They are historical examples of the workflow above, with their data files turned into arguments; each prints its usage when run without arguments.
