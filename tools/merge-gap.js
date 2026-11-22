// Merges the translated gap files into the locale, normalising terms the same
// way archive/fix.js does, and reports anything suspicious for manual review. The term
// tables are zh-TW specific. Modifies the locale file in place.
//
// Usage:  node merge-gap.js <trDir> [--locale <code|path>]
// Input:  <trDir>/gap-N.out.json = { strings: { "<English>": "<translation>" } }
//         (translated from the gap-N.json files written by gap.js)
// Output: the locale (default zh-TW) rewritten in place; counts and review notes on stdout
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('./lib/cli');
const { loadLocale, saveLocale, DEFAULT_LOCALE } = require('./lib/locale');
const { args: [trDir], opts } = parseArgs(process.argv.slice(2), {
  usage: 'node merge-gap.js <trDir> [--locale <code|path>]', min: 1, max: 1, options: { locale: DEFAULT_LOCALE },
});
const loc = loadLocale(opts.locale);
const CJK = '㐀-鿿';
const TERMS = [[/帳號/g, '帳戶'], [/瞭解/g, '了解'], [/點擊/g, '點選'], [/Token/g, 'token'], [/概覽/g, '總覽'], [/查看器/g, '檢視器']];
const PAREN = new RegExp(`([${CJK}]) ?\\(([^()]*)\\)`, 'g');
const MAINLAND = /設置|配置|運行|創建|默認|加載|消息|服務器|文件夾|視頻|屏幕|刷新|窗口|用戶(?!端)|代碼|信息|菜單|軟件|網絡|數據|激活|登錄|搜索|獲取|調用|接口|緩存|內存|字符|變量|函數|對象|視圖|模板|日誌|線程|進程|端口|鏈接|優化|擴展|插件|打開|重命名|批量|隊列|示例|導航|反饋|兼容|在線|撤銷|拖拽|滾動|圖標|音頻|支持|智能|算法|調試|構建|依賴|實例|會話|令牌|註銷|你/;
let added = 0, exists = 0;
const review = [];
for (const f of fs.readdirSync(trDir).filter((x) => /^gap-\d+\.out\.json$/.test(x)).sort()) {
  const out = JSON.parse(fs.readFileSync(path.join(trDir, f), 'utf8'));
  for (const [en, zh0] of Object.entries(out.strings || {})) {
    if (typeof zh0 !== 'string' || !zh0.trim()) continue;
    let zh = zh0;
    for (const [re, to] of TERMS) zh = zh.replace(re, to);
    zh = zh.replace(PAREN, '$1（$2）');
    if (Object.prototype.hasOwnProperty.call(loc.text, en)) { exists++; continue; }
    if (MAINLAND.test(zh)) review.push(`mainland? ${en} => ${zh}`);
    if (zh.trim() === en.trim()) { review.push(`same as en, dropped: ${en}`); continue; }
    if (/^[a-z]+$/.test(en.trim())) review.push(`single word: ${JSON.stringify(en)} => ${JSON.stringify(zh)}`);
    loc.text[en] = zh;
    added++;
  }
}
saveLocale(opts.locale, loc);
console.log(`added ${added}, already present ${exists}, total text ${Object.keys(loc.text).length}`);
console.log(review.join('\n'));
