// Finds React elements whose sentence is split across several children and
// writes the joined source the engine's sentence layer will see:
//   string literal          -> literal text
//   createElement(...)      -> "<>" (inline element marker)
//   a ? "x" : "y" / a && "s" -> (?:x|y) / (?:s)?  (no capture)
//   template literal         -> its text with (.+?) for each expression
//   any other expression     -> (.+?)  (dynamic value, text or element)
// Items already translated by the locale are left out.
//
// Usage:  node --stack-size=8000 sentences.js <bundle.js> <out.json> [--locale <code|path>]
// Input:  the UI bundle; the locale (default zh-TW)
// Output: <out.json> = [{ kind: "text" | "pattern", key, sample, captures, context }];
//         translate it with translation-prompts/SENTENCE-INSTRUCTIONS.md, then merge-sent.js
const fs = require('fs');
const acorn = require('acorn');
const walk = require('acorn-walk');
const { parseArgs } = require('./lib/cli');
const { loadLocale, DEFAULT_LOCALE } = require('./lib/locale');
const { args: [jsPath, outPath], opts } = parseArgs(process.argv.slice(2), {
  usage: 'node --stack-size=8000 sentences.js <bundle.js> <out.json> [--locale <code|path>]',
  min: 2, max: 2, options: { locale: DEFAULT_LOCALE },
});
const loc = loadLocale(opts.locale);
const src = fs.readFileSync(jsPath, 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isCE = (n) => n && n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.property.name === 'createElement';
const strLit = (n) => n && n.type === 'Literal' && typeof n.value === 'string';
const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'dfn', 'em', 'i', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var']);

// Pass 1: string values each property name is given anywhere, so a capture
// like `t.emptyMessagePlural` can be offered with its possible values.
const propValues = new Map();
walk.simple(ast, {
  Property(node) {
    const k = node.key && (node.key.name || node.key.value);
    if (typeof k !== 'string' || !strLit(node.value)) return;
    const v = node.value.value;
    if (!/^[A-Za-z][A-Za-z ,'-]{1,60}$/.test(v)) return;
    if (!propValues.has(k)) propValues.set(k, new Set());
    propValues.get(k).add(v);
  },
});

// Plain-JS mirror of the engine's lookup, enough to tell whether a sample is
// already covered.
const pats = loc.patterns.map((p) => new RegExp(p.pattern, p.flags || ''));
const covered = (s) => {
  const t = s.trim();
  if (loc.text[t]) return true;
  const core = t.replace(/[.:：?？!…\s]+$/, '');
  if (core !== t && loc.text[core]) return true;
  return pats.some((re) => re.test(t));
};

// Render one child as { re, sample, kind } pieces.
function piece(node, caps) {
  if (strLit(node)) return { re: esc(node.value), sample: node.value };
  if (node.type === 'Literal' && typeof node.value === 'number') return { re: esc(String(node.value)), sample: String(node.value) };
  if (isCE(node)) {
    const tag = node.arguments[0];
    const inline = !strLit(tag) || INLINE.has(tag.value);
    return inline ? { re: '<>', sample: '<>', element: true, component: !strLit(tag) } : null;
  }
  if (node.type === 'ConditionalExpression' && strLit(node.consequent) && strLit(node.alternate)) {
    return { re: `(?:${esc(node.consequent.value)}|${esc(node.alternate.value)})`, sample: node.consequent.value, alt: [node.consequent.value, node.alternate.value] };
  }
  if (node.type === 'LogicalExpression' && node.operator === '&&' && strLit(node.right)) {
    return { re: `(?:${esc(node.right.value)})?`, sample: node.right.value, alt: [node.right.value, ''] };
  }
  if (node.type === 'TemplateLiteral') {
    const q = node.quasis.map((x) => x.value.cooked);
    let re = esc(q[0]); let sample = q[0];
    for (let i = 1; i < q.length; i++) { caps.push({ code: src.slice(node.expressions[i - 1].start, node.expressions[i - 1].end) }); re += '(.+?)' + esc(q[i]); sample += 'X' + q[i]; }
    return { re, sample };
  }
  const code = src.slice(node.start, node.end);
  const prop = node.type === 'MemberExpression' && !node.computed ? node.property.name : null;
  const values = prop && propValues.has(prop) ? [...propValues.get(prop)].slice(0, 40) : undefined;
  caps.push({ code: code.length > 80 ? code.slice(0, 80) + '…' : code, prop, values });
  return { re: '(.+?)', sample: 'X' };
}

const out = new Map();
let total = 0;
walk.simple(ast, {
  CallExpression(node) {
    if (!isCE(node)) return;
    const kids = node.arguments.slice(2);
    if (kids.length < 2) return;
    if (!kids.some((k) => strLit(k) && /[A-Za-z]{2}/.test(k.value))) return;
    const caps = [];
    const parts = [];
    for (const k of kids) {
      const p = piece(k, caps);
      if (!p) return; // block element child: the engine will not join this
      parts.push(p);
    }
    // Only element children and literals, with one literal: not split text.
    const textLike = parts.filter((p) => !p.element).length;
    if (textLike < 2 && !parts.some((p) => p.element)) return;
    let re = parts.map((p) => p.re).join('');
    let sample = parts.map((p) => p.sample).join('');
    re = re.replace(/(\\s|\s)+/g, ' ').trim();
    sample = sample.replace(/\s+/g, ' ').trim();
    if (!/[A-Za-z]{2}/.test(sample.replace(/<>/g, ''))) return;
    total++;
    if (covered(sample)) return;
    const plain = caps.length === 0 && !parts.some((p) => p.alt);
    const key = plain ? sample : '^' + re + '$';
    if (out.has(key)) return;
    out.set(key, {
      kind: plain ? 'text' : 'pattern',
      key,
      sample,
      captures: caps,
      hasComponentMarker: parts.some((p) => p.component) || undefined,
      context: src.slice(Math.max(0, node.start - 120), Math.min(src.length, node.end + 40)).replace(/\s+/g, ' ').slice(0, 520),
    });
  },
});
const items = [...out.values()];
fs.writeFileSync(outPath, JSON.stringify(items, null, 1));
console.log('split sentences', total, '| not yet covered (unique)', items.length, '| text', items.filter((i) => i.kind === 'text').length, '| pattern', items.filter((i) => i.kind === 'pattern').length, '| captures with known values', items.filter((i) => i.captures.some((c) => c.values)).length);
for (const i of items.slice(0, 12)) console.log(i.kind.padEnd(8), i.key);
