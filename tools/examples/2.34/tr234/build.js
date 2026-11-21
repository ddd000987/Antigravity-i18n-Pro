// HISTORICAL EXAMPLE: one of the one-off scripts that patched the Antigravity
// 2.34 release end to end (zh-TW). Kept to show how such a release update is
// done; it is not a general tool. The data files it touches are command-line
// arguments.
//
// Builds sweep-1.json (2.34 additions) in SWEEP-INSTRUCTIONS.md format from
// the extract/sweep deltas and the server-provided copy.
//
// Usage:  node build.js <extract-delta.json> <sweep-delta.json> <server-copy.txt> <out-sweep-1.json>
// Input:  extract.js output limited to the new strings, sweep.js output limited
//         to the new strings, and the output of ../../../server-copy.js
// Output: <out-sweep-1.json>
const fs = require('fs');
const { parseArgs } = require('../../../lib/cli');
const { args: [exPath, swPath, serverPath, outPath] } = parseArgs(process.argv.slice(2), {
  usage: 'node build.js <extract-delta.json> <sweep-delta.json> <server-copy.txt> <out-sweep-1.json>', min: 4, max: 4,
});
const ex = JSON.parse(fs.readFileSync(exPath, 'utf8'));
const sw = JSON.parse(fs.readFileSync(swPath, 'utf8'));
const items = [];
const seen = new Set();
const add = (en, type, context) => {
  if (seen.has(en)) return;
  seen.add(en);
  items.push({ en, type, context: String(context || '').slice(0, 400) });
};
for (const s of ex.strings) add(s.text, 'string', s.context);
for (const t of ex.templates) {
  let n = 0;
  add(t.template.replace(/\{\}/g, () => `{${++n}}`), 'template', t.context);
}
for (const s of sw) add(s.en, /\{\d+\}/.test(s.en) ? 'template' : 'string', s.context);
// Server-provided copy (feature-flag JSON in language_server.exe). Prompts
// are sent to the agent, so only display fields are included.
const server = fs.readFileSync(serverPath, 'utf8').split('\n');
for (const line of server) {
  const m = line.match(/^-- \[(\w+)\] (.+)$/);
  if (!m || m[1] === 'prompt' || m[1] === 'default') continue;
  add(m[2].trim(), 'string', `server-provided UI copy, field "${m[1]}" (onboarding role cards, suggestion chips, interface-mode cards, marketplace categories)`);
}
for (const n of ['Science', 'Design', 'Business']) add(n, 'string', 'server-provided onboarding role card displayName');
add('Give Feedback', 'string', 'menu item / button label (Map value ["Provide Feedback","Give Feedback"])');
fs.writeFileSync(outPath, JSON.stringify(items, null, 2) + '\n');
console.log('items', items.length, 'templates', items.filter((i) => i.type === 'template').length);
