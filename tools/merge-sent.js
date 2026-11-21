// Merges the translated sentence files (whole-sentence translations for the
// engine's sentence layer) into the locale: text items go to `text`, pattern
// items to `patterns` (with value maps for translated dynamic values). The term
// tables are zh-TW specific. Modifies the locale file in place.
//
// Usage:  node merge-sent.js <trDir> [--locale <code|path>]
// Input:  <trDir>/sentences.json (written by sentences.js) and
//         <trDir>/sent-N.out.json = { items: { "<key>": { zh, values? } } }
// Output: the locale (default zh-TW) rewritten in place; counts and problems on stdout
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('./lib/cli');
const { loadLocale, saveLocale, DEFAULT_LOCALE } = require('./lib/locale');
const { args: [trDir], opts } = parseArgs(process.argv.slice(2), {
  usage: 'node merge-sent.js <trDir> [--locale <code|path>]', min: 1, max: 1, options: { locale: DEFAULT_LOCALE },
});
const loc = loadLocale(opts.locale);
const extracted = new Map(JSON.parse(fs.readFileSync(path.join(trDir, 'sentences.json'), 'utf8')).map((i) => [i.key, i]));
const CJK = '㐀-鿿';
const TERMS = [[/帳號/g, '帳戶'], [/瞭解/g, '了解'], [/點擊/g, '點選'], [/Token/g, 'token'], [/概覽/g, '總覽'], [/查看器/g, '檢視器']];
const PAREN = new RegExp(`([${CJK}]) ?\\(([^()]*)\\)`, 'g');
const norm = (s) => { let o = s; for (const [re, to] of TERMS) o = o.replace(re, to); return o.replace(PAREN, '$1（$2）'); };
const count = (s, sub) => s.split(sub).length - 1;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// RE2-compatible guard for short rules: the value starts with a
// non-lowercase character or is a single token (not running prose).
const GUARD = '([^a-z\\s].*?|\\S+?)';

/**
 * Narrow each (.+?) of a sentence rule and build a sample that matches it.
 * - a value with a translation map becomes the alternation of its known values;
 * - a value glued to a letter may not continue that word ("Delete" + "d ...");
 * - in a short rule, a value that continues a phrase gets GUARD.
 */
function tighten(key, values) {
  const parts = key.split('(.+?)');
  const fixedLetters = key.replace(/\(\.\+\?\)|\(\?:[^)]*\)\??|<>|[\^$\\]/g, '').replace(/[^A-Za-z]/g, '').length;
  let pattern = parts[0];
  let sample = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const before = parts[i - 1];
    const after = parts[i];
    const known = Object.keys(values[`{${i}}`] || {});
    let group;
    let token = '1';
    if (known.length) {
      group = '(' + known.map(escRe).join('|') + ')';
      token = known[0];
    }
    else if (/[A-Za-z]$/.test(before) && /^[A-Za-z]/.test(after)) group = '([^A-Za-z].*?[^A-Za-z]|[^A-Za-z])';
    else if (/[A-Za-z]$/.test(before)) group = '([^A-Za-z].*?)';
    else if (/^[A-Za-z]/.test(after)) group = '(.*?[^A-Za-z])';
    else if (fixedLetters < 10 && !/(:\s*|\\\(|["'“‘「])$/.test(before)) group = GUARD;
    else group = '(.+?)';
    pattern += group + after;
    sample += token + after;
  }
  sample = sample
    .replace(/^\^|\$$/g, '')
    .replace(/\(\?:([^|)]*)(\|[^)]*)?\)\??/g, '$1')
    .replace(/\\(.)/g, '$1');
  return { pattern, sample };
}
const problems = [];
let texts = 0, pats = 0, maps = 0;
loc.valueMaps = loc.valueMaps || {};
const newPatterns = [];
let seq = 0;
const existingIds = new Set(loc.patterns.map((p) => p.id));

for (const f of fs.readdirSync(trDir).filter((x) => /^sent-\d+\.out\.json$/.test(x)).sort()) {
  const out = JSON.parse(fs.readFileSync(path.join(trDir, f), 'utf8'));
  for (const [key, item] of Object.entries(out.items || {})) {
    const src = extracted.get(key);
    if (!src) { problems.push(`unknown key ${key}`); continue; }
    const zh = norm(item.zh || '');
    const groups = src.kind === 'pattern' ? count(key, '(.+?)') : 0;
    if (!zh.trim()) { problems.push(`empty ${key}`); continue; }
    if (count(zh, '<>') !== count(key, '<>')) { problems.push(`marker count ${key} => ${zh}`); continue; }
    const ph = (zh.match(/\{\d+\}/g) || []).sort().join();
    const want = Array.from({ length: groups }, (_, i) => `{${i + 1}}`).sort().join();
    if (ph !== want) { problems.push(`placeholders ${key} => ${zh}`); continue; }
    if (src.kind === 'text') {
      if (!loc.text[key]) { loc.text[key] = zh; texts++; }
      continue;
    }
    const replace = {};
    for (const [phKey, values] of Object.entries(item.values || {})) {
      const n = Number(phKey.replace(/[{}]/g, ''));
      const cap = src.captures[n - 1];
      if (!cap || !values || !Object.keys(values).length) continue;
      const name = 's_' + (cap.prop || `${seq + 1}_${n}`);
      loc.valueMaps[name] = loc.valueMaps[name] || {};
      for (const [en, v] of Object.entries(values)) {
        const val = norm(v);
        const prev = loc.valueMaps[name][en.toLowerCase()];
        if (prev && prev !== val) problems.push(`value map conflict ${name}.${en}: ${prev} vs ${val} (kept first)`);
        else if (!prev) { loc.valueMaps[name][en.toLowerCase()] = val; maps++; }
      }
      replace[String(n)] = name;
    }
    let id;
    do { id = 's' + (++seq); } while (existingIds.has(id));
    existingIds.add(id);
    const { pattern, sample } = tighten(key, item.values || {});
    const rule = { id, pattern, template: zh, sample, scope: 'sentence' };
    if (Object.keys(replace).length) rule.replace = replace;
    if (!new RegExp(pattern).test(sample)) { problems.push(`sample does not match ${pattern} / ${sample}`); continue; }
    newPatterns.push(rule);
    pats++;
  }
}
// Sentence rules go right after the original hand-written rules, ahead of
// the generic ui* rules; the shadowing pass below fixes any remaining order.
const firstUi = loc.patterns.findIndex((p) => p.id.startsWith('ui'));
loc.patterns.splice(firstUi < 0 ? loc.patterns.length : firstUi, 0, ...newPatterns);
const re = (p) => new RegExp(p.pattern, p.flags || '');
for (let pass = 0; pass < 50; pass++) {
  let moved = false;
  for (let i = 0; i < loc.patterns.length; i++) {
    const p = loc.patterns[i];
    if (!p.sample) continue;
    const j = loc.patterns.findIndex((q) => re(q).test(p.sample));
    if (j !== -1 && j < i) { loc.patterns.splice(i, 1); loc.patterns.splice(j, 0, p); moved = true; }
  }
  if (!moved) break;
}
saveLocale(opts.locale, loc);
console.log(`text ${texts}, patterns ${pats}, value-map entries ${maps}; totals text ${Object.keys(loc.text).length}, patterns ${loc.patterns.length}, valueMaps ${Object.keys(loc.valueMaps).length}`);
if (problems.length) console.log('problems:\n' + problems.join('\n'));
