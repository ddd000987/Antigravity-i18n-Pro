// HISTORICAL one-off patch, kept as an example of adding hand-written rules:
// adds the home-screen greetings (picked at random, with or without the user's
// first name), which live in an object literal the extractor skipped. The
// translations are zh-TW. Modifies the locale file in place.
//
// Usage:  node greet.js [--locale <code|path>]
// Input/Output: the locale (default zh-TW), rewritten in place
const { parseArgs } = require('./lib/cli');
const { loadLocale, saveLocale, DEFAULT_LOCALE } = require('./lib/locale');
const { opts } = parseArgs(process.argv.slice(2), { usage: 'node greet.js [--locale <code|path>]', options: { locale: DEFAULT_LOCALE } });
const l = loadLocale(opts.locale);
Object.assign(l.text, {
  'Hey there, what should we build today?': '嗨，今天要做點什麼？',
  'Welcome back. Where should we pick up?': '歡迎回來。要從哪裡繼續？',
  "Good to see you. What's next?": '很高興見到您。接下來要做什麼？',
});
const rules = [
  { id: 'greet1', pattern: '^Hey (.+?), what should we build today\\?$', template: '嗨，{1}，今天要做點什麼？', sample: 'Hey Ann, what should we build today?' },
  { id: 'greet2', pattern: '^Welcome back, (.+?)\\. Where should we pick up\\?$', template: '歡迎回來，{1}。要從哪裡繼續？', sample: 'Welcome back, Ann. Where should we pick up?' },
  { id: 'greet3', pattern: "^Good to see you, (.+?)\\. What's next\\?$", template: '很高興見到您，{1}。接下來要做什麼？', sample: "Good to see you, Ann. What's next?" },
];
l.patterns = l.patterns.filter((p) => !p.id.startsWith('greet'));
l.patterns.unshift(...rules);
saveLocale(opts.locale, l);
for (const r of rules) console.log(r.id, new RegExp(r.pattern).test(r.sample));
