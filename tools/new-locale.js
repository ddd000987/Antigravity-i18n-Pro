// Creates an empty language pack skeleton, ready for todo.js: assets/locales/<code>.json
// with the metadata filled in and empty sections, and a glossary stub
// tools/glossary/<code>.json (the style notes and term renderings of the language).
// Refuses to overwrite an existing pack. The skeleton is only valid for the Go side once
// the first batch is merged (a pack needs at least one text entry).
//
// Usage:  node new-locale.js <code> --name <native name> --english-name <English name> [--dir ltr|rtl] [--html-lang <tag>]
// Input:  none
// Output: assets/locales/<code>.json and, when missing, tools/glossary/<code>.json
const fs = require('fs');
const { parseArgs } = require('./lib/cli');
const { localePath } = require('./lib/locale');
const { glossaryPath, saveGlossary } = require('./lib/catalog');

const usage = 'node new-locale.js <code> --name <native name> --english-name <English name> [--dir ltr|rtl] [--html-lang <tag>]';
const { args, opts } = parseArgs(process.argv.slice(2), {
  usage, min: 1, max: 1,
  options: { name: null, 'english-name': null, dir: null, 'html-lang': null },
});
const code = args[0];
const fail = (msg) => { console.error(msg); console.error(`Usage: ${usage}`); process.exit(1); };

// Same shape the Go side accepts (LocaleCodeRe in internal/core/locale.go).
if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(code)) fail(`"${code}" is not a language code such as fr, de or pt-BR`);
if (!opts.name) fail('--name (the language\'s own name, for example Français) is required');
if (!opts['english-name']) fail('--english-name (for example French) is required');

// Languages written right to left must say so (validateLocale in the Go side rejects them otherwise).
const RTL = new Set(['ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'ku', 'nqo', 'ps', 'sd', 'ug', 'ur', 'yi']);
const dir = opts.dir || (RTL.has(code.split('-')[0].toLowerCase()) ? 'rtl' : 'ltr');
if (dir !== 'ltr' && dir !== 'rtl') fail('--dir must be ltr or rtl');

const file = localePath(code);
if (fs.existsSync(file)) fail(`${file} already exists; refusing to overwrite it`);

const locale = {
  $schema: './locale.schema.json',
  language: code,
  name: opts.name,
  englishName: opts['english-name'],
  htmlLang: opts['html-lang'] || code,
  dir,
  patterns: [],
  valueMaps: {},
  valueRules: {},
  menu: {},
  dialogs: {},
  text: {},
};
fs.writeFileSync(file, JSON.stringify(locale, null, 2) + '\n', 'utf8');
console.log(`created ${file}`);

if (fs.existsSync(glossaryPath(code))) {
  console.log(`kept ${glossaryPath(code)}`);
} else {
  saveGlossary(code, { language: code, notes: [], terms: {} });
  console.log(`created ${glossaryPath(code)}`);
}
console.log('note: the Go side rejects a pack whose text section is empty, so run `go test` only after the first merge-todo.js');
console.log(`next: node todo.js <outDir> --locale ${code}`);
