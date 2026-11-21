# Last sweep: decide and translate remaining strings (zh-TW, Taiwan usage)

Read `INSTRUCTIONS.md` and `GAP-INSTRUCTIONS.md` first; their translation rules, glossary
and "Extra glossary" apply. This file defines the input and what to skip.

## Input
`sweep-N.json`: array of `{ en, type: "string"|"template", context }`. These are every
sentence-like string literal left in the Antigravity React bundle that the dictionary does
not cover yet. They were found by a broad scan, so **many are not UI text**. `context` is
the minified code around the literal; judge each item from it.

## Output
`sweep-N.out.json` (same N), UTF-8, 2-space indent, the same shape as INSTRUCTIONS.md:
```json
{ "strings": { "<en>": "<zh-TW>" }, "templates": { "<en with {1}>": "<zh-TW with {1}>" }, "skipped": ["<en>"] }
```
Every input `en` appears exactly once across the three sections.

## Translate when the context shows the text reaches the screen
- React output: `createElement(...)` children, props such as title, label, description,
  placeholder, aria-label, tooltip, message, gatingMessage, emptyMessage, keyPlaceholder.
- Toasts, dialogs, banners, menu items, status lines, empty states, settings descriptions.
- Agent activity summaries shown in the conversation (e.g. `Searched for "{1}"`, `Read {1}`).
- Arrays/objects of display strings that a component renders (e.g. greetings, tips).

## Skip
- Library or editor internals: Monaco/VS Code theme colour docs, graph-layout (ELK) options,
  markdown/LaTeX/Mermaid parser messages, protobuf/zod/schema validation text, Unicode data.
- Developer diagnostics, telemetry/event names, log text, internal error codes.
- Text sent to the model (system prompts, tool descriptions, instructions to the LLM).
- Strings that are only compared or used as keys (e.g. `=== "Some value"`).
- When unsure whether the user sees it, skip.

## Templates
Placeholders `{1}`, `{2}` keep their meaning; use each exactly once. Leading/trailing
spaces must match `en`. Skip a template whose fixed text is too generic to be safe.

## Validate
Run a node script in this folder: valid JSON; every `en` exactly once; templates keep the same
multiset of `{n}`; edge whitespace matches; no Mainland terms (INSTRUCTIONS.md and
GAP-INSTRUCTIONS.md lists), no 你. Report counts translated / skipped and unsure items. End with:
what you produced, how you validated it, deviations from these instructions, remaining doubts.
