// HISTORICAL EXAMPLE: one of the one-off scripts that patched the Antigravity
// 2.34 release end to end (zh-TW). Kept to show how such a release update is
// done; it is not a general tool. The data files it touches are command-line
// arguments.
//
// Validates the translated sweep file against its input: every item answered
// exactly once, placeholders and edge whitespace kept, no Mainland terms.
//
// Usage:  node validate.js <sweep-1.json> <sweep-1.out.json>
// Output: error lines and a summary on stdout
const fs = require('fs');
const { parseArgs } = require('../../../lib/cli');
const { args: [inPath, outPath] } = parseArgs(process.argv.slice(2), { usage: 'node validate.js <sweep-1.json> <sweep-1.out.json>', min: 2, max: 2 });
const inp = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const o = JSON.parse(fs.readFileSync(outPath, 'utf8'));
const seen = new Map();
for (const k of Object.keys(o.strings)) seen.set(k, (seen.get(k) || 0) + 1);
for (const k of Object.keys(o.templates)) seen.set(k, (seen.get(k) || 0) + 1);
for (const k of o.skipped) seen.set(k, (seen.get(k) || 0) + 1);
let bad = 0; const err = m => { bad++; console.log('ERR', m); };
for (const x of inp) {
  if (seen.get(x.en) !== 1) err('count ' + x.en + ' ' + seen.get(x.en));
  if (x.type === 'template' && x.en in o.strings) err('type ' + x.en);
  if (x.type === 'string' && x.en in o.templates) err('type ' + x.en);
}
for (const k of seen.keys()) if (!inp.some(x => x.en === k)) err('extra ' + k);
const ph = s => (s.match(/\{\d+\}/g) || []).sort().join();
const ws = s => [s.match(/^\s*/)[0], s.match(/\s*$/)[0]].join('|');
const bannedRe = /設置|配置|運行|創建|默認|加載|消息|服務器|文件夾|視頻|屏幕|刷新|保存|窗口|用戶|項目|代碼|你|帳號|瞭解|點擊|查看器|套餐/;
for (const sec of ['strings', 'templates']) for (const [k, v] of Object.entries(o[sec])) {
  if (sec === 'templates' && ph(k) !== ph(v)) err('ph ' + k);
  if (ws(k) !== ws(v)) err('ws ' + k);
  if (bannedRe.test(v)) err('banned ' + v);
  if (!v.trim()) err('empty ' + k);
}
console.log('input', inp.length, 'strings', Object.keys(o.strings).length, 'templates', Object.keys(o.templates).length, 'skipped', o.skipped.length, 'errors', bad);
