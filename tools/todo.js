// Lists what language packs still lack versus the reference catalog (zh-TW) and writes
// small work files for translators (people or models): todo-N.json batches plus a
// manifest.json that merge-todo.js uses to put the translations back. The format of the
// batches is described in translation-prompts/TRANSLATE.md.
//
// Several languages can share one run: each item is written once and its `need` field
// names the languages that still lack it. Items come in this order: text that is itself a
// glossary term (so the term renderings can be seeded early), the other text in catalog
// order, menu, dialogs, patterns, value maps, value rules and (only when asked) punctuation.
//
// Usage:  node todo.js <outDir> --locale <code|path>[,<code|path>...] [--size 400] [--kinds text,menu,dialog,pattern,valueMap,valueRule] [--dry]
// Input:  one or more locales (assets/locales/<code>.json), the zh-TW catalog, tools/glossary/
// Output: <outDir>/todo-N.json, <outDir>/manifest.json; a per-language summary on stdout.
//         --dry prints the summary and writes nothing. The kind `punct` is accepted but
//         not part of the default set.
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('./lib/cli');
const { loadLocale, localePath } = require('./lib/locale');
const C = require('./lib/catalog');

const usage = 'node todo.js <outDir> --locale <code|path>[,<code|path>...] [--size 400] [--kinds text,menu,dialog,pattern,valueMap,valueRule] [--dry]';
const { args, opts } = parseArgs(process.argv.slice(2), {
  usage, min: 1, max: 1,
  options: { locale: null, size: '400', kinds: C.DEFAULT_KINDS.join(',') },
  flags: ['dry'],
});
const fail = (msg) => { console.error(msg); console.error(`Usage: ${usage}`); process.exit(1); };
const outDir = path.resolve(args[0]);
if (!opts.locale) fail('--locale is required');
const size = Number(opts.size);
if (!Number.isInteger(size) || size < 1) fail('--size must be a positive integer');
const kinds = opts.kinds.split(',').map((s) => s.trim()).filter(Boolean);
for (const k of kinds) if (!C.ALL_KINDS.includes(k)) fail(`unknown kind "${k}" (kinds: ${C.ALL_KINDS.join(', ')})`);
const manifestFile = path.join(outDir, 'manifest.json');
if (!opts.dry && fs.existsSync(manifestFile)) {
  fail(`${manifestFile} already exists: pick a new folder (a finished run is merged with merge-todo.js)`);
}

const cat = C.loadCatalog();
const terms = C.loadTerms();
const keep = C.loadKeep();

// One entry per language: its locale, glossary and missing items.
const langs = opts.locale.split(',').map((s) => s.trim()).filter(Boolean).map((spec) => {
  const loc = loadLocale(spec);
  const code = loc.language;
  if (!code) fail(`${spec} has no "language" field`);
  return { spec, code, loc, glossary: C.loadGlossary(code), missing: C.findMissing(loc, cat, kinds) };
});
if (new Set(langs.map((l) => l.code)).size !== langs.length) fail('the same language is listed twice');

// Merge the per-language lists into one item list.
const byId = new Map();
for (const l of langs) {
  for (const it of l.missing) {
    if (!byId.has(it.id)) byId.set(it.id, { ...it, langs: [] });
    byId.get(it.id).langs.push(l.code);
  }
}
const termWords = new Set(terms.flatMap((t) => [t.en, ...(t.forms || [])]));
const rank = (it) => {
  if (it.kind === 'text') return termWords.has(it.en) ? 0 : 1;
  return 2 + C.ALL_KINDS.indexOf(it.kind);
};
// Catalog position of every item: what a language that lacks everything would get.
const position = new Map(C.findMissing({}, cat, kinds).map((it, i) => [it.id, i]));
const items = [...byId.values()].sort((a, b) => rank(a) - rank(b) || position.get(a.id) - position.get(b.id));

// Summary.
const total = (n) => n.toString().padStart(5);
for (const l of langs) {
  const counts = {};
  for (const it of l.missing) counts[it.kind] = (counts[it.kind] || 0) + 1;
  const detail = kinds.map((k) => `${k} ${counts[k] || 0}`).join(', ');
  console.log(`${l.code.padEnd(8)}${total(l.missing.length)} missing  (${detail})`);
}
const batchCount = Math.ceil(items.length / size);
console.log(`${items.length} distinct item(s) in ${batchCount} batch(es) of up to ${size}`);
if (!items.length) { console.log('nothing to translate'); process.exit(0); }
if (opts.dry) process.exit(0);

// Batches.
fs.mkdirSync(outDir, { recursive: true });
const multi = langs.length > 1;
const languageNames = {};
for (const l of langs) {
  const en = l.loc.englishName;
  languageNames[l.code] = en && en !== l.loc.name ? `${en} (${l.loc.name})` : (l.loc.name || en || l.code);
}
for (let b = 0; b < batchCount; b++) {
  const slice = items.slice(b * size, (b + 1) * size);
  const text = slice.map((it) => it.en).join('\n');
  const hits = C.termHits(text, terms);
  const glossary = {};
  const styleNotes = {};
  for (const l of langs) {
    const g = {};
    for (const t of hits) if (l.glossary.terms[t.en]) g[t.en] = l.glossary.terms[t.en];
    glossary[l.code] = g;
    if (l.glossary.notes.length) styleNotes[l.code] = l.glossary.notes;
  }
  const termNotes = {};
  for (const t of hits) if (t.means) termNotes[t.en] = t.means;
  const batch = {
    langs: langs.map((l) => l.code),
    languageNames,
    ...(Object.keys(styleNotes).length ? { styleNotes } : {}),
    glossary,
    termNotes,
    keep: C.keepHits(text, keep),
    items: slice.map((it) => {
      const out = { id: it.id, kind: it.kind, en: it.en };
      if (it.note) out.note = it.note;
      if (it.example !== undefined) out.example = it.example;
      if (multi && it.langs.length < langs.length) out.need = it.langs;
      return out;
    }),
  };
  fs.writeFileSync(path.join(outDir, `todo-${b + 1}.json`), JSON.stringify(batch, null, 2) + '\n', 'utf8');
}

const manifestItems = {};
for (const it of items) manifestItems[it.id] = { kind: it.kind, ...it.ref };
const manifest = {
  created: new Date().toISOString(),
  langs: langs.map((l) => ({ code: l.code, path: localePath(l.spec) })),
  size,
  batches: batchCount,
  items: manifestItems,
};
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`wrote ${batchCount} batch file(s) and manifest.json to ${outDir}`);
