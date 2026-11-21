// Compares the locale with another dictionary (for example the upstream
// zh-Hant file of a sibling project): lists keys of that dictionary which our
// locale lacks but which occur in the bundle, with code context and the other
// project's rendering as a reference.
//
// Usage:  node gap.js <other-dictionary.json> <bundle.js> <outDir> [--locale <code|path>]
// Input:  the other dictionary ({ text: {...} }) and the UI bundle
// Output: <outDir>/gap-1.json and gap-2.json (two halves, for two translators),
//         each a list of { en, exactLiteral, occurrences, upstreamReference, context }
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('./lib/cli');
const { loadLocale, DEFAULT_LOCALE } = require('./lib/locale');
const { args: [upPath, jsPath, outDir], opts } = parseArgs(process.argv.slice(2), {
  usage: 'node gap.js <other-dictionary.json> <bundle.js> <outDir> [--locale <code|path>]',
  min: 3, max: 3, options: { locale: DEFAULT_LOCALE },
});
const ours = loadLocale(opts.locale);
const up = JSON.parse(fs.readFileSync(upPath, 'utf8'));
const js = fs.readFileSync(jsPath, 'utf8');
const n = (s) => s.trim().replace(/\s+/g, ' ');
const have = new Set(Object.keys(ours.text).map(n));
const pats = ours.patterns.map((p) => new RegExp(p.pattern, p.flags || ''));
const items = [];
for (const [key, upZh] of Object.entries(up.text)) {
  const k = n(key);
  if (have.has(k) || !js.includes(k)) continue;
  if (pats.some((re) => re.test(k))) continue;
  const quotes = ['"' + k + '"', "'" + k + "'", '`' + k + '`'];
  const q = quotes.find((x) => js.includes(x));
  const at = js.indexOf(q || k);
  const occurrences = js.split(q || k).length - 1;
  items.push({
    en: key,
    exactLiteral: Boolean(q),
    occurrences,
    upstreamReference: upZh,
    context: js.slice(Math.max(0, at - 160), at + k.length + 80).replace(/\s+/g, ' '),
  });
}
items.sort((a, b) => a.en.localeCompare(b.en));
fs.mkdirSync(outDir, { recursive: true });
const half = Math.ceil(items.length / 2);
fs.writeFileSync(path.join(outDir, 'gap-1.json'), JSON.stringify(items.slice(0, half), null, 1));
fs.writeFileSync(path.join(outDir, 'gap-2.json'), JSON.stringify(items.slice(half), null, 1));
console.log('items', items.length, 'exact literal', items.filter((x) => x.exactLiteral).length, 'single lowercase word', items.filter((x) => /^[a-z]+$/.test(x.en.trim())).length);
