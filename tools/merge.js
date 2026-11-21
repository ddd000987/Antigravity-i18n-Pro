// Merges the translated batch files into the locale: strings go to `text`,
// templates become anchored `patterns` rules. Existing (reviewed) translations
// are never overwritten. Modifies the locale file in place.
//
// Usage:  node merge.js <trDir> [--locale <code|path>]
// Input:  <trDir>/batch-N.out.json = { strings: { en: zh }, templates: { "...{1}...": "...{1}..." } }
//         (translated from the batch-N.json files written by batches.js)
// Output: the locale (default zh-TW) rewritten in place; counts and warnings on stdout
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('./lib/cli');
const { loadLocale, saveLocale, DEFAULT_LOCALE } = require('./lib/locale');
const { args: [trDir], opts } = parseArgs(process.argv.slice(2), {
  usage: 'node merge.js <trDir> [--locale <code|path>]', min: 1, max: 1, options: { locale: DEFAULT_LOCALE },
});
const locale = loadLocale(opts.locale);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MAINLAND = /設置|配置|運行|創建|默認|加載|消息|服務器|文件夾|視頻|屏幕|刷新|保存|窗口|用戶(?!端)|代碼/;

let added = 0, addedPatterns = 0, conflicts = 0, droppedGeneric = 0;
const warnings = [];
const existingIds = new Set((locale.patterns || []).map((p) => p.id));
const existingPatternSrc = new Set((locale.patterns || []).map((p) => p.pattern));

for (const file of fs.readdirSync(trDir).filter((f) => /^batch-\d+\.out\.json$/.test(f)).sort()) {
  const out = JSON.parse(fs.readFileSync(path.join(trDir, file), 'utf8'));
  for (const [en, zh] of Object.entries(out.strings || {})) {
    if (typeof zh !== 'string' || !zh.trim()) continue;
    if (MAINLAND.test(zh)) warnings.push(`mainland term: ${en} => ${zh}`);
    if (Object.prototype.hasOwnProperty.call(locale.text, en)) {
      if (locale.text[en] !== zh) conflicts++;
      continue; // keep the reviewed existing translation
    }
    locale.text[en] = zh;
    added++;
  }
  for (const [en, zh] of Object.entries(out.templates || {})) {
    if (typeof zh !== 'string' || !zh.trim()) continue;
    const ph = (s) => (s.match(/\{\d+\}/g) || []).sort().join();
    if (ph(en) !== ph(zh)) { warnings.push(`placeholder mismatch: ${en} => ${zh}`); continue; }
    if (MAINLAND.test(zh)) warnings.push(`mainland term: ${en} => ${zh}`);
    const parts = en.trim().split(/\{\d+\}/);
    // Too-generic templates ("{1} Name", "Continue{1}") would half-translate
    // unrelated text, so require at least two fixed English words.
    const fixedWords = parts.join(' ').match(/[A-Za-z]{2,}/g) || [];
    if (fixedWords.length < 2) { droppedGeneric++; continue; }
    // Placeholders in en are numbered in order, so group n is placeholder {n}.
    const pattern = '^' + parts.map(escapeRe).join('(.+?)') + '$';
    if (existingPatternSrc.has(pattern)) continue;
    existingPatternSrc.add(pattern);
    let id = 'ui' + (addedPatterns + 1);
    while (existingIds.has(id)) id += '_';
    existingIds.add(id);
    const sample = en.trim().replace(/\{\d+\}/g, 'X');
    locale.patterns.push({ id, pattern, template: zh.trim(), sample });
    addedPatterns++;
  }
}

saveLocale(opts.locale, locale);
console.log(`added strings ${added}, patterns ${addedPatterns}, dropped generic templates ${droppedGeneric}, kept-existing conflicts ${conflicts}`);
console.log(`total text ${Object.keys(locale.text).length}, patterns ${locale.patterns.length}`);
if (warnings.length) console.log('warnings:\n' + warnings.slice(0, 40).join('\n') + (warnings.length > 40 ? `\n... ${warnings.length - 40} more` : ''));
