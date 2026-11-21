// Broad sweep: every string / template literal that reads like an English
// sentence or label, wherever it sits (object values, arrow returns...), and
// is not yet covered by the locale. Catches what extract.js missed.
// Developer-only text (thrown errors, console/logger calls) is left out.
//
// Usage:  node --stack-size=8000 sweep.js <bundle.js> <out.json> [--locale <code|path>]
// Input:  the UI bundle; the locale (default zh-TW)
// Output: <out.json> = [{ en, type: "string" | "template", pos, context }];
//         translate it with translation-prompts/SWEEP-INSTRUCTIONS.md, then merge-sweep.js
const fs = require('fs');
const acorn = require('acorn');
const walk = require('acorn-walk');
const { parseArgs } = require('./lib/cli');
const { loadLocale, DEFAULT_LOCALE } = require('./lib/locale');
const { args: [jsPath, outPath], opts } = parseArgs(process.argv.slice(2), {
  usage: 'node --stack-size=8000 sweep.js <bundle.js> <out.json> [--locale <code|path>]',
  min: 2, max: 2, options: { locale: DEFAULT_LOCALE },
});
const loc = loadLocale(opts.locale);
const src = fs.readFileSync(jsPath, 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
const pats = loc.patterns.filter((p) => p.scope !== 'sentence').map((p) => new RegExp(p.pattern, p.flags || ''));
const covered = (t) => loc.text[t] || loc.text[t.replace(/[.:?!…]+$/, '')] || pats.some((re) => re.test(t));

// Sentence-like: capitalised, at least 3 words and 2 spaces, no code syntax.
function looksUi(t) {
  if (t.length < 12 || t.length > 300) return false;
  if ((t.match(/ /g) || []).length < 2) return false;
  if (!/^[A-Z][a-z']/.test(t)) return false;
  if ((t.match(/[A-Za-z']+/g) || []).length < 3) return false;
  if (/[{}<>=;\\`|_#$]|=>|https?:|\.\w{2,4}\b(?!\s)|\b[a-z]+[A-Z]\w*\b/.test(t)) return false;
  if (/\n/.test(t)) return false;
  return true;
}
const calleeName = (c) => (c && (c.name || (c.property && c.property.name))) || '';
const COLOR_DOC = /(background|foreground|border|highlight|shadow|outline) colou?r|colou?r (of|for|used)|colou?r.$|must not be opaque/i;
function libraryData(node, ancestors) {
  return ancestors.some((a) => (a.type === 'CallExpression' && /^(describe)$/.test(calleeName(a.callee)))
    || (a.type === 'ArrayExpression' && a.elements.length >= 25));
}
function devOnly(ancestors) {
  return ancestors.some((a) => a.type === 'ThrowStatement'
    || (a.type === 'NewExpression' && /Error$/.test(calleeName(a.callee)))
    || (a.type === 'CallExpression' && /^(log|warn|error|debug|info|trace|assert|fatal|Error|TypeError|RangeError)$/.test(calleeName(a.callee))));
}
const found = new Map();
const ctx = (node) => src.slice(Math.max(0, node.start - 160), node.end + 60).replace(/\s+/g, ' ');
walk.fullAncestor(ast, (node, _state, ancestors) => {
  if (node.type === 'Literal' && typeof node.value === 'string') {
    const t = node.value.trim().replace(/\s+/g, ' ');
    if (!looksUi(t) || covered(t) || found.has(t) || devOnly(ancestors) || libraryData(node, ancestors) || COLOR_DOC.test(t)) return;
    found.set(t, { en: t, type: 'string', pos: node.start, context: ctx(node) });
  }
  else if (node.type === 'TemplateLiteral' && node.expressions.length) {
    let i = 0;
    const tpl = node.quasis.map((q) => q.value.cooked).join('\u0000').replace(/\u0000/g, () => `{${++i}}`).trim();
    const probe = tpl.replace(/\{\d+\}/g, 'X');
    if (!looksUi(probe) || covered(probe) || found.has(tpl) || devOnly(ancestors)) return;
    if (libraryData(node, ancestors)) return;
    found.set(tpl, { en: tpl, type: 'template', pos: node.start, context: ctx(node) });
  }
});
const items = [...found.values()];
fs.writeFileSync(outPath, JSON.stringify(items, null, 1));
console.log('uncovered sentence-like literals', items.length, '| templates', items.filter((i) => i.type === 'template').length);
