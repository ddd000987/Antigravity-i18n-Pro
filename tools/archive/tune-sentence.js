// HISTORICAL one-off pass, kept for reference: tightens short sentence rules
// and orders them after every specific rule (order-rules.js now does the
// ordering). Note the escapes in the string constants below were lost in this
// version; fix-escapes.js repaired the result. Modifies the locale file in place.
//
// Usage:  node tune-sentence.js [--locale <code|path>]
// Input/Output: the locale (default zh-TW), rewritten in place
const { parseArgs } = require('../lib/cli');
const { loadLocale, saveLocale, DEFAULT_LOCALE } = require('../lib/locale');
const { opts } = parseArgs(process.argv.slice(2), { usage: 'node tune-sentence.js [--locale <code|path>]', options: { locale: DEFAULT_LOCALE } });
const l = loadLocale(opts.locale);
const GLUED = '([^A-Za-z].*?)';
const GUARD = '([^a-z\s].*?|\S+?)';
const NUM = '([\d][\d,.]*)';
const fixedLetters = (p) => p.pattern.replace(/\([^)]*\)\??/g, '').replace(/<>|[\^$\]/g, '').replace(/[^A-Za-z]/g, '').length;
let tuned = 0;
for (const p of l.patterns) {
  if (p.scope !== 'sentence') continue;
  const before = p.pattern;
  // A value glued to a word ("Runs" + x) must not start with a space + word.
  p.pattern = p.pattern.split(GLUED).join('(\s*[^A-Za-z\s].*?)');
  // "{1} of {2}" only makes sense for counts.
  if (/^\^(<>)?\(\[\^a-z\s\]\.\*\?\|\S\+\?\) of \(\[\^a-z\s\]\.\*\?\|\S\+\?\)\$$/.test(p.pattern)) {
    p.pattern = p.pattern.split(GUARD).join(NUM);
  }
  if (p.pattern !== before) tuned++;
  if (!new RegExp(p.pattern).test(p.sample)) throw new Error(`sample fails ${p.id} ${p.pattern} / ${p.sample}`);
}
// Short sentence rules go last so a longer, specific rule always wins.
const shortSentence = (p) => p.scope === 'sentence' && fixedLetters(p) < 10;
l.patterns = [...l.patterns.filter((p) => !shortSentence(p)), ...l.patterns.filter(shortSentence)];
saveLocale(opts.locale, l);
console.log('tuned', tuned, 'short sentence rules moved last', l.patterns.filter(shortSentence).length);
