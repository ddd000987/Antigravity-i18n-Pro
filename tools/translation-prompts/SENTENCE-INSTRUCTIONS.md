# Translate split UI sentences (zh-TW, Taiwan usage)

Read `INSTRUCTIONS.md` and `GAP-INSTRUCTIONS.md` in this folder first. Their translation rules,
glossary and "Extra glossary" still apply; this file defines a different input/output format.

## Background
The Antigravity UI (React) builds some sentences from several pieces, e.g.
`createElement("p", null, "No ", t.emptyMessagePlural, " yet")`. The translation engine now joins
the pieces of one element into one source string and looks that string up. You translate the
**whole sentence**, so word order can be natural Chinese.

In the joined source:
- `<>` marks an inline element child (a link, bold text, a keyboard key, an icon...). Its own text
  is translated separately; you only place the marker.
- In `pattern` items the key is an anchored regex. Each `(.+?)` is a dynamic value; in your
  translation it is `{1}`, `{2}`, ... in the order the `(.+?)` groups appear in the key.
  `(?:a|b)` and `(?:s)?` are fixed alternatives (e.g. singular/plural); they need no placeholder.
- `text` items have no dynamic values: translate the key (keep its `<>` markers).

## Input
`sent-N.json`: array of `{ kind, key, sample, captures, componentMarker, context }`.
- `captures`: one entry per placeholder: `{ placeholder, code, possibleValues? }`. `code` is the JS
  expression that fills it. `possibleValues` (when present) lists English strings that property
  is set to somewhere in the app; they are a hint, not necessarily all used here.
- `context`: minified code around the element.

## Output
Write `sent-N.out.json` (same N), UTF-8, 2-space indent:
```json
{
  "items": {
    "<key exactly as given>": {
      "zh": "<translation, with the same <> markers and {n} placeholders>",
      "values": { "{1}": { "<English value>": "<zh-TW>" } }
    }
  },
  "skipped": ["<key>"]
}
```
- `values` is optional: give it only for a placeholder whose filled-in English value would
  otherwise stay English in the sentence (e.g. `automations` in `No {1} yet`). Translate the
  `possibleValues` that make sense for this sentence. Values are matched case-insensitively.
- Every input key appears exactly once in `items` or `skipped`.

## Hard rules (the engine rejects a translation that breaks them)
1. Keep every `<>` marker: same count, and markers stay in the same order relative to each other.
2. Use every `{n}` exactly once.
3. A placeholder whose value may be an element (its `code` looks like JSX / a component / a
   variable holding a node, or `componentMarker` is true) must keep its order relative to the
   `<>` markers. Reorder `{n}` only when it clearly holds plain text (a number, a name, a string).
4. Text placed before the first marker, between markers and after the last one goes back into the
   existing text pieces in those positions, so do not move text across a marker if that would
   leave text where the English had none (e.g. English `<>` immediately at the start must not get
   Chinese text before it unless English also had text there). When the natural Chinese order is
   impossible under these rules, choose the closest correct order, or skip the item.

## Skip when
- The sentence is developer/debug text, an error code dump, or not shown to users.
- The pieces are not really one sentence (for example a label and an unrelated value).
- You cannot satisfy the hard rules with a correct translation.

## Validate (write the script in this folder, run it with node until clean)
- Valid JSON, every key exactly once in `items` or `skipped`.
- For each item: count of `<>` equals the key's count; each `{n}` for n = 1..(number of `(.+?)`
  in the key) appears exactly once and no other `{n}`; `values` keys are only `{n}` that exist.
- No Mainland terms (see INSTRUCTIONS.md and GAP-INSTRUCTIONS.md lists), no 你.
Report: counts translated / skipped, validation output, unsure items. End with: what you
produced, how you validated it, deviations from these instructions, remaining doubts.
