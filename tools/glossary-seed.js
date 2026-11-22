// Seeds tools/glossary/<code>.json from a language pack: for every term in
// glossary/terms.json it takes the pack's own rendering of the standalone string (the
// text entry for the term itself, else for one of its other forms, else a lower-case or
// capitalised variant). Existing style notes and term renderings are kept unless --force.
// Run it after the first translated batch of a new language, so later batches (todo.js)
// carry the glossary, and after fixing a term in a pack to record the corrected rendering.
//
// Usage:  node glossary-seed.js --locale <code[,code...]|all> [--force]
// Input:  the locale pack(s); glossary/terms.json; the existing glossary/<code>.json
// Output: glossary/<code>.json ({ language, notes, terms }); the terms not found on stdout.
//         `all` means every pack in assets/locales.
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('./lib/cli');
const { repoRoot, loadLocale } = require('./lib/locale');
const { loadTerms, loadGlossary, saveGlossary } = require('./lib/catalog');

const { opts } = parseArgs(process.argv.slice(2), {
  usage: 'node glossary-seed.js --locale <code[,code...]|all> [--force]',
  options: { locale: null }, flags: ['force'],
});
if (!opts.locale) {
  console.error('--locale is required\nUsage: node glossary-seed.js --locale <code[,code...]|all> [--force]');
  process.exit(1);
}
const specs = opts.locale === 'all'
  ? fs.readdirSync(path.join(repoRoot, 'assets', 'locales')).filter((f) => /\.json$/.test(f) && f !== 'locale.schema.json').map((f) => f.slice(0, -5))
  : opts.locale.split(',').map((s) => s.trim()).filter(Boolean);
const terms = loadTerms();

const variants = (word) => [word, word.toLowerCase(), word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()];

for (const spec of specs) {
  const loc = loadLocale(spec);
  const code = loc.language;
  const text = loc.text || {};
  const found = (k) => typeof text[k] === 'string' && text[k].trim() !== '' && !text[k].includes('<>') ? text[k] : null;
  const old = loadGlossary(code);
  const out = {};
  const missing = [];
  for (const t of terms) {
    if (!opts.force && old.terms[t.en]) { out[t.en] = old.terms[t.en]; continue; }
    let rendering = null;
    for (const w of [t.en, ...(t.forms || [])]) {
      for (const v of variants(w)) { rendering = found(v); if (rendering) break; }
      if (rendering) break;
    }
    if (rendering) out[t.en] = rendering;
    else if (old.terms[t.en]) out[t.en] = old.terms[t.en];
    else missing.push(t.en);
  }
  // Keep entries for terms that were removed from terms.json instead of losing them silently.
  for (const [k, v] of Object.entries(old.terms)) if (!(k in out) && !terms.some((t) => t.en === k)) out[k] = v;
  saveGlossary(code, { language: code, notes: old.notes, terms: out });
  console.log(`${code}: ${Object.keys(out).length} term(s)${missing.length ? `, not found: ${missing.join(', ')}` : ''}`);
}
