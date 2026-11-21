// HISTORICAL EXAMPLE: one of the one-off scripts that patched the Antigravity
// 2.34 release end to end (zh-TW). Kept to show how such a release update is
// done; it is not a general tool. The data files it touches are command-line
// arguments.
//
// Validates the translated marketplace file: every item answered once, no
// Mainland terms, no half-width punctuation or missing CJK/Latin spacing.
//
// Usage:  node val.js <sweep-1.json> <sweep-1.out.json>
// Output: findings and an error count on stdout
const fs=require('fs');
const { parseArgs } = require('../../../lib/cli');
const { args: [inPath, outPath] } = parseArgs(process.argv.slice(2), { usage: 'node val.js <sweep-1.json> <sweep-1.out.json>', min: 2, max: 2 });
const inp=JSON.parse(fs.readFileSync(inPath,'utf8'));const o=JSON.parse(fs.readFileSync(outPath,'utf8'));
const bad=/設置|配置|運行|創建|默認|加載|消息|服務器|文件夾|視頻|屏幕|刷新|保存|窗口|用戶(?!端)|項目|代碼|你|帳號|瞭解|點擊|查看器|套餐/;
let e=0;const seen={};
for(const k of [...Object.keys(o.strings),...Object.keys(o.templates),...o.skipped])seen[k]=(seen[k]||0)+1;
for(const x of inp){if(seen[x.en]!==1){console.log('count',x.en,seen[x.en]);e++}}
console.log(Object.keys(seen).length,inp.length);
for(const [k,v] of Object.entries(o.strings)){if(!v.trim()){console.log('empty',k);e++}
 if(bad.test(v)){console.log('bad',v.match(bad)[0],v.slice(0,50));e++}
 if(/[\u4e00-\u9fff][,.:;]/.test(v)){console.log('halfwidth',v.match(/.[,.:;]/)[0],v.slice(0,50));e++}
 if(/[\u4e00-\u9fff][A-Za-z0-9]|[A-Za-z0-9][\u4e00-\u9fff]/.test(v)){console.log('space',v.match(/.?[\u4e00-\u9fff][A-Za-z0-9]|[A-Za-z0-9][\u4e00-\u9fff]/)[0],'|',v.slice(0,40));e++}}
console.log('errors',e);
