// Bulk-replaces unambiguous Mainland terms with Taiwan terms in the translation
// values of a Traditional Chinese dictionary (keys, patterns and metadata are
// left alone), and stamps the result as zh-TW. Useful to bootstrap zh-TW from
// another Traditional Chinese dictionary.
//
// Usage:  node to-tw.js <source-dictionary.json> <out.json>
// Input:  a locale-format JSON file
// Output: <out.json> (a new file; the term counts are printed)
const fs = require('fs');
const { parseArgs } = require('./lib/cli');
const { args: [src, dest] } = parseArgs(process.argv.slice(2), { usage: 'node to-tw.js <source-dictionary.json> <out.json>', min: 2, max: 2 });
const j = JSON.parse(fs.readFileSync(src, 'utf8'));

// Order matters: longer terms first.
const MAP = [
  ['文件夾', '資料夾'], ['服務器', '伺服器'], ['設置', '設定'], ['配置', '設定'],
  ['創建', '建立'], ['默認', '預設'], ['加載', '載入'], ['啓', '啟'],
  ['自定義', '自訂'], ['用戶', '使用者'], ['菜單', '選單'], ['鏈接', '連結'],
  ['視頻', '影片'], ['屏幕', '螢幕'], ['消息', '訊息'], ['信息', '資訊'],
  ['運行', '執行'], ['添加', '新增'], ['打開', '開啟'], ['全局', '全域'],
  ['當前', '目前'], ['反饋', '意見回饋'], ['身份', '身分'], ['質量', '品質'],
  ['代碼', '程式碼'], ['搜索', '搜尋'], ['粘貼', '貼上'], ['剪切', '剪下'],
  ['撤銷', '復原'], ['撤消', '復原'], ['窗口', '視窗'], ['標籤頁', '分頁'],
  ['插件', '外掛程式'], ['登錄', '登入'], ['註銷', '登出'], ['賬號', '帳號'],
  ['賬戶', '帳戶'], ['激活', '啟用'], ['支持', '支援'], ['導出', '匯出'],
  ['導入', '匯入'], ['緩存', '快取'], ['內存', '記憶體'], ['網絡', '網路'],
  ['數據', '資料'], ['文本', '文字'], ['字符', '字元'], ['字體', '字型'],
  ['圖標', '圖示'], ['對象', '物件'], ['函數', '函式'], ['變量', '變數'],
  ['線程', '執行緒'], ['異步', '非同步'], ['調試', '偵錯'], ['模板', '範本'],
  ['優化', '最佳化'], ['兼容', '相容'], ['卸載', '解除安裝'], ['在線', '線上'],
  ['實時', '即時'], ['交互', '互動'], ['界面', '介面'], ['鼠標', '滑鼠'],
  ['快捷鍵', '快速鍵'], ['禁用', '停用'], ['發送', '傳送'], ['示例', '範例'],
  ['視圖', '檢視'], ['隊列', '佇列'], ['硬盤', '硬碟'], ['磁盤', '磁碟'],
  ['瞭解', '了解'], ['策略', '政策'], ['倉庫', '存放庫'], ['回滾', '復原'],
  ['擴展', '擴充功能'], ['提示詞', '提示'],
];
const REGEX_MAP = [[/終端(?!機)/g, '終端機']];

// Fields that hold patterns or metadata rather than display text.
const SKIP_KEYS = new Set(['$schema', 'id', 'pattern', 'flags', 'sample', 'dir', 'language', 'htmlLang', 'name', 'englishName', 'pluralLocale', 'chromiumLang']);
const counts = {};

function convert(s) {
  let out = s;
  for (const [from, to] of MAP) {
    if (out.includes(from)) {
      counts[from] = (counts[from] || 0) + out.split(from).length - 1;
      out = out.split(from).join(to);
    }
  }
  for (const [re, to] of REGEX_MAP) {
    const n = (out.match(re) || []).length;
    if (n) { counts[re.source] = (counts[re.source] || 0) + n; out = out.replace(re, to); }
  }
  return out;
}

function walk(node, key) {
  if (typeof node === 'string') return SKIP_KEYS.has(key) ? node : convert(node);
  if (Array.isArray(node)) return node.map((v) => walk(v, key));
  if (node && typeof node === 'object') {
    const res = {};
    // Object keys are English source strings (or structural names), never translated.
    for (const [k, v] of Object.entries(node)) res[k] = walk(v, k);
    return res;
  }
  return node;
}

const out = walk(j, null);
// Map keys like valueMaps.preset are English; values were converted above.
out.language = 'zh-TW';
out.name = '繁體中文（台灣）';
out.englishName = 'Traditional Chinese (Taiwan)';
out.htmlLang = 'zh-TW';
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));
