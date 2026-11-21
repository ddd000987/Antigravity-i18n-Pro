// Collects user-visible English strings from React bundles that the locale
// dictionary does not cover yet (React createElement/jsx children, UI-ish
// props such as title/placeholder/aria-label, and return statements).
//
// Usage:  node --stack-size=8000 extract.js <out.json> <bundle.js>... [--locale <code|path>]
// Input:  one or more minified UI bundles (see README.md for where to get them)
// Output: <out.json> = { strings: [{ text, kinds, count, context }], templates: [...] };
//         feed it to batches.js. A summary is printed.
const fs = require('fs');
const acorn = require('acorn');
const walk = require('acorn-walk');
const { parseArgs } = require('./lib/cli');
const { loadLocale, DEFAULT_LOCALE } = require('./lib/locale');

const { args: [outPath, ...bundles], opts } = parseArgs(process.argv.slice(2), {
  usage: 'node --stack-size=8000 extract.js <out.json> <bundle.js>... [--locale <code|path>]',
  min: 2, options: { locale: DEFAULT_LOCALE },
});
const locale = loadLocale(opts.locale);
const known = new Set(Object.keys(locale.text).map((k) => k.trim().replace(/\s+/g, ' ')));
const patterns = (locale.patterns || []).map((p) => new RegExp(p.pattern, p.flags || ''));

// Props / object keys whose string value is shown to the user.
const UI_KEYS = new Set([
  'title', 'subtitle', 'label', 'description', 'placeholder', 'aria-label', 'ariaLabel', 'alt',
  'tooltip', 'tooltipText', 'tooltipContent', 'data-tooltip', 'text', 'message', 'header', 'heading', 'emptyText',
  'emptyMessage', 'emptyState', 'buttonText', 'buttonLabel', 'confirmText', 'cancelText', 'confirmLabel',
  'cancelLabel', 'actionLabel', 'helperText', 'hint', 'caption', 'content', 'body', 'details', 'detail',
  'name', 'displayName', 'shortLabel', 'longLabel', 'summary', 'errorMessage', 'successMessage', 'info',
  'warning', 'note', 'prompt', 'question', 'cta', 'ctaText', 'linkText', 'menuLabel', 'groupLabel',
]);
const NOISY_KEYS = new Set(['name', 'content', 'body', 'text', 'prompt', 'detail', 'details', 'info', 'message']);

function englishLike(s) {
  const t = s.trim();
  if (t.length < 2 || t.length > 400) return false;
  if (!/[A-Za-z]{2,}/.test(t)) return false;
  if (/[{}<>=;\\`|]|=>|\$\(|https?:|www\.|\.(js|ts|css|json|md|py|go|png|svg)\b/.test(t)) return false;
  if (/^[a-z0-9]+([A-Z][a-z0-9]*)+$/.test(t)) return false; // camelCase
  if (/^[A-Z0-9_]+$/.test(t) && t.includes('_')) return false; // CONSTANT_CASE
  if (/^[\w.\-\/:#@]+$/.test(t) && !/^[A-Z][a-z]+$/.test(t) && !/^[A-Z][a-z]+[A-Z]?[a-z]*$/.test(t)) {
    // single token: keep only Capitalized words like "Settings"
    return false;
  }
  // CSS class lists such as "flex items-center gap-2".
  const tokens = t.split(/\s+/);
  if (tokens.length > 1 && tokens.every((w) => /^[a-z0-9\-:\[\]\/.%!]+$/.test(w)) && tokens.some((w) => w.includes('-'))) return false;
  if (!/[A-Z]/.test(t[0]) && !/\s/.test(t)) return false;
  return true;
}

function covered(t) {
  const n = t.trim().replace(/\s+/g, ' ');
  if (known.has(n)) return true;
  const core = n.replace(/[.:?!…\s]+$/, '');
  if (known.has(core)) return true;
  return patterns.some((re) => re.test(n));
}

const found = new Map();
function add(str, kind, src, node) {
  if (typeof str !== 'string' || !englishLike(str) || covered(str)) return;
  const key = str.trim().replace(/\s+/g, ' ');
  let e = found.get(key);
  if (!e) {
    e = { text: key, kinds: {}, count: 0, context: src.slice(Math.max(0, node.start - 90), Math.min(src.length, node.end + 40)).replace(/\s+/g, ' ') };
    found.set(key, e);
  }
  e.kinds[kind] = (e.kinds[kind] || 0) + 1;
  e.count++;
}

function isCreateElement(callee) {
  return callee && ((callee.type === 'MemberExpression' && callee.property && callee.property.name === 'createElement')
    || (callee.type === 'Identifier' && /^(jsxs?|_jsxs?|h)$/.test(callee.name)));
}

function strValues(node, cb) {
  // Strings reachable as display values: literal, ternary branches, logical fallbacks.
  if (!node) return;
  if (node.type === 'Literal' && typeof node.value === 'string') cb(node.value, node);
  else if (node.type === 'TemplateLiteral') cb(null, node);
  else if (node.type === 'ConditionalExpression') { strValues(node.consequent, cb); strValues(node.alternate, cb); }
  else if (node.type === 'LogicalExpression') { strValues(node.left, cb); strValues(node.right, cb); }
}

const templates = new Map();
function addTemplate(node, src, kind) {
  const quasis = node.quasis.map((q) => q.value.cooked);
  if (node.expressions.length === 0) return add(quasis[0], kind, src, node);
  const joined = quasis.join('{}');
  if (!englishLike(quasis.join(' x ')) || !/[A-Za-z]{3,}/.test(quasis.join(''))) return;
  const k = joined.trim();
  if (!templates.has(k)) templates.set(k, { template: k, kind, context: src.slice(Math.max(0, node.start - 90), node.end + 30).replace(/\s+/g, ' ') });
}

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
  walk.simple(ast, {
    CallExpression(node) {
      if (!isCreateElement(node.callee)) return;
      node.arguments.slice(2).forEach((arg) => strValues(arg, (v, n) => (v === null ? addTemplate(n, src, 'child') : add(v, 'child', src, n))));
      const props = node.arguments[1];
      if (props && props.type === 'ObjectExpression') {
        for (const p of props.properties) {
          const k = p.key && (p.key.name || p.key.value);
          if (k === 'children') strValues(p.value, (v, n) => (v === null ? addTemplate(n, src, 'child') : add(v, 'child', src, n)));
        }
      }
    },
    Property(node) {
      const k = node.key && (node.key.name || node.key.value);
      if (!UI_KEYS.has(k)) return;
      const kind = NOISY_KEYS.has(k) ? `prop:${k}?` : `prop:${k}`;
      strValues(node.value, (v, n) => (v === null ? addTemplate(n, src, kind) : add(v, kind, src, n)));
    },
    ReturnStatement(node) {
      strValues(node.argument, (v, n) => (v === null ? addTemplate(n, src, 'return?') : add(v, 'return?', src, n)));
    },
    SwitchCase() {},
  });
}

const strings = [...found.values()].sort((a, b) => b.count - a.count);
const strong = strings.filter((e) => Object.keys(e.kinds).some((k) => !k.endsWith('?')));
fs.writeFileSync(outPath, JSON.stringify({ strings, templates: [...templates.values()] }, null, 1));
console.log('missing strings', strings.length, '(strong', strong.length + ')', 'templates', templates.size);
console.log(strong.slice(0, 40).map((e) => e.text).join(' | '));
