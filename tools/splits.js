// Counts React elements whose visible sentence is split into several text
// nodes (string literals mixed with expressions), which a per-text-node
// dictionary cannot translate as one sentence.
//
// Usage:  node --stack-size=8000 splits.js <bundle.js> [--locale <code|path>]
// Input:  the UI bundle; the locale (default zh-TW)
// Output: two summary lines on stdout
const fs = require('fs');
const acorn = require('acorn');
const walk = require('acorn-walk');
const { parseArgs } = require('./lib/cli');
const { loadLocale, DEFAULT_LOCALE } = require('./lib/locale');
const { args: [bundlePath], opts } = parseArgs(process.argv.slice(2), {
  usage: 'node --stack-size=8000 splits.js <bundle.js> [--locale <code|path>]', min: 1, max: 1, options: { locale: DEFAULT_LOCALE },
});
const src = fs.readFileSync(bundlePath, 'utf8');
const loc = loadLocale(opts.locale);
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
const out = [];
walk.simple(ast, {
  CallExpression(node) {
    const c = node.callee;
    if (!(c.type === 'MemberExpression' && c.property && c.property.name === 'createElement')) return;
    const kids = node.arguments.slice(2);
    if (kids.length < 2) return;
    const lits = kids.filter((k) => k.type === 'Literal' && typeof k.value === 'string');
    const exprs = kids.filter((k) => !(k.type === 'Literal') && !(k.type === 'CallExpression' && k.callee.property && k.callee.property.name === 'createElement'));
    if (!lits.some((l) => /[A-Za-z]{2,}/.test(l.value)) || exprs.length === 0) return;
    const shape = kids.map((k) => (k.type === 'Literal' ? JSON.stringify(k.value) : k.type === 'CallExpression' && k.callee.property && k.callee.property.name === 'createElement' ? '<el>' : '{x}')).join(' + ');
    const done = lits.every((l) => !/[A-Za-z]{2,}/.test(l.value) || loc.text[l.value.trim()]);
    out.push({ shape, done });
  },
});
console.log('split sentences', out.length, '| all English pieces in dictionary', out.filter((o) => o.done).length);
console.log("with inline element", out.filter((o) => o.shape.includes("<el>")).length, "| text-only", out.filter((o) => !o.shape.includes("<el>")).length);
