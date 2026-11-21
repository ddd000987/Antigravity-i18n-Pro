// Prints UI copy shipped inside the language server's feature-flag JSON
// (strings the React bundle receives at runtime and therefore cannot find by
// reading the bundle), with coverage status.
//
// Usage:  node server-copy.js <language_server.exe> [--locale <code|path>]
// Input:  the language_server binary; the locale (default zh-TW)
// Output: one line per string on stdout: "OK " if the locale covers it, "-- " if not,
//         then [field] and the text
const fs = require('fs');
const { parseArgs } = require('./lib/cli');
const { loadLocale, DEFAULT_LOCALE } = require('./lib/locale');
const { args: [binPath], opts } = parseArgs(process.argv.slice(2), {
  usage: 'node server-copy.js <language_server.exe> [--locale <code|path>]', min: 1, max: 1, options: { locale: DEFAULT_LOCALE },
});
const loc = loadLocale(opts.locale);
const text = fs.readFileSync(binPath).toString('latin1');
const start = text.indexOf('"project-4k-mode-copy"');
const region = text.slice(Math.max(0, start - 60000), start + 60000);
// Values inside the escaped JSON: \"key\": \"value\"
const re = /\\"([A-Za-z]+)\\": \\"((?:[^"\\]|\\\\.)*?)\\"/g;
const seen = new Set();
let m;
while ((m = re.exec(region))) {
  const v = m[2].replace(/\\\\n/g, ' ');
  if (!/^[A-Z][a-z]/.test(v) || !/ /.test(v) || seen.has(v)) continue;
  seen.add(v);
  console.log(`${loc.text[v] ? 'OK ' : '-- '}[${m[1]}] ${v}`);
}
