# Antigravity-i18n-Pro

[English](./README.md) | 繁體中文

> **本專案 fork 自 [wade19990814-hue/antigravity-i18n](https://github.com/wade19990814-hue/antigravity-i18n)。**
>
> <details>
> <summary>與原版的差異</summary>
>
> - **台灣繁體中文（`zh-TW`）**語言包，使用台灣用語，並設為預設語言：4,303 條文字、685 條動態規則、12 個值對照表，對應 Antigravity 2.34.0。
> - 移除原版的 `zh-Hant`（繁體字但為大陸用語）；`zh-Hant`、`zh-HK`、`zh-MO` 都會對應到 `zh-TW`。
> - 翻譯引擎加入**句子層**：React 拆成多段文字與行內元素（連結、程式碼、按鍵）的句子，會以 `<>` 標記合併後整句翻譯，動態句子則用 `scope: "sentence"` 規則處理；翻譯結果會快取。
> - **支援 Antigravity 2.33 以後的版本**：為 Chromium 的 `--lang` 參數加入新的插入點，原版在新版上已找不到位置。
> - **自訂語言檔**：匯出翻譯範本、檢查檔案（JSON 錯誤、`{n}` 變數與 `<>` 標記，每個問題都標出行號）、套用，並顯示翻譯進度。
> - **更新範本**：把 Antigravity 新版本新增的字串併入你的檔案並標示出來，已翻好的內容不會被覆蓋。
> - **記住上次的語言**（內建或自訂檔），Antigravity 更新把英文版裝回去後，開啟工具時會提示重新套用；命令列也有 `reapply`。
> - 工具視窗本身有英文、繁體中文、簡體中文介面，預設跟隨系統語言。
> - 附上製作翻譯用的維護腳本，見 [`tools/`](./tools/README.md)。
> - zh-TW 以外的語言包都補齊到涵蓋 Antigravity 2.34 的所有字串（機器翻譯，並修正了原版譯錯的地方）。
> - 執行檔改名為 `antigravity-i18n-pro.exe`，版本從 1.0.0 起算。
>
> </details>

[Google Antigravity](https://antigravity.google/) 桌面版（**Windows**）的介面在地化工具。單一執行檔，同時有視窗與命令列，不需要 Node.js 或其他執行環境。

## 特色

- **單一執行檔**：預設開啟視窗，同一個檔案也能當命令列工具使用。
- **逐位元組還原**：修改前會先保留一份原始的 `app.asar.clean-backup`，還原後的檔案與官方版本完全相同（SHA-256 驗證）。
- **只改介面外殼**：Antigravity 本身的介面、原生選單（應用程式、系統匣與右鍵選單）、原生對話框、SSH 中斷連線頁等內建小頁面，以及 Swarm 側邊面板。程式碼編輯器（Monaco）、終端機（xterm）和 AI 對話內容都不會動到。
- **事前檢查、失敗回復**：產生的 JavaScript 寫入前會先檢查語法，任何一步失敗都會自動回復原狀。
- **離線運作**：不連網、不收集任何資料。

## 使用方式

### 視窗介面

執行 `antigravity-i18n-pro.exe`：

1. 自動偵測 Antigravity 的安裝位置（也可以按「變更位置」自行指定）。
2. 選擇語言。選 **English** 就是還原成官方版本。
3. 按下套用。套用時必須關閉 Antigravity：工具會先請它正常結束，最多等 30 秒後強制關閉，請先儲存工作。完成後會重新啟動 Antigravity。

工具本身的介面語言可以在右上角切換。

執行檔沒有程式碼簽章，第一次執行時 Windows SmartScreen 可能會跳出警告：按「其他資訊」，再按「仍要執行」。可以用 Release 裡的 `SHA256SUMS.txt` 確認下載的檔案。

### Antigravity 更新之後

Antigravity 每次更新都會換掉 `app.asar`，翻譯也就跟著消失。工具會記住你上次套用的語言：更新後打開工具，它會提示重新套用同一個語言（或你的自訂檔）。命令列：

```powershell
antigravity-i18n-pro.exe reapply             # 重新套用上次的語言
antigravity-i18n-pro.exe reapply --if-needed # 只有被更新蓋掉時才套用
```

### 只更新翻譯

每個 [Release](../../releases) 都會附上內建的語言檔，檔名是 `language-<代碼>.json`（例如 `language-zh-TW.json`；1.1.0 以前是 `antigravity-<代碼>.json`）。如果某次 Release 只修正翻譯，不必換執行檔：下載新的語言檔，在視窗按「載入語言檔」，或

```powershell
antigravity-i18n-pro.exe apply --locale-file language-zh-TW.json
```

工具會記住這個檔案，Antigravity 更新後重新套用時也會用它。想改回執行檔內建的語言包，在視窗重新選一次該語言即可。`SHA256SUMS.txt` 列出每個 Release 檔案的校驗碼。

### 命令列

```powershell
antigravity-i18n-pro.exe status                  # 目前狀態與備份
antigravity-i18n-pro.exe apply                   # 安裝 zh-TW（預設）
antigravity-i18n-pro.exe apply --locale ja       # 安裝其他內建語言包
antigravity-i18n-pro.exe restore                 # 還原成官方英文版
antigravity-i18n-pro.exe locales                 # 內建語言包與涵蓋率
```

選項：`--app-dir <路徑>`（安裝資料夾）、`--no-restart`、`--force`（不等待正常結束直接關閉 Antigravity）、`--timeout <毫秒>`、`--yes`（略過確認）。`tw` 等同 `apply --locale zh-TW`，`en` 等同 `restore`。

## 自訂語言檔

不用重新建置工具就能加入任何語言。

1. **匯出範本**：在視窗按「匯出範本」，或

   ```powershell
   antigravity-i18n-pro.exe export-template --out my-language.json
   antigravity-i18n-pro.exe export-template --out tweak-zh-TW.json --from zh-TW   # 以內建語言包為底稿
   ```

   範本列出所有英文字串，譯文都是空的。`notes` 會說明每個字串出現在畫面上的位置（例如 *Button; near: "Cancel", "Save changes"*）。

2. **翻譯**：填好 `language`（例如 `fr`）和 `name`（例如 `Français`），再填入想翻的內容。沒填的會維持英文，所以只翻一部分也能套用。
   - 保留每個 `{1}`、`{2}`… 變數和每個 `<>` 標記（代表連結、按鍵等行內元素，順序不能變）。
   - 含變數的字串（`patterns`）會附上 `example`（實際例子）和帶變數的英文 `source`，你只要填 `template`。範本裡不會出現正規表示式。有複數變化的語言可以改用 `templates`，以 CLDR 類別（`one`、`few`、`many`、`other`）分別填寫。

3. **檢查並套用**：在視窗按「載入語言檔」，會先顯示翻譯進度和每個問題所在的行號，確認沒問題才套用。或：

   ```powershell
   antigravity-i18n-pro.exe check --locale-file my-language.json
   antigravity-i18n-pro.exe apply --locale-file my-language.json
   ```

4. **Antigravity 更新之後**：按「更新範本」，或

   ```powershell
   antigravity-i18n-pro.exe update-template --locale-file my-language.json
   ```

   新字串會以空白譯文加入，並列在 `newEntries`（說明開頭標 `[NEW]`）；已翻好的內容會保留，新版不再使用的字串列在 `obsoleteEntries`，原檔另存為同目錄的 `.bak-<時間>`。

## 內建語言

| 代碼 | 語言 | Antigravity 2.34 字串涵蓋率 |
| :--- | :--- | :--- |
| `zh-TW` | 繁體中文（台灣） | 100% |
| `zh-CN` | 简体中文 | 100% |
| `ja` | 日本語 | 100% |
| `ko` | 한국어 | 100% |
| `es` | Español | 100% |
| `fr` | Français | 100% |
| `de` | Deutsch | 100% |
| `pt-BR` | Português do Brasil | 100% |
| `ru` | Русский | 100% |
| `it` | Italiano | 100% |
| `tr` | Türkçe | 100% |
| `en` | English | 官方版本（選擇即還原） |

沒有翻譯的字串會維持英文。只有 zh-TW 經過母語人士校對，其他補齊的語言包是機器翻譯，歡迎協助修正。

## 工具會留下的檔案

- `resources\app.asar.clean-backup`：還原時需要的官方原始檔，**請勿刪除**。
- `resources\app.asar.bak-*`：每次操作前的安全備份（含時間），確認目前狀態正常後可以刪除。
- `%APPDATA%\Antigravity-i18n-Pro\settings.json`：上次套用的語言和工具介面語言。

## 從原始碼建置

需求：Go 1.26 以上，以及 [Wails v2](https://wails.io/) CLI（`go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0`）。

```powershell
.\build.ps1                   # 視窗版：build\bin\antigravity-i18n-pro.exe，命令列版：build\bin\antigravity-i18n-pro-cli.exe
.\build.ps1 -Target release   # 另外產生 build\release：兩個執行檔、語言檔和 SHA256SUMS.txt
go test ./...

# 另外對真實 app.asar 的副本做打包測試（不會動到安裝）：
$env:ANTIGRAVITY_ASAR = "$env:LOCALAPPDATA\Programs\antigravity\resources\app.asar.clean-backup"
go test ./...
```

推送和 `VERSION` 相符的 tag `vX.Y.Z` 會執行 [`release.yml`](./.github/workflows/release.yml)，建置 Release 檔案並附到一個草稿 Release；寫好說明後再發布。

Antigravity 推出新版時如何更新翻譯，請見 [`tools/README.md`](./tools/README.md)。

## 免責聲明

1. 本專案為非官方的社群專案，與 Google 或 Antigravity 官方無關，也未獲其認可。
2. Google Antigravity 及相關商標屬於其各自的所有者。
3. 僅供個人與學習用途，使用時請遵守所修改軟體的服務條款。

## 授權

[MIT](./LICENSE)。原始作品 © antigravity-i18n Contributors。
