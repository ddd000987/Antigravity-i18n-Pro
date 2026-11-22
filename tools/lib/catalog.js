// Reference catalog and glossary helpers for the batch translation workflow
// (todo.js, merge-todo.js, glossary-seed.js, new-locale.js).
//
// The catalog is built from zh-TW (DEFAULT_LOCALE) exactly like internal/core/catalog.go
// does: its keys are the English source strings, its pattern rules are the regexes every
// language reuses.
//
//   loadCatalog()            { ref, textKeys, menuKeys, dialogKeys, punctKeys,
//                              rules: [{ rule, source, groups }],
//                              valueMapNames, valueMapKeys: { name: [keys] },
//                              valueRules: { name: [entries] }, notes, notesFrom }
//   ruleSource(rule)         { source, groups }: the rule's sample as English with {n}
//                            in place of each top-level capture group
//   countGroups(pattern)     number of capturing groups of a JavaScript regex body
//   valueRuleSource(pattern) '(\d+) days?' -> '{1} days'
//   placeholderCounts(s)     { '1': 2, ... } for the {n} placeholders of s
//   markerCount(s)           number of <> inline-element markers in s
//   isPlural(v)              true for a plain object whose keys are all CLDR categories
//   findMissing(loc, cat, kinds)  work items a locale still lacks versus the catalog
//   loadTerms(), loadKeep(), loadGlossary(code), glossaryPath(code), saveGlossary(code, g)
//   termHits(text, terms)    terms (by en or forms) occurring in text as whole words, case-insensitive
//   keepHits(text, keep)     keep names occurring in text as whole words, case-sensitive
//   keepMisses(en, value, keep)  keep names of en that value lost (separators normalised)
//   renderings(entry)        a glossary entry (string or list of accepted renderings) as a list
//   glossaryMisses(en, value, lang, glossary, terms, keep)  checked terms of en not rendered in value
'use strict';
const fs = require('fs');
const path = require('path');
const { repoRoot, DEFAULT_LOCALE, loadLocale } = require('./locale');

const GLOSSARY_DIR = path.join(repoRoot, 'tools', 'glossary');
const NOTES_FILE = path.join(repoRoot, 'assets', 'catalog', 'notes.json');
const CLDR = ['zero', 'one', 'two', 'few', 'many', 'other'];
const ALL_KINDS = ['text', 'menu', 'dialog', 'pattern', 'valueMap', 'valueRule', 'punct'];
const DEFAULT_KINDS = ['text', 'menu', 'dialog', 'pattern', 'valueMap', 'valueRule'];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Port of jsCaptureGroups in internal/core/jsgroups.go.
function countGroups(pattern) {
  let count = 0;
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') { i++; continue; }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') {
      inClass = true;
      if (pattern[i + 1] === '^') i++;
      if (pattern[i + 1] === ']') i++;
    } else if (c === '(') {
      if (pattern[i + 1] !== '?') count++;
      else if (pattern[i + 2] === '<' && pattern[i + 3] !== '=' && pattern[i + 3] !== '!') count++;
    }
  }
  return count;
}

// Port of ruleSource in internal/core/catalog.go.
function ruleSource(rule) {
  const groups = countGroups(rule.pattern);
  let m = null;
  try {
    const flags = [...new Set((rule.flags || '').replace(/[^dgimsuvy]/g, '') + 'd')].join('');
    m = new RegExp(rule.pattern, flags).exec(rule.sample);
  } catch (err) {
    return { source: rule.sample, groups };
  }
  if (!m) return { source: rule.sample, groups };
  const spans = [];
  for (let g = 1; g < m.length; g++) {
    if (m.indices[g]) spans.push({ start: m.indices[g][0], end: m.indices[g][1], n: g });
  }
  spans.sort((a, b) => a.start - b.start); // Array#sort is stable
  let out = '';
  let at = 0;
  for (const sp of spans) {
    if (sp.start < at) continue; // nested inside the previous group
    out += rule.sample.slice(at, sp.start) + `{${sp.n}}`;
    at = sp.end;
  }
  return { source: out + rule.sample.slice(at), groups };
}

// A value rule's pattern as readable English: capture groups become {n}, the
// optional marker after a letter is dropped ("days?" -> "days"), escapes are
// unescaped, anchors and word boundaries vanish, and an alternation keeps its
// first branch.
function valueRuleSource(pattern) {
  let out = '';
  let n = 0;
  const groupStack = [];
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      const e = pattern[++i];
      if (e === 'b' || e === 'B') continue;
      if (e === 's') out += ' ';
      else if (e === 'd' || e === 'w') out += '';
      else out += e === undefined ? '' : e;
      continue;
    }
    if (c === '[') {
      while (i < pattern.length && pattern[i] !== ']') { if (pattern[i] === '\\') i++; i++; }
      continue;
    }
    if (c === '(') {
      if (groupStack.some((g) => g !== null)) { groupStack.push(null); continue; } // inside a capture group
      if (pattern[i + 1] === '?' && pattern[i + 2] === ':') { groupStack.push(null); i += 2; continue; }
      if (pattern[i + 1] === '?') { // lookaround or named group: skip the header
        const close = pattern.indexOf('>', i);
        if (pattern[i + 2] === '<' && pattern[i + 3] !== '=' && pattern[i + 3] !== '!' && close > 0) {
          groupStack.push(++n); out += `{${n}}`; i = close; continue;
        }
        groupStack.push(null); i += 2; continue;
      }
      groupStack.push(++n);
      out += `{${n}}`;
      continue;
    }
    if (c === ')') { groupStack.pop(); continue; }
    if (c === '|') { // keep the first branch of the innermost group
      let depth = 0;
      let j = i + 1;
      for (; j < pattern.length; j++) {
        if (pattern[j] === '\\') { j++; continue; }
        if (pattern[j] === '(') depth++;
        else if (pattern[j] === ')') { if (depth === 0) break; depth--; }
      }
      i = j - 1;
      continue;
    }
    if (c === '^' || c === '$' || c === '?' || c === '*' || c === '+' || c === '{') {
      if (c === '{') { const close = pattern.indexOf('}', i); if (close > 0) i = close; }
      continue;
    }
    if (groupStack.some((g) => g !== null)) continue; // inside a capture group
    out += c;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function placeholderCounts(s) {
  const out = {};
  for (const m of String(s).matchAll(/\{(\d+)\}/g)) out[m[1]] = (out[m[1]] || 0) + 1;
  return out;
}

function markerCount(s) {
  return String(s).split('<>').length - 1;
}

function isPlural(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return keys.length > 0 && keys.every((k) => CLDR.includes(k));
}

// True when two {n} multisets are equal.
function sameCounts(a, b) {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

function loadCatalog() {
  const ref = loadLocale(DEFAULT_LOCALE);
  let notes = {};
  let notesFrom = '';
  try {
    const n = readJson(NOTES_FILE);
    notes = n.text || {};
    notesFrom = n.generatedFrom || '';
  } catch (err) { /* notes are optional */ }
  const rules = [];
  for (const rule of ref.patterns || []) {
    if (!rule.id) continue;
    const { source, groups } = ruleSource(rule);
    rules.push({ rule, source, groups });
  }
  const valueMaps = ref.valueMaps || {};
  const valueMapKeys = {};
  for (const name of Object.keys(valueMaps)) valueMapKeys[name] = Object.keys(valueMaps[name]);
  return {
    ref,
    textKeys: Object.keys(ref.text || {}),
    menuKeys: Object.keys(ref.menu || {}),
    dialogKeys: Object.keys(ref.dialogs || {}),
    punctKeys: Object.keys(ref.punctuation || {}),
    rules,
    valueMapNames: Object.keys(valueMaps),
    valueMapKeys,
    valueRules: ref.valueRules || {},
    notes,
    notesFrom,
  };
}

// ---- Glossary -------------------------------------------------------------

function loadTerms() {
  return readJson(path.join(GLOSSARY_DIR, 'terms.json')).terms;
}

function loadKeep() {
  return readJson(path.join(GLOSSARY_DIR, 'keep.json')).keep;
}

function glossaryPath(code) {
  return path.join(GLOSSARY_DIR, `${code}.json`);
}

function loadGlossary(code) {
  try {
    const g = readJson(glossaryPath(code));
    return { language: g.language || code, notes: g.notes || [], terms: g.terms || {} };
  } catch (err) {
    return { language: code, notes: [], terms: {} };
  }
}

function saveGlossary(code, glossary) {
  fs.mkdirSync(GLOSSARY_DIR, { recursive: true });
  fs.writeFileSync(glossaryPath(code), JSON.stringify(glossary, null, 2) + '\n', 'utf8');
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = new Map();
function wholeWord(word, insensitive) {
  const key = (insensitive ? 'i:' : 's:') + word;
  let re = wordRe.get(key);
  if (!re) {
    re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(word)}(?![\\p{L}\\p{N}_])`, insensitive ? 'iu' : 'u');
    wordRe.set(key, re);
  }
  return re;
}

function termHits(text, terms) {
  return terms.filter((t) => [t.en, ...(t.forms || [])].some((w) => wholeWord(w, true).test(text)));
}

function keepHits(text, keep) {
  return keep.filter((name) => wholeWord(name, false).test(text));
}

// Keep names of `en` that `value` lost. Spaces, no-break spaces and hyphens count as the
// same separator, so German "Google-Cloud-Projekt" keeps "Google Cloud".
const sep = (s) => s.replace(/[\s  ‑-]+/g, ' ');
function keepMisses(en, value, keep) {
  const v = sep(value);
  return keepHits(en, keep).filter((name) => !v.includes(sep(name)));
}

// A glossary entry is one rendering or a list of accepted ones (the first is preferred).
const renderings = (entry) => (Array.isArray(entry) ? entry : entry ? [entry] : []);

// Glossary terms of `en` whose rendering is absent from `value`. Terms marked
// "check": false in terms.json (verbs and words with several senses) are skipped, and so
// is a term that is only part of a kept name ("Google Workspace"). CJK languages match the
// rendering as a substring; others ignore case and accept an inflected ending on each word
// of the rendering ("Рабочая область" matches "рабочей области").
const stem = (w) => (w.length > 4 ? w.slice(0, w.length > 7 ? -3 : -2) : w);
function glossaryMisses(en, value, lang, glossary, terms, keep) {
  let src = en;
  // longest first, so "Google Workspace" is masked before "Google"
  for (const name of [...keep].sort((a, b) => b.length - a.length)) if (/\s/.test(name) || name.length > 3) src = src.replace(new RegExp(wholeWord(name, false).source, 'gu'), ' ');
  const cjk = /^(ja|ko|zh)\b/i.test(lang);
  // The language's own case rules: in Turkish "İzinler" lowers to "izinler", not "i̇zinler".
  const lower = (s) => { try { return s.toLocaleLowerCase(lang); } catch { return s.toLowerCase(); } };
  const hay = lower(value);
  const found = (r) => (cjk ? value.includes(r)
    : hay.includes(lower(r)) || lower(r).split(/[\s-]+/).filter(Boolean).every((w) => hay.includes(stem(w))));
  const out = [];
  for (const t of termHits(src, terms)) {
    if (t.check === false) continue;
    const rs = renderings(glossary.terms[t.en]);
    if (rs.length && !rs.some(found)) out.push({ term: t.en, rendering: rs[0] });
  }
  return out;
}

// ---- Work items -----------------------------------------------------------

function noteFor(kind, cat, ctx) {
  if (kind === 'text') return cat.notes[ctx.key] || undefined;
  if (kind === 'menu') return 'Native menu item';
  if (kind === 'dialog') return 'Native dialog text';
  if (kind === 'pattern') {
    return ctx.groups
      ? `${ctx.scope === 'sentence' ? 'Whole-sentence' : 'Single-text'} pattern; ${[...Array(ctx.groups)].map((_, i) => `{${i + 1}}`).join(', ')} ${ctx.groups === 1 ? 'stands' : 'stand'} for the value(s) the app fills in`
      : 'Pattern with no values';
  }
  if (kind === 'valueMap') return ctx.usedBy
    ? `map ${ctx.map}: a word the app inserts as {${ctx.usedBy.group}} of "${ctx.usedBy.source}"`
    : `map ${ctx.map}: a value inserted into {1} of a pattern`;
  if (kind === 'valueRule') return `valueRule ${ctx.name}: one part of a duration such as "{1} days"; keep {1}`;
  return `punctuation: the mark your language writes in place of "${ctx.key}" after text`;
}

// Which pattern rule inserts each value map, for a more helpful note.
function mapUsers(cat) {
  const users = {};
  for (const { rule, source } of cat.rules) {
    for (const [group, name] of Object.entries(rule.replace || {})) {
      if (!users[name]) users[name] = { group, source };
    }
  }
  return users;
}

// The work items a locale still lacks versus the catalog, in catalog order per
// kind. Each item: { id, kind, en, note?, example?, ref } where ref names the
// catalog entry (key | ruleId | map+key | name).
function findMissing(loc, cat, kinds = DEFAULT_KINDS) {
  const want = new Set(kinds);
  const out = [];
  const add = (item) => { if (item.note === undefined) delete item.note; out.push(item); };
  const empty = (v) => typeof v !== 'string' || v.trim() === '';

  const flat = (kind, prefix, keys, section) => {
    if (!want.has(kind)) return;
    const have = loc[section] || {};
    keys.forEach((key, index) => {
      if (!empty(have[key])) return;
      add({ id: `${prefix}${index}`, kind, en: key, note: noteFor(kind, cat, { key }), ref: { key, index } });
    });
  };
  flat('text', 't', cat.textKeys, 'text');
  flat('menu', 'm', cat.menuKeys, 'menu');
  flat('dialog', 'd', cat.dialogKeys, 'dialogs');

  if (want.has('pattern')) {
    const byId = new Map((loc.patterns || []).map((p) => [p.id, p]));
    for (const { rule, source, groups } of cat.rules) {
      const have = byId.get(rule.id);
      const done = have && ((typeof have.template === 'string' && have.template.trim() !== '') ||
        (isPlural(have.templates) && typeof have.templates.other === 'string' && have.templates.other.trim() !== ''));
      if (done) continue;
      add({ id: `p:${rule.id}`, kind: 'pattern', en: source, example: rule.sample,
        note: noteFor('pattern', cat, { groups, scope: rule.scope }), ref: { ruleId: rule.id } });
    }
  }

  if (want.has('valueMap')) {
    const users = mapUsers(cat);
    for (const name of cat.valueMapNames) {
      const have = (loc.valueMaps || {})[name] || {};
      cat.valueMapKeys[name].forEach((key, index) => {
        if (key === '' || typeof have[key] === 'string') return;
        add({ id: `v:${name}:${index}`, kind: 'valueMap', en: key,
          note: noteFor('valueMap', cat, { map: name, usedBy: users[name] }), ref: { map: name, key, index } });
      });
    }
  }

  if (want.has('valueRule')) {
    for (const name of Object.keys(cat.valueRules)) {
      const have = (loc.valueRules || {})[name] || [];
      cat.valueRules[name].forEach((entry, index) => {
        if (have[index] && typeof have[index].template === 'string' && have[index].template.trim() !== '') return;
        add({ id: `r:${name}:${index}`, kind: 'valueRule', en: valueRuleSource(entry.pattern),
          note: noteFor('valueRule', cat, { name }), ref: { name, index } });
      });
    }
  }

  if (want.has('punct')) {
    const have = loc.punctuation || {};
    cat.punctKeys.forEach((key, index) => {
      if (!empty(have[key])) return;
      add({ id: `u${index}`, kind: 'punct', en: key, note: noteFor('punct', cat, { key }), ref: { key, index } });
    });
  }
  return out;
}

module.exports = {
  CLDR, ALL_KINDS, DEFAULT_KINDS,
  loadCatalog, ruleSource, countGroups, valueRuleSource, placeholderCounts, markerCount, isPlural, sameCounts,
  loadTerms, loadKeep, loadGlossary, saveGlossary, glossaryPath, termHits, keepHits, keepMisses, glossaryMisses, renderings, findMissing,
};
