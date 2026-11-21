// HISTORICAL EXAMPLE: one of the one-off scripts that patched the Antigravity
// 2.34 release end to end (zh-TW). Kept to show how such a release update is
// done; it is not a general tool. The data files it touches are command-line
// arguments.
//
// Review fixes applied to sweep-1.out.json before merging (in place).
//
// Usage:  node review.js <sweep-1.out.json>
// Input/Output: the file written by make.js, rewritten in place
const fs = require('fs');
const { parseArgs } = require('../../../lib/cli');
const { args: [f] } = parseArgs(process.argv.slice(2), { usage: 'node review.js <sweep-1.out.json>', min: 1, max: 1 });
const o = JSON.parse(fs.readFileSync(f, 'utf8'));
const fix = {
  strings: {
    Reply: '回覆',
    'Allow for conversation': '在此對話中允許',
    'Yes, allow for this conversation': '是，在此對話中允許',
    'Instead of queueing, try asking the agent to do something after the current task.': '不必排入佇列，可以試著請代理程式在目前工作完成後再做某件事。',
    settings: '設定',
  },
  templates: {
    'Line {1} → {2}': '第 {1} 行 → {2}',
    'Opens the New Conversation screen for this {1}': '為此 {1} 開啟新對話畫面',
  },
};
for (const sec of Object.keys(fix)) {
  for (const [en, zh] of Object.entries(fix[sec])) {
    if (!(en in o[sec]) && en !== 'settings') throw new Error(`missing ${sec}: ${en}`);
    o[sec][en] = zh;
  }
}
fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n', 'utf8');
console.log('applied');
