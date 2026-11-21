// Splits the output of extract.js into translation batches for the translators.
//
// Usage:  node batches.js <missing.json> <outDir> [nBatches]
// Input:  <missing.json>  written by extract.js ({ strings, templates })
// Output: <outDir>/batch-1.json ... batch-N.json (default N = 4), each a list of
//         { en, type, certainty, usedAs, context } items to translate following
//         translation-prompts/INSTRUCTIONS.md.
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('./lib/cli');
const { args: [inPath, outDir, nArg] } = parseArgs(process.argv.slice(2), {
  usage: 'node batches.js <missing.json> <outDir> [nBatches]', min: 2, max: 3,
});
const { strings, templates } = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const n = Number(nArg) || 4;

const isWeak = (kinds) => Object.keys(kinds).every((k) => k.endsWith('?'));
const items = [];
for (const e of strings) {
  items.push({ en: e.text, type: 'string', certainty: isWeak(e.kinds) ? 'maybe-ui' : 'ui', usedAs: Object.keys(e.kinds).join(','), context: e.context.slice(0, 200) });
}
for (const t of templates) {
  let i = 0;
  const en = t.template.replace(/\{\}/g, () => `{${++i}}`);
  items.push({ en, type: 'template', certainty: t.kind.endsWith('?') ? 'maybe-ui' : 'ui', usedAs: t.kind, context: t.context.slice(0, 200) });
}
// Keep related strings together: sort by context position is lost, so group by
// alphabetical order of the English text instead for stable, balanced batches.
items.sort((a, b) => a.en.localeCompare(b.en));
fs.mkdirSync(outDir, { recursive: true });
const size = Math.ceil(items.length / n);
for (let b = 0; b < n; b++) {
  const chunk = items.slice(b * size, (b + 1) * size);
  fs.writeFileSync(path.join(outDir, `batch-${b + 1}.json`), JSON.stringify(chunk, null, 1));
  console.log(`batch-${b + 1}.json`, chunk.length, 'ui', chunk.filter((x) => x.certainty === 'ui').length, 'templates', chunk.filter((x) => x.type === 'template').length);
}
