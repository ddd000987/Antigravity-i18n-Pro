// Extracts every distinct JavaScript file from Antigravity's Chromium cache: gzip
// members are decompressed, plain files kept, fonts and duplicates skipped. The largest
// output is the React UI bundle (main.js); pass all of them to ui-notes.js and the
// largest to extract.js, sweep.js and sentences.js.
//
// Usage:  node cache-js.js <outDir> [--cache <Cache_Data dir>] [--min 2000]
// Input:  the cache (default %APPDATA%\antigravity\Cache\Cache_Data)
// Output: <outDir>/<cache file>.js, largest first on stdout with size and modification date
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { parseArgs } = require('./lib/cli');

const defaultCache = path.join(process.env.APPDATA || '', 'antigravity', 'Cache', 'Cache_Data');
const { args, opts } = parseArgs(process.argv.slice(2), {
  usage: 'node cache-js.js <outDir> [--cache <Cache_Data dir>] [--min 2000]',
  min: 1, max: 1, options: { cache: defaultCache, min: '2000' },
});
const outDir = path.resolve(args[0]);
const minSize = Number(opts.min) || 0;
if (!fs.existsSync(opts.cache)) {
  console.error(`cache folder not found: ${opts.cache} (run Antigravity once, or pass --cache)`);
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const seen = new Set();
const kept = [];
for (const name of fs.readdirSync(opts.cache)) {
  if (!name.startsWith('f_')) continue;
  const file = path.join(opts.cache, name);
  const buf = fs.readFileSync(file);
  let text = null;
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    try { text = zlib.gunzipSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('utf8'); } catch (err) { continue; }
  } else if (buf.subarray(0, 4).toString('latin1') !== 'wOF2') {
    text = buf.toString('utf8');
  }
  if (!text || text.length < minSize) continue;
  if (!/function|=>|createElement|jsx/.test(text.slice(0, 50000))) continue; // not JavaScript
  const hash = crypto.createHash('sha1').update(text).digest('hex');
  if (seen.has(hash)) continue;
  seen.add(hash);
  fs.writeFileSync(path.join(outDir, `${name}.js`), text);
  kept.push({ name, size: text.length, date: fs.statSync(file).mtime.toISOString().slice(0, 10) });
}
kept.sort((a, b) => b.size - a.size);
for (const k of kept) console.log(`${String(k.size).padStart(10)}  ${k.date}  ${k.name}.js`);
console.log(`${kept.length} distinct JavaScript file(s) in ${outDir}`);
