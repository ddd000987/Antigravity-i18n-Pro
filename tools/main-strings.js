// Checks the main-process strings (native menus, dialogs, the small
// data:text/html pages) of an Antigravity release against a locale's menu and
// dialogs maps. The renderer tools (extract, sweep, sentences) never see these
// files, so this is the step that keeps the dialogs map current.
//
// Reports two lists:
//   new    strings the main process shows that neither map has
//   stale  map keys no longer found in the release (renamed or removed)
// Review the new ones: add real UI text to zh-TW "dialogs", and list text that
// is never shown (or is shown only untranslatable) under "ignore" in
// main-strings.json. Keys the app builds at run time, or Electron role labels,
// go under "assembled" there so they are not reported as stale.
//
// Usage:  node main-strings.js [app.asar] [--locale <code|path>] [--json]
// Input:  an unpatched archive (default: the installed app.asar.clean-backup);
//         the locale (default zh-TW); main-strings.json beside this script
// Output: a report on stdout (--json: { new: [{ en, file, line, kind }], stale: [{ section, key }] })
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');
const { parseArgs } = require('./lib/cli');
const { loadLocale, DEFAULT_LOCALE } = require('./lib/locale');

const DEFAULT_ASAR = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'antigravity', 'resources', 'app.asar.clean-backup');
const LISTS = path.join(__dirname, 'main-strings.json');

// Option fields the main-process fragment translates (dialog.jsfrag).
const FIELDS = new Set(['title', 'message', 'detail', 'label', 'sublabel', 'toolTip',
  'buttonLabel', 'checkboxLabel', 'nameFieldLabel']);
const CALLS = new Set(['showErrorBox']);
const MAX_VARIANTS = 16;

// Reads every packed dist/**/*.js except preloads, which run in the renderer.
function readArchiveScripts(asarPath) {
  const buf = fs.readFileSync(asarPath);
  const headerSize = buf.readUInt32LE(12);
  const header = JSON.parse(buf.subarray(16, 16 + headerSize).toString('utf8'));
  const base = 8 + buf.readUInt32LE(4);
  const files = [];
  (function visit(node, prefix) {
    for (const [name, entry] of Object.entries(node.files || {})) {
      const rel = prefix ? `${prefix}/${name}` : name;
      if (entry.files) { visit(entry, rel); continue; }
      if (entry.unpacked || !/^dist\/.*\.js$/.test(rel)) continue;
      if (/(^|\/)__mocks__\//.test(rel) || /[pP]reload\.js$/.test(rel)) continue;
      const start = base + Number(entry.offset);
      files.push({ file: rel, source: buf.subarray(start, start + entry.size).toString('utf8') });
    }
  })(header, '');
  return files;
}

// The English values an expression can produce, with {n} for the parts it
// takes from elsewhere. Conditional branches give several values; anything
// that is not text gives none.
function stringValues(node, slots, source = '') {
  // The same expression is the same placeholder wherever it appears.
  const slot = (expr) => {
    const key = source ? source.slice(expr.start, expr.end) : `${expr.start}:${expr.end}`;
    if (!slots.has(key)) slots.set(key, slots.size);
    return `{${slots.get(key)}}`;
  };
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string' ? [node.value] : [];
    case 'TemplateLiteral': {
      let out = [''];
      node.quasis.forEach((q, i) => {
        out = out.map((s) => s + q.value.cooked);
        if (i < node.expressions.length) out = out.map((s) => s + slot(node.expressions[i]));
      });
      return out;
    }
    case 'BinaryExpression': {
      if (node.operator !== '+') return [];
      const left = stringValues(node.left, slots, source);
      const right = stringValues(node.right, slots, source);
      if (!left.length && !right.length) return [];
      const l = left.length ? left : [slot(node.left)];
      const r = right.length ? right : [slot(node.right)];
      return l.flatMap((a) => r.map((b) => a + b)).slice(0, MAX_VARIANTS);
    }
    case 'ConditionalExpression':
      return [...stringValues(node.consequent, slots, source), ...stringValues(node.alternate, slots, source)];
    case 'LogicalExpression':
      return node.operator === '&&' ? stringValues(node.right, slots, source)
        : [...stringValues(node.left, slots, source), ...stringValues(node.right, slots, source)];
    default:
      return [];
  }
}

// Placeholders numbered by first appearance, as the map keys write them.
function renumber(s) {
  const order = new Map();
  return s.replace(/\{(\d+)\}/g, (m, n) => {
    if (!order.has(n)) order.set(n, order.size);
    return `{${order.get(n)}}`;
  });
}
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", nbsp: ' ' };
const decodeEntities = (s) => s.replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/g, (m, e) => ENTITIES[e]);

// Text a person can read: letters outside the placeholders.
const readable = (s) => /[A-Za-z]{2}/.test(s.replace(/\{\d+\}/g, ''));
// Looks like interface text rather than an identifier, path or code.
const looksLikeUi = (s) => /^[A-Z][a-z']*(?:[ …?.!,:]|$)/.test(s) && !/[_/\\=<>]|^\S+-\S+$/.test(s);

const HTML_TEXT = />([^<>]+)</g;
const SCRIPT_STYLE = /<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi;

// Every candidate string in one main-process file.
function scanSource(file, source) {
  const out = [];
  let ast;
  try {
    ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true });
  } catch (err) {
    throw new Error(`${file}: ${err.message}`);
  }
  const isPage = source.includes('data:text/html');
  const add = (en, node, kind) => {
    for (const line of decodeEntities(en).split('\n')) {
      const text = renumber(line.trim());
      if (text && readable(text)) out.push({ en: text, file, line: node.loc.start.line, kind });
    }
  };
  const values = (node) => stringValues(node, new Map(), source);
  // Errors and log lines are for developers, never shown as UI.
  const quiet = new WeakSet();
  walk.full(ast, (node) => {
    if (node.type === 'NewExpression' && node.callee.type === 'Identifier' && /Error$/.test(node.callee.name)) {
      node.arguments.forEach((a) => quiet.add(a));
    }
    if (node.type === 'CallExpression') {
      const c = node.callee;
      const name = c.type === 'MemberExpression' && !c.computed ? c.property.name : c.type === 'Identifier' ? c.name : '';
      const owner = c.type === 'MemberExpression' && c.object.type === 'Identifier' ? c.object.name : '';
      if (/^(console|log|logger)$/.test(owner) || /^(debug|info|warn|error|log|verbose|require)$/.test(name)
        || (c.type === 'MemberExpression' && c.object.type === 'MemberExpression' && /^(default|log)$/.test(c.object.property.name || ''))) {
        node.arguments.forEach((a) => quiet.add(a));
      }
    }
  });
  walk.ancestor(ast, {
    Property(node) {
      const key = node.key.type === 'Identifier' ? node.key.name : node.key.value;
      if (FIELDS.has(key)) values(node.value).forEach((en) => add(en, node, key));
      if (key === 'buttons' && node.value.type === 'ArrayExpression') {
        node.value.elements.forEach((el) => el && el.type !== 'SpreadElement' && values(el).forEach((en) => add(en, el, 'button')));
      }
    },
    CallExpression(node) {
      const c = node.callee;
      const name = c.type === 'MemberExpression' && !c.computed ? c.property.name : '';
      if (CALLS.has(name)) node.arguments.slice(0, 2).forEach((a) => values(a).forEach((en) => add(en, a, name)));
    },
  });
  if (!isPage) return out;
  // Pages: the text between tags of their HTML, and the sentences their
  // builders put into it.
  walk.ancestor(ast, {
    TemplateLiteral(node) {
      for (const html of values(node)) {
        if (!/<\/?[a-z][^>]*>/i.test(html)) continue;
        for (const m of html.replace(SCRIPT_STYLE, '').matchAll(HTML_TEXT)) add(m[1], node, 'page');
      }
    },
    Literal(node, _state, ancestors) {
      if (typeof node.value !== 'string' || ancestors.some((a) => quiet.has(a))) return;
      for (const m of node.value.replace(SCRIPT_STYLE, '').matchAll(HTML_TEXT)) add(m[1], node, 'page');
      if (!/[<>]/.test(node.value) && looksLikeUi(node.value)) add(node.value, node, 'page');
    },
  });
  // Sentences built from a template or concatenation inside a page builder.
  walk.ancestor(ast, {
    TemplateLiteral(node, _state, ancestors) {
      if (ancestors.some((a) => quiet.has(a))) return;
      values(node).filter((s) => !/[<>]/.test(s) && looksLikeUi(s)).forEach((en) => add(en, node, 'page'));
    },
  });
  return out;
}

// Whether a map key still occurs in the sources: as a candidate, or as
// literal text with its {n} parts matching anything short.
function keyPattern(key) {
  const parts = key.split(/\{\d+\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "(?:'|\\\\')"));
  return new RegExp(parts.join('[\\s\\S]{1,80}?'));
}
// Joins 'a' + 'b' so a sentence split across lines reads as one.
const joinLiterals = (src) => src.replace(/(['"`])\s*\+\s*\n?\s*(['"`])/g, '');

function report({ asarPath, locale, lists }) {
  const files = readArchiveScripts(asarPath);
  const known = new Map(Object.entries({ ...(locale.menu || {}), ...(locale.dialogs || {}) }));
  const ignore = new Set(lists.ignore || []);
  const assembled = new Set(Object.keys(lists.assembled || {}));
  const seen = new Set();
  const fresh = new Map();
  for (const { file, source } of files) {
    for (const c of scanSource(file, source)) {
      seen.add(c.en);
      if (!known.has(c.en) && !ignore.has(c.en) && !fresh.has(c.en)) fresh.set(c.en, c);
    }
  }
  const joined = files.map((f) => joinLiterals(f.source));
  const stale = [];
  for (const [section, map] of [['dialogs', locale.dialogs || {}], ['menu', locale.menu || {}]]) {
    for (const key of Object.keys(map)) {
      if (seen.has(key) || assembled.has(key)) continue;
      const re = keyPattern(key);
      if (!joined.some((src) => re.test(src))) stale.push({ section, key });
    }
  }
  return { files: files.length, new: [...fresh.values()], stale };
}

function main() {
  const { args: [asarArg], opts } = parseArgs(process.argv.slice(2), {
    usage: 'node main-strings.js [app.asar] [--locale <code|path>] [--json]',
    max: 1, options: { locale: DEFAULT_LOCALE }, flags: ['json'],
  });
  const asarPath = asarArg || DEFAULT_ASAR;
  const lists = JSON.parse(fs.readFileSync(LISTS, 'utf8'));
  const result = report({ asarPath, locale: loadLocale(opts.locale), lists });
  if (opts.json) {
    console.log(JSON.stringify({ new: result.new, stale: result.stale }, null, 2));
    return;
  }
  console.log(`${result.files} main-process files in ${asarPath}`);
  console.log(`\nnew: ${result.new.length} string(s) not in ${opts.locale} dialogs/menu or the ignore list`);
  for (const c of result.new) console.log(`  ${c.file}:${c.line}  ${c.kind}  ${JSON.stringify(c.en)}`);
  console.log(`\nstale: ${result.stale.length} key(s) not found in this release`);
  for (const s of result.stale) console.log(`  ${s.section}  ${JSON.stringify(s.key)}`);
}

if (require.main === module) main();
module.exports = { readArchiveScripts, scanSource, stringValues, report };
