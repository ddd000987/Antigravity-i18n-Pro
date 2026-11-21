# Fill the remaining Antigravity UI strings (zh-TW, Taiwan usage)

Read `INSTRUCTIONS.md` in this folder first: its translation rules, glossary, and
validation still apply. This file changes the input/output format and adds rules.

## Input
`gap-N.json`: an array of `{ en, exactLiteral, occurrences, upstreamReference, context }`.
- `en`: dictionary key. The app replaces a text node or attribute only when its whole
  trimmed text equals the key, so a key is a complete text node, not a substring.
- `exactLiteral`: true when the key appears in the bundle as a whole quoted string.
  false means it only appears inside a longer string (likely not a node of its own).
- `context`: minified React code around the first occurrence.
- `upstreamReference`: another project's rendering. It uses Mainland Chinese vocabulary
  written in Traditional characters (配置, 消息, 服務器, 項目, 設置, 套餐, 查看器...).
  Use it only to understand the meaning. Never copy its vocabulary.

## Output
Write `gap-N.out.json` (same N), UTF-8, 2-space indent:
```json
{ "strings": { "<en exactly as given>": "<zh-TW>" }, "skipped": ["<en>"] }
```
Every input `en` appears exactly once in `strings` or `skipped`.

## When to skip
- `exactLiteral` is false and the context does not show the text rendered on its own.
- Enum / code values not shown to users (for example a status-code name map such as
  `8:"ResourceExhausted"`), identifiers, CSS, protocol strings.
- Single lowercase words or tiny fragments (`file`, `line`, `more`, `change`): the key is
  global, so every text node anywhere whose whole text is that word gets the
  translation, including in chat content. Translate one only when the context shows it as
  a rendered fragment AND one rendering reads correctly when joined with its neighbours
  (see `context`, e.g. `"Commit ",c," file"," ",c===1?"change":"changes"`). Otherwise skip.

## Extra glossary (newer decisions, these win)
Select = 選取 (Choose = 選擇), Account = 帳戶 (never 帳號), Learn = 了解 (never 瞭解),
Click = 按一下 / 點選 (never 點擊), token = token (lowercase), Overview = 總覽,
Process = 處理程序, Marketplace = 市集, Plugin = 外掛程式, Bundle = 套件組合,
Repository = 存放庫, Client = 用戶端, Viewer = 檢視器, Reply/Response = 回應,
Details = 詳細資料, Suggestions = 建議, Knowledge = 知識, Tip = 提示.
Keep trailing `...` as `...` and a trailing `:` as full-width `：`.

## Validate
Same checks as INSTRUCTIONS.md (valid JSON, each `en` exactly once, edge whitespace kept,
no Mainland terms), plus: no value contains 帳號, 瞭解, 點擊, 查看器, 配置, 項目 (as
"project"), or 消息. Report counts translated / skipped and anything you were unsure about.
End the report with: what you produced, how you validated it, any deviation from these
instructions, and remaining doubts.
