# Antigravity-i18n-Pro

Go/Wails tool (GUI + CLI, Windows) that patches the Antigravity desktop app's `resources\app.asar` so its interface is translated. Translation data are JSON language packs; a DOM translation engine (`assets/patches/engine.jsfrag`) applies them inside the app.

## Facts to know before touching translations

- `assets/locales/zh-TW.json` is the **reference catalog**: its text/menu/dialog keys are the English source strings, and its pattern rules' regexes are reused by every other pack (only `template` differs). It is the only pack reviewed by a native speaker; the others are machine translated.
- Language packs are 450–700 KB each. **Never read a whole pack into context.** Query them with a short `node -e` script (`tools/lib/locale.js` `loadLocale`) or use the tools below.
- Write packs only through `saveLocale` (2-space JSON, trailing newline). The repo uses `core.autocrlf=true`, so working files may be CRLF; compare content after normalising line endings.
- The Go side (`internal/core`) is the authority on pack validity: `go test ./...` must pass. It enforces `{n}` placeholders, `<>` inline-element markers, RE2-compatible regexes and `allowSourceEqual` consistency.
- `assets/catalog/notes.json` (screen-location hints per key, from `tools/ui-notes.js`) feeds exported templates and translator batches.

## Translating (see `tools/README.md` for details)

- New language or catching packs up after zh-TW changed: `tools/new-locale.js` → `tools/todo.js` (small `todo-N.json` batches, only what is missing) → translate each batch per `tools/translation-prompts/TRANSLATE.md`, one subagent per batch → `tools/merge-todo.js` (validates; `problems.json` / `review.json`) → `tools/glossary-seed.js` after the first batch → repeat until `todo.js` reports nothing.
- After a new Antigravity release ("Typical workflow after a new Antigravity release" in `tools/README.md`): `tools/cache-js.js` extracts the UI bundle from the Chromium cache; update zh-TW with the extract/sweep/sentences workflow; refresh `notes.json` with `ui-notes.js`; then **one** pass for all other packs: `todo.js <dir> --locale zh-CN,ja,ko,es,fr,de,pt-BR,ru,it,tr --size 40`, so each new string is translated once for all languages. Never run the languages one at a time.
- Briefing translator subagents ("Running the translators" in `tools/README.md`): one per batch, a mid-tier model, at most three at a time; give only the paths of `TRANSLATE.md`, `todo-N.json` and `todo-N.out.json`, tell it to open no other file, and to report only counts. Do not read the `.out.json` files yourself; read `problems.json` / `review.json` after `merge-todo.js`.
- Terminology lives in `tools/glossary/` (`terms.json` meanings, `keep.json` names kept verbatim, `<code>.json` per-language renderings and style notes). `tools/glossary-check.js` audits whole packs.
- Antigravity install: `%LOCALAPPDATA%\Programs\antigravity`; the untouched archive is `resources\app.asar.clean-backup` (patched `app.asar` and `.bak-*` copies contain our dictionaries, so do not search them for source strings).

## Tests

- `go test ./...` from the repo root; `cd tools && npm test` (engine tests, main-process fragment tests and the batch-workflow round trip).
- Keep long outputs short (`| tail`, `| grep`).

## Releasing

- Set `VERSION`, commit "Release X.Y.Z" (with `wails.json`, which `build.ps1` stamps), push `main` and an annotated tag `vX.Y.Z`. `.github/workflows/release.yml` then tests, builds and attaches the files to a **draft** release.
- Publish that draft: write the notes (English first, then Traditional Chinese; only what changed since the previous release) and run `gh release edit vX.Y.Z --notes-file <notes> --draft=false --latest`. Never `gh release create` or upload locally built files; the workflow fails if the tag already has a release.
- The `upstream` remote (wade19990814-hue/antigravity-i18n) is a different project with its own releases. Pass `--repo ddd000987/Antigravity-i18n-Pro` to `gh` when reading releases.

## Repository conventions

- Code, comments, docs, commits in English; `README.zh-TW.md` mirrors `README.md` (both list the bundled languages).
- Scratch files (extracted bundles, work batches) go outside the repository.
