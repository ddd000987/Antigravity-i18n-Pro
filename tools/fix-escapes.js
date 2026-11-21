// HISTORICAL one-off repair, kept for reference: repairs captures whose
// backslashes were lost in an earlier tuning pass and narrows the "{1} of {2}"
// sentence rules to numbers. Modifies the locale file in place.
//
// Usage:  node fix-escapes.js [--locale <code|path>]
// Input/Output: the locale (default zh-TW), rewritten in place
const { parseArgs } = require('./lib/cli');
const { loadLocale, saveLocale, DEFAULT_LOCALE } = require('./lib/locale');
const { opts } = parseArgs(process.argv.slice(2), { usage: 'node fix-escapes.js [--locale <code|path>]', options: { locale: DEFAULT_LOCALE } });
const l = loadLocale(opts.locale);
const BROKEN = '(s*[^A-Za-zs].*?)';
const GLUED_OK = '(\\s*[^A-Za-z\\s].*?)';
const GUARD = '([^a-z\\s].*?|\\S+?)';
const NUM = '(\\d[\\d,.]*)';
let fixed = 0;
for (const p of l.patterns) {
  const before = p.pattern;
  if (p.pattern.includes(BROKEN)) p.pattern = p.pattern.split(BROKEN).join(GLUED_OK);
  if (p.scope === 'sentence' && (p.pattern === `^${GUARD} of ${GUARD}$` || p.pattern === `^<>${GUARD} of ${GUARD}$`)) {
    p.pattern = p.pattern.split(GUARD).join(NUM);
    p.sample = p.sample.replace(/1/g, '3');
  }
  if (p.pattern !== before) {
    fixed++;
    console.log(p.id, p.pattern);
  }
  if (!new RegExp(p.pattern).test(p.sample)) throw new Error(`sample fails ${p.id}`);
}
saveLocale(opts.locale, l);
console.log('fixed', fixed, '| remaining broken', l.patterns.filter((p) => /\(s\*|\[d\]/.test(p.pattern)).length);
