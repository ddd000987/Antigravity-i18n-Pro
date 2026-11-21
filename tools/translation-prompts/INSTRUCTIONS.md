# Translate Antigravity UI strings to Taiwan Traditional Chinese (zh-TW)

Input: `batch-N.json` in this folder: an array of items
`{ en, type: "string"|"template", certainty: "ui"|"maybe-ui", usedAs, context }`.
They were extracted from the React bundle of the Google Antigravity desktop app
(an AI coding-agent app). `context` is a minified code excerpt around the string
to help you judge meaning and whether it is shown to users.

Output: write `batch-N.out.json` (same folder, same N) as UTF-8 JSON, 2-space indent:

```json
{
  "strings":   { "<en exactly as given>": "<zh-TW>" },
  "templates": { "<en exactly as given, with {1} {2}>": "<zh-TW with the same {n}>" },
  "skipped":   ["<en>", "..."]
}
```

Every input item must appear exactly once: in `strings` (type string), `templates`
(type template), or `skipped`.

## What to skip
Skip (put in `skipped`) anything that is not human-facing UI text, or should not be translated:
- code, identifiers, CSS, regex, URLs, file paths, protocol names, internal enum/debug names
  (e.g. `FieldOptions`, `[object Promise]`, `linear-gradient(...)`)
- library/parser internals (e.g. regex or protobuf error messages) and developer-only logs
- proper nouns / product or model names alone (e.g. `Gemini 3.1 Flash Image`, `GitHub`, `Piper`, `Firebase`)
- templates whose fixed text is too small or generic to be safe (e.g. `file {1}`, `github://{1}`, `artifact__{1}`, `Chunk {1}`)
- `maybe-ui` items you are not reasonably confident are shown to users

When unsure about a `ui` item, translate it. When unsure about a `maybe-ui` item, skip it.

## How to translate
- Taiwan usage as in Google / Microsoft / Apple zh-TW UIs: 設定, 檔案, 資料夾, 伺服器, 建立, 執行, 開啟, 新增, 預設, 目前,
  載入, 訊息, 連線, 重新整理, 儲存, 檢視, 搜尋, 複製, 貼上, 復原, 專案, 程式碼, 指令, 視窗, 分頁, 擴充功能,
  登入/登出, 帳戶, 支援, 匯入/匯出, 快取, 網路, 資料, 使用者, 權限, 外掛程式, 快速鍵, 停用/啟用, 傳送, 範例, 佇列.
  Never Mainland terms (設置, 配置, 運行, 創建, 默認, 加載, 消息, 服務器, 文件夾, 視頻, 屏幕, 刷新, 保存, 窗口, 用戶, 項目=project, 代碼).
- Glossary (keep consistent):
  Agent = 代理程式, Subagent = 子代理程式, Agents = 代理程式, Workspace = 工作區, Conversation = 對話,
  Artifact = Artifact (keep English), Skills = 技能, Rules = 規則, Workflows = 工作流程, Hooks = 掛鉤,
  Customizations = 自訂, Knowledge = 知識, Settings = 設定, Terminal = 終端機, Browser = 瀏覽器, Editor = 編輯器,
  Model = 模型, Plan (subscription) = 方案, Plan (agent plan) = 計畫, Review = 審查, Accept = 接受, Reject = 拒絕,
  Approve = 核准, Deny = 拒絕, Allow = 允許, Cancel = 取消, Copy = 複製, Copied = 已複製, Retry = 重試, Undo = 復原,
  Permissions = 權限, Extensions = 擴充功能, Side Panel = 側邊面板, Side pane = 側邊窗格, Pane = 窗格,
  Diff = 差異, Changes = 變更, Commit = 提交, Branch = 分支, Pull request = 提取要求 (PR), Worktree = 工作樹,
  Sandbox = 沙箱, Sign in = 登入, Credits = 額度, Quota = 配額, Remote = 遠端, Local = 本機, Context = 上下文,
  Fork = 分支複製 (verb "Fork conversation" = 從此分出對話 is fine), Archive = 封存, Pin = 固定, Unpin = 取消固定,
  Rename = 重新命名, Delete = 刪除, Dismiss = 關閉, Token = token, Prompt = 提示, Thinking = 思考中.
- Keep brand / product / model / tool names in English (Antigravity, Gemini, Google, Chrome, GitHub, MCP, Git,
  Firebase, Claude, Docker, SSH, WSL, `browser_.*`, keyboard keys like ⌘ / Ctrl / Enter / →).
- Keep every placeholder `{1}`, `{2}`... exactly once each (order may change to suit Chinese grammar).
- Keep leading/trailing spaces exactly as in `en` (fragments are joined with other text nodes), and keep a trailing
  "..." / "…" as "…" style ending (use "..." if en uses "..."). Use full-width punctuation inside Chinese text
  (，。：？！（）「」) but leave trailing punctuation consistent with en.
- Fragments (a sentence split around a link or value, e.g. "directly in the side pane.") must read correctly when
  joined with the neighbouring fragment; use `context` to see the neighbours.
- Concise, natural UI wording; use 您 rather than 你. Do not add or drop meaning.

## Validate before finishing
Run a small node script that checks: valid JSON; every input `en` appears exactly once across the three sections;
each template keeps the same multiset of `{n}` placeholders; leading/trailing whitespace of each translated value
matches `en`; and no value contains the Mainland terms listed above. Fix and re-run until clean.

Report (short): counts translated / skipped, validation output, and terms you were unsure about.
