// Builds screen-location hints for the translation template export: for every
// English key of the locale that occurs as a string literal in the UI bundle(s),
// a short note saying HOW the string is used (button label, tooltip, heading,
// ...) and which other known strings sit next to it in the same React
// component, so a translator can tell where it appears on screen.
//
// Usage:  node --stack-size=8000 ui-notes.js <bundle.js>... [--locale <code|path>]
//             [--out <notes.json>] [--app-version <version>]
// Input:  one or more minified UI bundles (see README.md for where to get them)
//         and the locale (default zh-TW) whose `text` keys are looked up.
// Output: <notes.json> (default assets/catalog/notes.json):
//           { "generatedFrom": "Antigravity <version>",
//             "text": { "<English key>": "Button; near: \"Cancel\", \"Save changes\"" } }
//         Keys follow the locale's text order; keys not found in the bundle are omitted.
//
// How a string is classified ("kind"): the property or JSX prop it is the value
// of (title, placeholder, aria-label, tooltip*, label, button*, description, ...)
// or, as a createElement/jsx child, plain "Text" (a child of a native button,
// h1-h6 or label element is a "Button", "Heading" or "Label"). A string seen in several kinds
// lists the two most frequent. Comparisons (x === "Idle") and switch cases are
// ignored: they are not displayed text.
//
// "near" lists up to three OTHER locale keys found as literals in the same
// enclosing function (the React component), closest by source position first.
// Minified code often wraps the markup in small callbacks, so when the innermost
// function holds fewer than three other known strings the search widens to the
// next enclosing function, as long as that function is not larger than
// MAX_SCOPE characters. A string used in more than MAX_SPREAD different
// components is too generic to locate and gets no "near" list.
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');
const { parseArgs } = require('./lib/cli');
const { repoRoot, loadLocale, DEFAULT_LOCALE } = require('./lib/locale');

const USAGE = 'node --stack-size=8000 ui-notes.js <bundle.js>... [--locale <code|path>] [--out <notes.json>] [--app-version <version>]';
const { args: bundles, opts } = parseArgs(process.argv.slice(2), {
  usage: USAGE,
  min: 1,
  options: {
    locale: DEFAULT_LOCALE,
    out: path.join(repoRoot, 'assets', 'catalog', 'notes.json'),
    'app-version': null,
  },
});

const MAX_NEAR = 3;
const NEAR_LEN = 40;
const MAX_SCOPE = 20000; // characters of a function considered "one component"
const MAX_SPREAD = 8; // distinct components above which "near" is omitted

const norm = (s) => s.trim().replace(/\s+/g, ' ');

const locale = loadLocale(opts.locale);
const localeKeys = Object.keys(locale.text || {});
const keyByNorm = new Map(); // normalised English text -> locale key (first wins)
for (const k of localeKeys) {
  const n = norm(k);
  if (n && !keyByNorm.has(n)) keyByNorm.set(n, k);
}

// Maps the property / prop name a string is the value of to a short phrase.
function kindOfProp(name) {
  if (name === 'children') return 'Text';
  if (/^(aria-label|ariaLabel|alt)$/i.test(name) || /^aria-?label/i.test(name)) return 'Accessibility label (read by screen readers, may show as tooltip)';
  if (/tooltip/i.test(name)) return 'Tooltip';
  if (/^placeholder/i.test(name)) return 'Input placeholder';
  if (/^title$/i.test(name)) return 'Title or tooltip';
  if (/^(button|cta|confirm|cancel)/i.test(name)) return 'Button';
  if (/^empty(text|message|state)$/i.test(name)) return 'Empty-state message';
  if (/^(errorMessage|warning)$/i.test(name)) return 'Error or warning message';
  if (/^(description|subtitle|helperText|hint|caption)$/i.test(name)) return 'Description';
  if (/^(header|heading)$/i.test(name)) return 'Heading';
  if (/^label$/i.test(name) || /Label$/.test(name)) return 'Label';
  return 'Text';
}

const isFunction = (n) => n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression';
const isCreateElement = (callee) => callee && ((callee.type === 'MemberExpression' && callee.property && callee.property.name === 'createElement')
  || (callee.type === 'Identifier' && /^(jsxs?|_jsxs?|h)$/.test(callee.name)));
const COMPARE = new Set(['==', '===', '!=', '!==']);

// ancestors: root ... node. Returns { kind } or null when the literal is not displayed text.
function classify(ancestors) {
  let i = ancestors.length - 1;
  let node = ancestors[i];
  // Look through ternaries and logical fallbacks: cond ? "A" : "B", x || "A".
  while (i > 0) {
    const parent = ancestors[i - 1];
    if ((parent.type === 'ConditionalExpression' && parent.test !== node) || parent.type === 'LogicalExpression') {
      node = parent;
      i--;
    } else break;
  }
  const parent = ancestors[i - 1];
  if (!parent) return { kind: 'Text' };
  if (parent.type === 'BinaryExpression' && COMPARE.has(parent.operator)) return null;
  if (parent.type === 'SwitchCase' && parent.test === node) return null;
  if (parent.type === 'Property' && parent.value === node) {
    const k = parent.key && (parent.key.name || parent.key.value);
    return { kind: typeof k === 'string' ? kindOfProp(k) : 'Text' };
  }
  if (parent.type === 'CallExpression' && isCreateElement(parent.callee)) {
    // A child of a native <button>, heading or <label> element says more than plain "Text".
    const tag = parent.arguments[0];
    const name = tag && tag.type === 'Literal' && typeof tag.value === 'string' ? tag.value : '';
    if (parent.arguments.indexOf(node) >= 2) {
      if (name === 'button') return { kind: 'Button' };
      if (/^h[1-6]$/.test(name)) return { kind: 'Heading' };
      if (name === 'label') return { kind: 'Label' };
    }
  }
  return { kind: 'Text' };
}

// key -> { kinds: Map(kind -> count), occ: [{ pos, fns: [function nodes, innermost first] }] }
const found = new Map();
// function node -> [{ key, pos }] for every matched literal inside it (innermost 6 levels)
const inFunction = new Map();
let literals = 0;

for (const file of bundles) {
  const src = fs.readFileSync(file, 'utf8');
  let ast;
  try {
    ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true });
  } catch {
    try {
      ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
    } catch (err) {
      console.error(`skip ${file}: ${err.message}`);
      continue;
    }
  }
  walk.fullAncestor(ast, (node, _state, ancestors) => {
    let value;
    if (node.type === 'Literal' && typeof node.value === 'string') value = node.value;
    else if (node.type === 'TemplateLiteral' && node.expressions.length === 0) value = node.quasis[0].value.cooked;
    else return;
    const key = keyByNorm.get(norm(value));
    if (!key) return;
    const c = classify(ancestors);
    if (!c) return;
    literals++;
    // `ancestors` includes the node itself; collect the functions around it.
    const fns = [];
    for (let i = ancestors.length - 2; i >= 0 && fns.length < 6; i--) if (isFunction(ancestors[i])) fns.push(ancestors[i]);
    // Positions are only comparable inside one bundle, and a function lives in one bundle.
    const entry = { key, pos: node.start };
    for (const fn of fns) {
      let list = inFunction.get(fn);
      if (!list) inFunction.set(fn, (list = []));
      list.push(entry);
    }
    let f = found.get(key);
    if (!f) found.set(key, (f = { kinds: new Map(), occ: [] }));
    f.kinds.set(c.kind, (f.kinds.get(c.kind) || 0) + 1);
    f.occ.push({ pos: node.start, fns });
  });
}

const truncate = (s) => (s.length > NEAR_LEN ? s.slice(0, NEAR_LEN - 1) + '…' : s);

function nearFor(key, f) {
  const components = new Set();
  const best = new Map(); // other key -> smallest distance
  for (const o of f.occ) {
    // Pick the scope: innermost function with enough neighbours, widening while it stays component-sized.
    let scope = null;
    let scopeOthers = null;
    for (const fn of o.fns) {
      const size = fn.end - fn.start;
      const others = new Set(inFunction.get(fn).filter((e) => e.key !== key).map((e) => e.key));
      if (scope && size > MAX_SCOPE) break;
      scope = fn;
      scopeOthers = others;
      if (others.size >= MAX_NEAR) break;
    }
    if (!scope) continue;
    components.add(scope);
    if (!scopeOthers.size) continue;
    for (const e of inFunction.get(scope)) {
      if (e.key === key) continue;
      const d = Math.abs(e.pos - o.pos);
      if (!best.has(e.key) || d < best.get(e.key)) best.set(e.key, d);
    }
  }
  if (components.size > MAX_SPREAD) return [];
  return [...best.entries()].sort((a, b) => a[1] - b[1]).slice(0, MAX_NEAR).map(([k]) => truncate(norm(k)));
}

const notes = {};
let withNear = 0;
for (const key of localeKeys) {
  const f = found.get(key);
  if (!f) continue;
  const kinds = [...f.kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
  let note = kinds.join(' / ');
  const near = nearFor(key, f);
  if (near.length) {
    note += `; near: ${near.map((s) => `"${s}"`).join(', ')}`;
    withNear++;
  }
  notes[key] = note;
}

const out = {
  generatedFrom: opts['app-version'] ? `Antigravity ${opts['app-version']}` : 'Antigravity',
  text: notes,
};
fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
fs.writeFileSync(opts.out, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`found ${Object.keys(notes).length} of ${localeKeys.length} keys (${withNear} with neighbours; ${literals} literal occurrences) -> ${opts.out}`);
