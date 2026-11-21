// Checks the pattern rules: own sample matches, shadowing by earlier rules,
// rules that also match dictionary keys, and rules whose fixed text is so short
// that they may over-match.
//
// Usage:  node patcheck.js [--locale <code|path>]
// Input:  the locale (default zh-TW)
// Output: a report on stdout
const { parseArgs } = require('./lib/cli');
const { loadLocale, DEFAULT_LOCALE } = require('./lib/locale');
const { opts } = parseArgs(process.argv.slice(2), { usage: 'node patcheck.js [--locale <code|path>]', options: { locale: DEFAULT_LOCALE } });
const loc = loadLocale(opts.locale);
const pats = loc.patterns.map((p) => ({ ...p, re: new RegExp(p.pattern, p.flags || '') }));
const fill = (p, m) => (p.template || '').replace(/\{(\d+)\}/g, (_, n) => m[Number(n)] ?? '');
let bad = 0, shadow = [], hitsText = [], wide = [];
for (const [i, p] of pats.entries()) {
  if (!p.sample) continue;
  const m = p.sample.match(p.re);
  if (!m) { bad++; console.log('sample does not match', p.id, p.pattern, p.sample); continue; }
  const first = pats.findIndex((q) => q.re.test(p.sample));
  if (first !== i) shadow.push(`${p.id} (${p.sample}) is caught first by ${pats[first].id} ${pats[first].pattern}`);
}
for (const k of Object.keys(loc.text)) {
  const p = pats.find((q) => q.re.test(k.trim()));
  if (p && p.id.startsWith('ui')) hitsText.push(`${p.id}: "${k}" also matches; text wins? -> ${fill(p, k.trim().match(p.re))}`);
}
// Rules whose captured group could swallow a whole English sentence.
for (const p of pats) {
  if (!p.id.startsWith('ui')) continue;
  const fixed = p.pattern.replace(/\(\.\+\?\)/g, '').replace(/[\^$\\]/g, '');
  if (fixed.replace(/[^A-Za-z]/g, '').length < 10) wide.push(`${p.id}: ${p.pattern} -> ${p.template}`);
}
console.log('patterns', pats.length, '| bad samples', bad);
console.log(`\n## shadowed: ${shadow.length}\n` + shadow.slice(0, 20).join('\n'));
console.log(`\n## pattern also matches a dictionary key: ${hitsText.length}\n` + hitsText.slice(0, 20).join('\n'));
console.log(`\n## short fixed text (<10 letters), may over-match: ${wide.length}\n` + wide.join('\n'));
