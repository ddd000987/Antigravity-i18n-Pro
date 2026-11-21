// Finds gzip members embedded in a binary (for example the Chromium cache
// files f_*, or language_server.exe) and writes each decompressed blob. The
// largest blob of the UI cache is the React bundle (main.js).
//
// Usage:  node ungz.js <binary> <outDir>
// Input:  any file containing gzip data
// Output: <outDir>/blob-NNN.bin per member (> 1000 bytes); offset, size and a
//         preview of each is printed
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parseArgs } = require('./lib/cli');
const { args: [bin, outDir] } = parseArgs(process.argv.slice(2), { usage: 'node ungz.js <binary> <outDir>', min: 2, max: 2 });
const buf = fs.readFileSync(bin);
fs.mkdirSync(outDir, { recursive: true });
let off = buf.indexOf(Buffer.from([0x1f, 0x8b, 0x08]));
let n = 0;
while (off >= 0) {
  try {
    const flg = buf[off + 3];
    let p = off + 10;
    if (flg & 4) p += 2 + buf.readUInt16LE(p);
    if (flg & 8) { while (buf[p]) p++; p++; }
    if (flg & 16) { while (buf[p]) p++; p++; }
    if (flg & 2) p += 2;
    const out = zlib.inflateRawSync(buf.subarray(p, p + 64 * 1024 * 1024), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    if (out.length > 1000) {
      const head = out.subarray(0, 60).toString('latin1').replace(/[^\x20-\x7e]/g, '.');
      const file = path.join(outDir, `blob-${String(n).padStart(3, '0')}.bin`);
      fs.writeFileSync(file, out);
      console.log(n, off, out.length, head);
      n++;
    }
  } catch { /* not a valid member */ }
  off = buf.indexOf(Buffer.from([0x1f, 0x8b, 0x08]), off + 1);
}
