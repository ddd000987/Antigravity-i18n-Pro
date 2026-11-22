# Translate an Antigravity work batch (any language)

You translate the user interface of Google Antigravity, an AI coding-agent desktop app, from English. This file explains the work files that `tools/todo.js` writes; it is the same for every target language.

## Input: `todo-N.json`

```json
{
  "langs": ["ja"],
  "languageNames": { "ja": "Japanese (日本語)" },
  "styleNotes": { "ja": ["..."] },
  "glossary": { "ja": { "Agent": "エージェント" } },
  "termNotes": { "Agent": "the AI agent that carries out coding tasks for the user" },
  "keep": ["Antigravity", "MCP"],
  "items": [
    { "id": "t12", "kind": "text", "en": "Fork conversation", "note": "Menu item; near: \"Rename\", \"Delete\"" },
    { "id": "p:ui172", "kind": "pattern", "en": "Open {1} skill", "example": "Open X skill" }
  ]
}
```

- `langs`: the languages to write. When there is more than one, an item's `need` (if present) lists the only languages that still need it.
- `styleNotes`, `glossary`, `termNotes`, `keep`: only the entries relevant to this batch.
- `items[].kind`:
  - `text`: a string shown in the window. A `<>` in it stands for an inline element (a link, a key, a value) inside one sentence.
  - `menu`, `dialog`: native menu items and native dialog texts.
  - `pattern`: a string with values the app fills in. `{1}`, `{2}` … are those values; `example` is a real string it matches.
  - `valueMap`: a word the app inserts into a pattern (`note` names the map).
  - `valueRule`: one part of a duration such as `{1} days`.
  - `punct`: a punctuation mark; write the mark your language uses after text (often the same one).
- `note`: where the string appears (Button, Tooltip, Heading, …) and strings shown next to it. Use it to choose the right meaning and form (verb for buttons, short noun for tabs).

## Output: `todo-N.out.json` next to the input

One language (`langs` has one code): a flat object from id to translation.

```json
{ "t12": "会話をフォーク", "p:ui172": "{1}スキルを開く" }
```

Several languages: id to an object per language.

```json
{ "t12": { "ja": "会話をフォーク", "ko": "대화 포크" } }
```

A `pattern` whose sentence needs plural forms in your language may use an object of CLDR categories instead of a string (`zero`, `one`, `two`, `few`, `many`, `other`; `other` is required):

```json
{ "p:s40": { "one": "{1} файл", "few": "{1} файла", "many": "{1} файлов", "other": "{1} файла" } }
```

Leave out an id you cannot translate with confidence; the next `todo.js` run lists it again. Do not invent ids.

## Rules

1. Keep every `{n}` placeholder exactly as often as in `en`. You may reorder them to suit your grammar.
2. Keep every `<>` marker: the same number, in the same order relative to each other. Where `en` has no text before the first marker, between two markers or after the last one, leave that place empty too: the app has no text node there, so a translation that puts words there is never shown. Languages that put the verb last use a colon instead ("Open <>" → Japanese "開く: <>", Turkish "Aç: <>").
3. Keep leading and trailing spaces exactly as in `en`: fragments are joined with neighbouring text.
4. Use the `glossary` rendering for each listed term, inflected as your grammar requires (when it is a list, the first is preferred and the others are accepted alternatives). Read `termNotes` for the meaning: never translate a term word by word (Fork, Branch, Commit, Toast, Hooks, Dismiss, lint and Match case are software terms here).
5. Write the names in `keep` exactly as given. Also keep product, model, company and tool names, file names, commands, code, in English. Keyboard key names follow your language's convention (German Strg, Umschalt).
6. If the right translation is identical to the English (a product name, "OK" in some languages), write it unchanged; the merge records it as intentionally equal.
7. Use the conventions of major software in your language (Google, Microsoft, Apple): short, natural UI wording, consistent formality, and your language's punctuation inside sentences.
8. Do not add or drop meaning. An ellipsis (`...` or `…`) at the end stays at the end.

## Before you finish

Check with a small script: the output is valid JSON; every id exists in the input; `{n}` counts, `<>` counts and outer whitespace match `en`, and no text sits where `en` has an empty slot (rule 2). Fix and re-check until clean. Report the counts written and skipped, and any term you were unsure about.
