// HISTORICAL EXAMPLE: one of the one-off scripts that patched the Antigravity
// 2.34 release end to end (zh-TW). Kept to show how such a release update is
// done; it is not a general tool. The data files it touches are command-line
// arguments.
//
// Adds the short 2.34 templates that merge-sweep.js drops as too generic,
// narrowed to numbers so they cannot catch prose. Modifies the locale in place.
//
// Usage:  node short-rules.js [--locale <code|path>]
// Input/Output: the locale (default zh-TW), rewritten in place
const { parseArgs } = require('../../../lib/cli');
const { loadLocale, saveLocale, DEFAULT_LOCALE } = require('../../../lib/locale');
const { opts } = parseArgs(process.argv.slice(2), { usage: 'node short-rules.js [--locale <code|path>]', options: { locale: DEFAULT_LOCALE } });
const l = loadLocale(opts.locale);
const N = '(\\d+)';
const rules = [
  [`^${N}s left$`, '剩餘 {1} 秒', '42s left'],
  [`^${N}d ${N}h ${N}m left$`, '剩餘 {1} 天 {2} 小時 {3} 分鐘', '1d 2h 3m left'],
  [`^${N}h ${N}m left$`, '剩餘 {1} 小時 {2} 分鐘', '2h 3m left'],
  [`^${N}h left$`, '剩餘 {1} 小時', '2h left'],
  [`^${N}m left$`, '剩餘 {1} 分鐘', '3m left'],
  [`^${N} days$`, '{1} 天', '30 days'],
  [`^Image ${N}$`, '圖片 {1}', 'Image 2'],
  [`^Line ${N} → ${N}$`, '第 {1} 行 → {2}', 'Line 4 → 9'],
  ['^(\\S.*?) \\(experimental\\)$', '{1}（實驗性）', 'Gemini Flash Next (experimental)'],
];
const srcs = new Set(l.patterns.map((p) => p.pattern));
let n = 0;
rules.forEach(([pattern, template, sample], i) => {
  if (srcs.has(pattern)) return;
  if (!new RegExp(pattern).test(sample)) throw new Error(`sample fails ${pattern}`);
  l.patterns.push({ id: `v234_${i + 1}`, pattern, template, sample });
  n++;
});
saveLocale(opts.locale, l);
console.log('added', n, 'patterns', l.patterns.length);
