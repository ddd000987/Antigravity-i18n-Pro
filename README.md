# Antigravity-i18n-Pro

English | [繁體中文](./README.zh-TW.md)

> **Fork of [wade19990814-hue/antigravity-i18n](https://github.com/wade19990814-hue/antigravity-i18n).**
> Differences from the original:
>
> - **Taiwan Traditional Chinese (`zh-TW`)** pack written with Taiwan terminology, and the default language: 4,005 strings, 619 dynamic rules and 11 value maps, made for Antigravity 2.34.0.
> - The original `zh-Hant` pack (Traditional characters with mainland wording) is removed; `zh-Hant`, `zh-HK` and `zh-MO` resolve to `zh-TW`.
> - **Sentence layer** in the translation engine: sentences React splits across text pieces and inline elements (links, code, keys) are joined with `<>` markers and translated as a whole, with `scope: "sentence"` rules for the dynamic ones. Results are cached.
> - **Antigravity 2.33+ support**: a new anchor for Chromium's `--lang` switch, which the original could no longer place.
> - **Your own language files**: export a translation template, check a file (JSON errors, `{n}` placeholders and `<>` markers, each reported with its line), apply it, and see the translation progress.
> - **Update template**: merges the strings a new Antigravity release adds into your file and marks them, without touching what you already translated.
> - **Remembers the last language** (bundled or your own file) and offers to reapply it when an Antigravity update has put the English build back; `reapply` does the same from the command line.
> - The tool window is available in English, Traditional Chinese and Simplified Chinese, and follows the system language.
> - Maintenance scripts used to build the translation are included in [`tools/`](./tools/README.md).
> - The other bundled packs (de, es, fr, ja, ko, pt-BR, ru, zh-CN) are the original's, unchanged; they cover about 55% of the strings in Antigravity 2.34.
> - The executable is `antigravity-i18n-pro.exe`, versioned from 1.0.0.

Interface localization tool for the [Google Antigravity](https://antigravity.google/) desktop app on **Windows**. One executable with a window and a command line, no Node.js or other runtime needed.

## Features

- **Single executable**: GUI by default, full CLI in the same file.
- **Byte-exact restore**: a pristine `app.asar.clean-backup` is kept before anything changes, and restoring brings back an archive identical (SHA-256) to the official release.
- **Touches only the interface shell**: the app's own UI, native menus and the quit dialog. The code editor (Monaco), terminals (xterm) and AI conversation content are left alone.
- **Checked and transactional**: generated JavaScript is syntax-checked before it is written, and any failure rolls back.
- **Offline**: no network access, no data collection.

## Usage

### Window

Run `antigravity-i18n-pro.exe`:

1. The Antigravity installation is detected automatically ("Change location" to pick it yourself).
2. Pick a language. **English** restores the official build.
3. Click apply. Antigravity has to be closed for this: the tool asks it to quit, waits up to 30 seconds and then closes it, so save your work first. Antigravity is started again afterwards.

The tool's own language can be changed in the top-right corner.

### After an Antigravity update

Every Antigravity update replaces `app.asar`, which removes the translation. The tool remembers what you applied last: open it after an update and it offers to apply the same language (or your own file) again. From the command line:

```powershell
antigravity-i18n-pro.exe reapply             # apply the last language again
antigravity-i18n-pro.exe reapply --if-needed # only if an update removed it
```

### Command line

```powershell
antigravity-i18n-pro.exe status                  # current state and backups
antigravity-i18n-pro.exe apply                   # install zh-TW (the default)
antigravity-i18n-pro.exe apply --locale ja       # install another bundled pack
antigravity-i18n-pro.exe restore                 # back to the official English build
antigravity-i18n-pro.exe locales                 # bundled packs and their coverage
```

Options: `--app-dir <path>` (installation folder), `--no-restart`, `--force` (close Antigravity without the graceful wait), `--timeout <ms>`, `--yes` (skip the confirmation). `tw` is short for `apply --locale zh-TW`, `en` for `restore`.

## Your own language file

Any language can be added without rebuilding the tool.

1. **Export a template**: "Export template" in the window, or

   ```powershell
   antigravity-i18n-pro.exe export-template --out my-language.json
   antigravity-i18n-pro.exe export-template --out tweak-zh-TW.json --from zh-TW   # start from a bundled pack
   ```

   The template lists every English string with an empty translation. `notes` says where each one appears on screen (for example *Button; near: "Cancel", "Save changes"*).

2. **Translate**: set `language` (such as `fr`) and `name` (such as `Français`), then fill in what you want. Anything left empty stays English, so a partial file already works.
   - Keep every `{1}`, `{2}` … placeholder and every `<>` marker (an inline element such as a link or a key, in its original order).
   - Strings with values (`patterns`) show an `example` and the English `source` with placeholders; you only write `template`. Regular expressions are never part of the template. Languages with plural forms can use `templates` with CLDR categories (`one`, `few`, `many`, `other`).

3. **Check and apply**: "Load language file" in the window shows the progress and every problem with its line number before anything is applied. Or:

   ```powershell
   antigravity-i18n-pro.exe check --locale-file my-language.json
   antigravity-i18n-pro.exe apply --locale-file my-language.json
   ```

4. **After an Antigravity update**: "Update template", or

   ```powershell
   antigravity-i18n-pro.exe update-template --locale-file my-language.json
   ```

   New strings are added empty and listed under `newEntries` (their notes start with `[NEW]`); your translations are kept, strings the new release no longer shows are listed under `obsoleteEntries`, and the previous file is saved next to it as `.bak-<time>`.

## Bundled languages

| Code | Language | Strings of Antigravity 2.34 covered |
| :--- | :--- | :--- |
| `zh-TW` | 繁體中文（台灣） Traditional Chinese (Taiwan) | 100% |
| `zh-CN` | 简体中文 Simplified Chinese | 55% |
| `ja` | 日本語 Japanese | 55% |
| `ko` | 한국어 Korean | 55% |
| `de` | Deutsch | 55% |
| `es` | Español | 55% |
| `fr` | Français | 55% |
| `pt-BR` | Português do Brasil | 55% |
| `ru` | Русский | 55% |
| `en` | English | official build (select to restore) |

Untranslated strings stay in English.

## Files the tool leaves behind

- `resources\app.asar.clean-backup`: the official archive restore needs. **Do not delete it.**
- `resources\app.asar.bak-*`: timestamped safety copies; delete them once the current state works.
- `%APPDATA%\Antigravity-i18n-Pro\settings.json`: the last language applied and the window language.

## Building from source

Requirements: Go 1.26+ and the [Wails v2](https://wails.io/) CLI (`go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0`).

```powershell
.\build.ps1          # GUI: build\bin\antigravity-i18n-pro.exe, CLI: build\bin\antigravity-i18n-pro-cli.exe
go test ./...

# Also patch a copy of a real archive (the installation is not touched):
$env:ANTIGRAVITY_ASAR = "$env:LOCALAPPDATA\Programs\antigravity\resources\app.asar.clean-backup"
go test ./...
```

Updating the translation for a new Antigravity release is described in [`tools/README.md`](./tools/README.md).

## Disclaimer

1. This is an unofficial community project, not affiliated with or endorsed by Google or Antigravity.
2. Google Antigravity and related trademarks belong to their owners.
3. For personal and educational use; follow the terms of the software you modify.

## License

[MIT](./LICENSE). Original work © antigravity-i18n Contributors.
