// Puts the pattern rules in their final order: specific sentence rules first,
// then the per-node rules, then the short (generic) sentence rules, then a
// shadowing pass so no rule is hidden behind an earlier, more generic one.
// Run it after every merge. Modifies the locale file in place.
//
// Usage:  node order-rules.js [--locale <code|path>]
// Input/Output: the locale (default zh-TW), rewritten in place; rule counts on stdout
const { parseArgs } = require('./lib/cli');
const { loadLocale, saveLocale, DEFAULT_LOCALE } = require('./lib/locale');
const { opts } = parseArgs(process.argv.slice(2), { usage: 'node order-rules.js [--locale <code|path>]', options: { locale: DEFAULT_LOCALE } });
const l = loadLocale(opts.locale);
function fixedLetters(p) {
  let s = p.pattern;
  s = s.split('(.+?)').join('');
  s = s.replace(/\((?:\\s\*)?\[[^\]]*\][^)]*\)/g, ''); // guarded captures like ([^a-z\s].*?|\S+?)
  s = s.replace(/\(\?:[^)]*\)\??/g, '');
  s = s.replace(/<>/g, '').replace(/\\./g, (m) => m[1]);
  return s.replace(/[^A-Za-z]/g, '').length;
}
const isSentence = (p) => p.scope === 'sentence';
const longS = l.patterns.filter((p) => isSentence(p) && fixedLetters(p) >= 10);
const shortS = l.patterns.filter((p) => isSentence(p) && fixedLetters(p) < 10);
const rest = l.patterns.filter((p) => !isSentence(p));
l.patterns = [...longS, ...rest, ...shortS];
// Shadowing: in sentence mode every rule is live, in node mode only the
// non-sentence ones; move a rule ahead of any earlier rule that catches its
// sample in a mode where both apply.
const re = (p) => new RegExp(p.pattern, p.flags || '');
for (let pass = 0; pass < 60; pass++) {
  let moved = false;
  for (let i = 0; i < l.patterns.length; i++) {
    const p = l.patterns[i];
    const j = l.patterns.findIndex((q) => (isSentence(p) || !isSentence(q)) && re(q).test(p.sample));
    if (j !== -1 && j < i) { l.patterns.splice(i, 1); l.patterns.splice(j, 0, p); moved = true; }
  }
  if (!moved) break;
}
saveLocale(opts.locale, l);
console.log('long sentence', longS.length, 'per-node', rest.length, 'short sentence', shortS.length);
