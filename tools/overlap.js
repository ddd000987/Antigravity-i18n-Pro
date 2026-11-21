// Compares the locale with another dictionary (for example the upstream
// zh-Hant file of a sibling project): key overlap, and which of the other
// dictionary's missing keys occur in the bundle.
//
// Usage:  node overlap.js <other-dictionary.json> <bundle.js> [--locale <code|path>]
// Input:  the other dictionary ({ text, patterns, ... }) and the UI bundle
// Output: counts and samples on stdout
const fs = require('fs');
const { parseArgs } = require('./lib/cli');
const { loadLocale, DEFAULT_LOCALE } = require('./lib/locale');
const { args: [upPath, jsPath], opts } = parseArgs(process.argv.slice(2), {
  usage: 'node overlap.js <other-dictionary.json> <bundle.js> [--locale <code|path>]', min: 2, max: 2, options: { locale: DEFAULT_LOCALE },
});
const ours = loadLocale(opts.locale);
const up = JSON.parse(fs.readFileSync(upPath, 'utf8'));
const mainjs = fs.readFileSync(jsPath, 'utf8');
const n = s => s.trim().replace(/\s+/g,' ');
const U = new Set(Object.keys(up.text).map(n)), O = new Set(Object.keys(ours.text).map(n));
const onlyOurs = [...O].filter(k=>!U.has(k)), onlyUp=[...U].filter(k=>!O.has(k));
console.log('ours',O.size,'upstream',U.size,'both',[...O].filter(k=>U.has(k)).length,'onlyOurs',onlyOurs.length,'onlyUpstream',onlyUp.length);
// are upstream-only strings present in the 2.33 bundle?
const inBundle = onlyUp.filter(k=>mainjs.includes(k));
console.log('onlyUpstream found in the bundle', inBundle.length, '| sample:', inBundle.slice(0,15).join(' | '));
console.log('onlyUpstream not in bundle sample:', onlyUp.filter(k=>!mainjs.includes(k)).slice(0,15).join(' | '));
console.log('upstream patterns', up.patterns.length, 'dialogs', Object.keys(up.dialogs||{}).length, 'menu', Object.keys(up.menu||{}).length, 'ours menu', Object.keys(ours.menu||{}).length);
