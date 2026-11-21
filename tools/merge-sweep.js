// Merges the translated sweep files: strings into `text`, templates into
// anchored patterns (id prefix "w"), with the same term normalisation and
// short-rule guard as the other merge scripts. The term tables are zh-TW
// specific. Modifies the locale file in place.
//
// Usage:  node merge-sweep.js <trDir> [--locale <code|path>]
// Input:  <trDir>/sweep-N.out.json = { strings: { en: zh }, templates: { "...{1}...": "...{1}..." } }
//         (translated from the sweep-N.json files built from sweep.js output)
// Output: the locale (default zh-TW) rewritten in place; counts and warnings on stdout
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('./lib/cli');
const { loadLocale, saveLocale, DEFAULT_LOCALE } = require('./lib/locale');
const { args: [trDir], opts } = parseArgs(process.argv.slice(2), {
  usage: 'node merge-sweep.js <trDir> [--locale <code|path>]', min: 1, max: 1, options: { locale: DEFAULT_LOCALE },
});
const loc = loadLocale(opts.locale);
const CJK = '㐀-鿿';
const TERMS = [[/帳號/g, '帳戶'], [/瞭解/g, '了解'], [/點擊/g, '點選'], [/Token/g, 'token'], [/概覽/g, '總覽'], [/查看器/g, '檢視器']];
const PAREN = new RegExp(`([${CJK}]) ?\\(([^()]*)\\)`, 'g');
TERMS.push([/原則/g, '政策']);
const norm = (s) => {
  let o = s;
  for (const [re, to] of TERMS) o = o.replace(re, to);
  // Space between Chinese and a placeholder, matching the dictionary style.
  o = o.replace(new RegExp(`([${CJK}])\\{`, 'g'), '$1 {').replace(new RegExp(`\\}([${CJK}])`, 'g'), '} $1');
  return o.replace(PAREN, '$1（$2）');
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const GUARD = '([^a-z\\s].*?|\\S+?)';
const MAINLAND = /設置|配置|運行|創建|默認|加載|消息|服務器|文件夾|視頻|屏幕|刷新|窗口|用戶(?!端)|代碼|信息|菜單|軟件|網絡|數據|激活|登錄|搜索|獲取|調用|接口|緩存|內存|字符|變量|函數|對象|視圖|模板|日誌|線程|進程|端口|鏈接|優化|擴展|插件|打開|重命名|批量|隊列|示例|導航|反饋|兼容|在線|撤銷|拖拽|滾動|圖標|音頻|支持|智能|算法|調試|構建|依賴|實例|會話|令牌|註銷|你/;
const ids = new Set(loc.patterns.map((p) => p.id));
const srcs = new Set(loc.patterns.map((p) => p.pattern));
let strings = 0, pats = 0, dropped = 0;
const warn = [];
for (const f of fs.readdirSync(trDir).filter((x) => /^sweep-\d+\.out\.json$/.test(x)).sort()) {
  const out = JSON.parse(fs.readFileSync(path.join(trDir, f), 'utf8'));
  for (const [en, zh0] of Object.entries(out.strings || {})) {
    if (!zh0 || !zh0.trim() || zh0.trim() === en.trim()) continue;
    const zh = norm(zh0);
    if (MAINLAND.test(zh)) warn.push(`mainland? ${en} => ${zh}`);
    if (loc.text[en]) continue;
    loc.text[en] = zh;
    strings++;
  }
  for (const [en, zh0] of Object.entries(out.templates || {})) {
    if (!zh0 || !zh0.trim()) continue;
    const zh = norm(zh0.trim());
    const ph = (s) => (s.match(/\{\d+\}/g) || []).sort().join();
    if (ph(en) !== ph(zh)) { warn.push(`placeholder mismatch ${en}`); continue; }
    const parts = en.trim().split(/\{\d+\}/);
    const fixedWords = parts.join(' ').match(/[A-Za-z]{2,}/g) || [];
    if (fixedWords.length < 2) { dropped++; continue; }
    const fixedLetters = parts.join('').replace(/[^A-Za-z]/g, '').length;
    let pattern = '^' + escapeRe(parts[0]);
    for (let i = 1; i < parts.length; i++) {
      const before = parts[i - 1];
      const slot = /(:\s*|\(|["'“‘「])$/.test(before);
      pattern += (fixedLetters < 25 && !slot ? GUARD : '(.+?)') + escapeRe(parts[i]);
    }
    pattern += '$';
    if (srcs.has(pattern)) continue;
    srcs.add(pattern);
    let id = 'w' + (pats + 1);
    while (ids.has(id)) id += '_';
    ids.add(id);
    const sample = en.trim().replace(/\{\d+\}/g, 'X');
    if (!new RegExp(pattern).test(sample)) { warn.push(`sample fails ${pattern}`); continue; }
    if (MAINLAND.test(zh)) warn.push(`mainland? ${en} => ${zh}`);
    loc.patterns.push({ id, pattern, template: zh, sample });
    pats++;
  }
}
// Keep every rule reachable: move a rule ahead of an earlier one that would
// catch its sample first.
const re = (p) => new RegExp(p.pattern, p.flags || '');
for (let pass = 0; pass < 50; pass++) {
  let moved = false;
  for (let i = 0; i < loc.patterns.length; i++) {
    const p = loc.patterns[i];
    const j = loc.patterns.findIndex((q) => (q.scope === 'sentence') === (p.scope === 'sentence') && re(q).test(p.sample));
    if (j !== -1 && j < i) { loc.patterns.splice(i, 1); loc.patterns.splice(j, 0, p); moved = true; }
  }
  if (!moved) break;
}
saveLocale(opts.locale, loc);
console.log(`strings ${strings}, patterns ${pats}, dropped generic ${dropped}; totals text ${Object.keys(loc.text).length}, patterns ${loc.patterns.length}`);
if (warn.length) console.log(warn.join('\n'));
