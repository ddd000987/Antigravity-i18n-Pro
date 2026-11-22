// Audits whole language packs against tools/glossary: for every catalog text whose
// English contains a checked glossary term, reports translations that do not use the
// pack's glossary rendering, and translations that lost a name from keep.json. It is the
// same check merge-todo.js runs on new translations, applied to what a pack already has.
//
// Usage:  node glossary-check.js [--locale <code[,code...]|all>] [--term <en>] [--limit 20]
// Input:  the locales (default all bundled packs except zh-TW, the reference), the zh-TW
//         catalog, tools/glossary/
// Output: per language and term, the count and up to --limit examples on stdout
'use strict';
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('./lib/cli');
const { loadLocale, localePath, DEFAULT_LOCALE } = require('./lib/locale');
const C = require('./lib/catalog');

const { opts } = parseArgs(process.argv.slice(2), {
  usage: 'node glossary-check.js [--locale <code[,code...]|all>] [--term <en>] [--limit 20]',
  options: { locale: 'all', term: null, limit: '20' },
});
const limit = Number(opts.limit) || 20;
const dir = path.dirname(localePath(DEFAULT_LOCALE));
const codes = opts.locale === 'all'
  ? fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'locale.schema.json' && f !== `${DEFAULT_LOCALE}.json`).map((f) => f.slice(0, -5))
  : opts.locale.split(',').map((s) => s.trim()).filter(Boolean);

const cat = C.loadCatalog();
const terms = C.loadTerms().filter((t) => !opts.term || t.en === opts.term);
const keep = C.loadKeep();

for (const code of codes) {
  const loc = loadLocale(code);
  const glossary = C.loadGlossary(code);
  const byTerm = new Map();
  const add = (label, line) => {
    if (!byTerm.has(label)) byTerm.set(label, []);
    byTerm.get(label).push(line);
  };
  for (const en of cat.textKeys) {
    const value = (loc.text || {})[en];
    if (!value || value === en) continue;
    for (const g of C.glossaryMisses(en, value, code, glossary, terms, keep)) add(`${g.term} = ${g.rendering}`, `${en}  =>  ${value}`);
    if (!opts.term) for (const name of C.keepMisses(en, value, keep)) add(`keep ${name}`, `${en}  =>  ${value}`);
  }
  const total = [...byTerm.values()].reduce((n, l) => n + l.length, 0);
  console.log(`== ${code}: ${total} finding(s)`);
  for (const [label, lines] of [...byTerm].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${label}: ${lines.length}`);
    for (const l of lines.slice(0, limit)) console.log(`      ${l.length > 160 ? l.slice(0, 157) + '...' : l}`);
  }
}
