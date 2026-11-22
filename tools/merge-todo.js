// Merges translated work files from todo.js back into the language packs. Reads
// manifest.json and every todo-N.out.json in <outDir> (with the todo-N.json beside it),
// validates each value, writes the good ones and reports the rest.
//
//   rejected (not written, listed in problems.json): unknown id, a value that is not a
//     non-empty string (or, for patterns, a valid plural object), a different number of <>
//     markers, different {n} placeholders, different leading/trailing whitespace, a
//     placeholder beyond the rule's capture groups
//   warnings (written, listed in review.json): value equal to the English (also recorded in
//     allowSourceEqual), a keep name that was lost, a glossary term rendered differently,
//     a lost trailing ellipsis
//
// Single-language outputs are { id: value }; multi-language outputs are { id: { code: value } }.
// Nothing already in a pack is reordered: a new key goes after the closest preceding catalog
// key. New pattern rules are copied from zh-TW; order-rules.js runs on every pack whose
// patterns changed. Running it again on the same files changes nothing.
//
// Usage:  node merge-todo.js <outDir> [--no-order]
// Input:  <outDir>/manifest.json, todo-N.json, todo-N.out.json
// Output: the language packs in place; <outDir>/problems.json and <outDir>/review.json
//         (removed when empty); a per-language summary on stdout
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseArgs } = require('./lib/cli');
const { loadLocale, saveLocale } = require('./lib/locale');
const C = require('./lib/catalog');

const { args, opts } = parseArgs(process.argv.slice(2), {
  usage: 'node merge-todo.js <outDir> [--no-order]', min: 1, max: 1, flags: ['no-order'],
});
const outDir = path.resolve(args[0]);
const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
const cat = C.loadCatalog();
const terms = C.loadTerms();
const keep = C.loadKeep();
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const ruleById = new Map(cat.rules.map((r) => [r.rule.id, r]));
const SECTION = { text: 'text', menu: 'menu', dialog: 'dialogs' };

// ---- Validation -----------------------------------------------------------

const edges = (s) => [s.match(/^\s*/)[0], s.match(/\s*$/)[0]];
const fmtCounts = (c) => Object.keys(c).sort().map((k) => `{${k}}${c[k] > 1 ? `x${c[k]}` : ''}`).join(' ') || 'none';

// Returns an error message, or null when the value may be written.
function hardCheck(item, mf, value) {
  const en = item.en;
  let forms; // [[formName, string]]
  if (typeof value === 'string') {
    forms = [['', value]];
  } else if (item.kind === 'pattern' && C.isPlural(value)) {
    forms = Object.entries(value);
    if (typeof value.other !== 'string' || !value.other.trim()) return 'plural object needs a non-empty "other" form';
  } else {
    return item.kind === 'pattern' ? 'value must be a non-empty string or an object of plural forms (zero, one, two, few, many, other)'
      : 'value must be a non-empty string';
  }
  const plural = typeof value !== 'string';
  const want = C.placeholderCounts(en);
  const groups = item.kind === 'pattern' && ruleById.has(mf.ruleId) ? ruleById.get(mf.ruleId).groups : null;
  for (const [form, v] of forms) {
    const at = plural ? `form "${form}": ` : '';
    if (typeof v !== 'string' || !v.trim()) return `${at}empty or not a string`;
    if (C.markerCount(v) !== C.markerCount(en)) return `${at}has ${C.markerCount(v)} <> marker(s), the source has ${C.markerCount(en)}`;
    // The sentence layer drops a translation that puts text where the source has no
    // text node (TestSentenceTextsKeepEmptySlots in internal/core).
    if (item.kind === 'text') {
      const to = v.split('<>');
      const slot = en.split('<>').findIndex((s, i) => !s.trim() && to[i].trim());
      if (slot >= 0) return `${at}puts text in <> slot ${slot}, which is empty in the source`;
    }
    const [a, b] = edges(en);
    const [c, d] = edges(v);
    if (a !== c || b !== d) return `${at}leading/trailing whitespace differs from the source`;
    const got = C.placeholderCounts(v);
    if (groups !== null) for (const n of Object.keys(got)) if (Number(n) > groups) return `${at}{${n}} is beyond the rule's ${groups} capture group(s)`;
    if (!plural || form === 'other') {
      if (!C.sameCounts(got, want)) return `${at}placeholders ${fmtCounts(got)} differ from the source ${fmtCounts(want)}`;
    } else {
      for (const n of Object.keys(got)) if (!has(want, n)) return `${at}unknown placeholder {${n}}`;
    }
  }
  return null;
}

const ends = (s) => /(\.\.\.|…)$/.test(s);

function softChecks(item, value, lang, glossary) {
  const out = [];
  const text = typeof value === 'string' ? value : Object.values(value).join('\n');
  const en = item.en;
  if (SECTION[item.kind] && value === en) out.push('equal to the English source');
  for (const name of C.keepMisses(en, text, keep)) out.push(`keep name "${name}" is missing`);
  for (const g of C.glossaryMisses(en, text, lang, glossary, terms, keep)) out.push(`glossary term "${g.term}" is not rendered as "${g.rendering}"`);
  if (ends(en) && !(typeof value === 'string' ? ends(value) : Object.values(value).every(ends))) out.push('the source ends with an ellipsis, the value does not');
  return out;
}

// ---- Applying values ------------------------------------------------------

// Puts the updates into an existing map without moving anything that is already there:
// a changed value stays in place, a new key goes right after the closest preceding catalog
// key the map has (so a new pack ends up in catalog order, and a pack's own extra keys stay
// where they are).
function rebuild(existing, catalogKeys, updates) {
  const order = Object.keys(existing);
  const present = new Set(order);
  const catIndex = new Map(catalogKeys.map((k, i) => [k, i]));
  const fresh = Object.keys(updates).filter((k) => !has(existing, k))
    .sort((x, y) => (catIndex.has(x) ? catIndex.get(x) : Infinity) - (catIndex.has(y) ? catIndex.get(y) : Infinity));
  for (const k of fresh) {
    let at = order.length; // a key the catalog does not know goes last
    if (catIndex.has(k)) {
      at = 0;
      for (let i = catIndex.get(k) - 1; i >= 0; i--) {
        if (present.has(catalogKeys[i])) { at = order.indexOf(catalogKeys[i]) + 1; break; }
      }
    }
    order.splice(at, 0, k);
    present.add(k);
  }
  const out = {};
  for (const k of order) out[k] = has(updates, k) ? updates[k] : existing[k];
  return out;
}

// Sets the template (or plural templates) of a rule, in the place of the old one. A rule
// that has none gets it right after its pattern, as in the bundled packs.
function withTemplate(rule, value) {
  const key = typeof value === 'string' ? 'template' : 'templates';
  const hasOld = has(rule, 'template') || has(rule, 'templates');
  const out = {};
  let placed = false;
  for (const [k, v] of Object.entries(rule)) {
    if (k === 'template' || k === 'templates') {
      if (!placed) { out[key] = value; placed = true; }
    } else {
      out[k] = v;
      if (k === 'pattern' && !hasOld) { out[key] = value; placed = true; }
    }
  }
  if (!placed) out[key] = value;
  return out;
}

function insertAfter(obj, after, key, value) {
  const out = {};
  let done = false;
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v;
    if (k === after && !done) { out[key] = value; done = true; }
  }
  if (!done) out[key] = value;
  return out;
}

function applyAll(state) {
  let loc = state.loc;
  const sectionUpdates = { text: {}, menu: {}, dialogs: {} };
  const mapUpdates = {};
  let patternsChanged = false;
  for (const u of state.accepted) {
    const { mf, value, kind } = u;
    if (SECTION[kind]) {
      sectionUpdates[SECTION[kind]][mf.key] = value;
      const existing = loc[SECTION[kind]] || {};
      if (!has(existing, mf.key) || existing[mf.key] !== value) u.changed = true;
    }
    else if (kind === 'pattern') {
      loc.patterns = loc.patterns || [];
      const i = loc.patterns.findIndex((p) => p.id === mf.ruleId);
      const next = i >= 0
        ? withTemplate(loc.patterns[i], value)
        : withTemplate(ruleById.get(mf.ruleId).rule, value); // a new rule: zh-TW's fields with the translation
      if (JSON.stringify(next) !== JSON.stringify(i >= 0 ? loc.patterns[i] : null)) {
        if (i >= 0) loc.patterns[i] = next; else loc.patterns.push(next);
        patternsChanged = true;
        u.changed = true;
      }
    } else if (kind === 'valueMap') {
      (mapUpdates[mf.map] = mapUpdates[mf.map] || {})[mf.key] = value;
      const existing = (loc.valueMaps || {})[mf.map] || {};
      if (!has(existing, mf.key) || existing[mf.key] !== value) u.changed = true;
    } else if (kind === 'valueRule') {
      loc.valueRules = loc.valueRules || {};
      const list = loc.valueRules[mf.name] = loc.valueRules[mf.name] || [];
      const ref = cat.valueRules[mf.name][mf.index];
      while (list.length < mf.index) list.push({ ...cat.valueRules[mf.name][list.length], template: '' });
      const next = list[mf.index] ? { ...list[mf.index], template: value } : { ...ref, template: value };
      if (JSON.stringify(next) !== JSON.stringify(list[mf.index])) { list[mf.index] = next; u.changed = true; }
    } else if (kind === 'punct') {
      loc.punctuation = loc.punctuation || {};
      if (loc.punctuation[mf.key] !== value) { loc.punctuation[mf.key] = value; u.changed = true; }
    }
  }
  const catalogKeys = { text: cat.textKeys, menu: cat.menuKeys, dialogs: cat.dialogKeys };
  for (const section of Object.keys(sectionUpdates)) {
    const updates = sectionUpdates[section];
    if (!Object.keys(updates).length) continue;
    const existing = loc[section] || {};
    loc[section] = rebuild(existing, catalogKeys[section], updates);
  }
  for (const name of Object.keys(mapUpdates)) {
    loc.valueMaps = loc.valueMaps || {};
    const existing = loc.valueMaps[name] || {};
    // The empty word maps to nothing in every language; todo.js never asks for it.
    if (has(cat.ref.valueMaps[name] || {}, '') && cat.ref.valueMaps[name][''] === '' && !has(existing, '')) mapUpdates[name][''] = '';
    loc.valueMaps[name] = rebuild(existing, cat.valueMapKeys[name] || [], mapUpdates[name]);
  }
  // allowSourceEqual: text values equal to their key are recorded, others removed.
  let ase = Array.isArray(loc.allowSourceEqual) ? [...loc.allowSourceEqual] : null;
  const before = JSON.stringify(ase);
  for (const key of Object.keys(sectionUpdates.text)) {
    const v = sectionUpdates.text[key];
    if (v === key) { ase = ase || []; if (!ase.includes(key)) ase.push(key); }
    else if (ase && ase.includes(key)) ase = ase.filter((k) => k !== key);
  }
  if (JSON.stringify(ase) !== before) {
    if (ase && ase.length) {
      if (has(loc, 'allowSourceEqual')) loc.allowSourceEqual = ase;
      else loc = insertAfter(loc, 'dir', 'allowSourceEqual', ase);
    } else {
      delete loc.allowSourceEqual;
    }
  }
  state.loc = loc;
  return patternsChanged;
}

// ---- Run ------------------------------------------------------------------

const states = {};
for (const l of manifest.langs) {
  const loc = loadLocale(l.path);
  states[l.code] = {
    code: l.code, path: l.path, loc, original: JSON.stringify(loc),
    glossary: C.loadGlossary(l.code), accepted: [], problems: [], review: [], rejected: 0, ignored: 0,
  };
}

const batchFiles = fs.readdirSync(outDir).map((f) => f.match(/^todo-(\d+)\.json$/)).filter(Boolean)
  .map((m) => Number(m[1])).sort((a, b) => a - b);
let outFiles = 0;
for (const n of batchFiles) {
  const outFile = path.join(outDir, `todo-${n}.out.json`);
  if (!fs.existsSync(outFile)) continue;
  const batch = JSON.parse(fs.readFileSync(path.join(outDir, `todo-${n}.json`), 'utf8'));
  let out;
  try {
    out = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  } catch (err) {
    console.error(`todo-${n}.out.json is not valid JSON (${err.message}); skipped`);
    continue;
  }
  outFiles++;
  const items = new Map(batch.items.map((it) => [it.id, it]));
  const single = batch.langs.length === 1;
  for (const [id, raw] of Object.entries(out)) {
    const item = items.get(id);
    const mf = manifest.items[id];
    // Which languages does this entry speak for?
    let perLang;
    if (single) perLang = { [batch.langs[0]]: raw };
    else if (raw && typeof raw === 'object' && !Array.isArray(raw)) perLang = raw;
    else perLang = Object.fromEntries(batch.langs.map((c) => [c, raw]));
    for (const [code, value] of Object.entries(perLang)) {
      const st = states[code];
      if (!st) { console.error(`todo-${n}.out.json: "${id}" names unknown language "${code}"; ignored`); continue; }
      const reject = (error) => { st.rejected++; st.problems.push({ id, en: item ? item.en : '', value, error }); };
      if (!batch.langs.includes(code)) { reject(`language ${code} is not part of this batch`); continue; }
      if (!item || !mf) { reject('unknown id'); continue; }
      if (item.need && !item.need.includes(code)) { st.ignored++; continue; }
      const error = hardCheck(item, mf, value);
      if (error) { reject(error); continue; }
      st.accepted.push({ id, kind: item.kind, mf, value });
      for (const warning of softChecks(item, value, code, st.glossary)) st.review.push({ id, en: item.en, value, warning });
    }
  }
}
if (!outFiles) console.log('no todo-N.out.json files found');

const allProblems = {};
const allReview = {};
for (const st of Object.values(states)) {
  const patternsChanged = applyAll(st);
  const changed = st.accepted.filter((u) => u.changed).length;
  if (JSON.stringify(st.loc) !== st.original) {
    saveLocale(st.path, st.loc);
    if (patternsChanged && !opts['no-order']) {
      execFileSync(process.execPath, [path.join(__dirname, 'order-rules.js'), '--locale', st.path], { cwd: __dirname, stdio: 'pipe' });
    }
  }
  if (st.problems.length) allProblems[st.code] = st.problems;
  if (st.review.length) allReview[st.code] = st.review;
  const left = new Set(C.findMissing(st.loc, cat, C.ALL_KINDS).map((it) => it.id));
  const untranslated = Object.keys(manifest.items).filter((id) => left.has(id)).length;
  console.log(`${st.code.padEnd(8)}written ${st.accepted.length} (changed ${changed}), rejected ${st.rejected}, warnings ${st.review.length}` +
    `${st.ignored ? `, ignored ${st.ignored}` : ''}, still untranslated ${untranslated}/${Object.keys(manifest.items).length}`);
}
const report = (name, data) => {
  const file = path.join(outDir, name);
  if (Object.keys(data).length) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log(`wrote ${file}`);
  } else if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
};
report('problems.json', allProblems);
report('review.json', allReview);
