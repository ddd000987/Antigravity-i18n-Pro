// Like server-copy.js, but lists the short (single-word) name/label/title
// values that server-copy.js filters out.
//
// Usage:  node server-names.js <language_server.exe> [--locale <code|path>]
// Input:  the language_server binary; the locale (default zh-TW)
// Output: one line per string on stdout: "OK " if the locale covers it, "-- " if not,
//         then [field] and the text
const fs = require('fs');
const { parseArgs } = require('./lib/cli');
const { loadLocale, DEFAULT_LOCALE } = require('./lib/locale');
const { args: [binPath], opts } = parseArgs(process.argv.slice(2), {
  usage: 'node server-names.js <language_server.exe> [--locale <code|path>]', min: 1, max: 1, options: { locale: DEFAULT_LOCALE },
});
const loc = loadLocale(opts.locale);
const text = fs.readFileSync(binPath).toString('latin1');
const start = text.indexOf('"project-4k-mode-copy"');
const region = text.slice(Math.max(0, start - 60000), start + 60000);
const re = /\\"([A-Za-z]+)\\": \\"((?:[^"\\]|\\\\.)*?)\\"/g;
const seen = new Set();
let m;
while ((m = re.exec(region))) {
  const v = m[2];
  if (/ /.test(v) || seen.has(v) || !/^[A-Z][a-z]/.test(v) || !/name|label|title/i.test(m[1])) continue;
  seen.add(v);
  console.log(`${loc.text[v] ? 'OK ' : '-- '}[${m[1]}] ${v}`);
}
