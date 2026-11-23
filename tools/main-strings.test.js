// Exercises main-strings.js against a small archive written on the fly.
//
// Usage:  node main-strings.test.js   (or: npm test)
// Input:  none
// Output: one line per test; exit code 1 if any test fails
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanSource, report } = require('./main-strings');

// An asar archive: a pickled JSON header, then the file bodies.
function writeAsar(file, entries) {
  const files = {};
  const bodies = [];
  let offset = 0;
  for (const [rel, text] of Object.entries(entries)) {
    const body = Buffer.from(text, 'utf8');
    let dir = files;
    const parts = rel.split('/');
    for (const p of parts.slice(0, -1)) dir = (dir[p] = dir[p] || { files: {} }).files;
    dir[parts[parts.length - 1]] = { size: body.length, offset: String(offset) };
    bodies.push(body);
    offset += body.length;
  }
  const json = Buffer.from(JSON.stringify({ files }), 'utf8');
  const padded = Math.ceil(json.length / 4) * 4;
  const head = Buffer.alloc(16 + padded);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(8 + padded, 4);
  head.writeUInt32LE(4 + padded, 8);
  head.writeUInt32LE(json.length, 12);
  json.copy(head, 16);
  fs.writeFileSync(file, Buffer.concat([head, ...bodies]));
}

const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const texts = (file, src) => scanSource(file, src).map((c) => c.en);

t('dialog fields, buttons, concatenation, ternaries and placeholders', () => {
  const src = `
    dialog.showMessageBox(win, {
      title: 'Stop SSH server',
      message: \`Stop the server on \${entry.label}?\`,
      detail: 'Agents stop. ' +
        'The server starts again.',
      buttons: ['Stop Server', 'Cancel', ...more],
    });
    dialog.showErrorBox('Startup failed', msg);
    const item = { label: busy ? 'Working…' : \`\${n} of \${total} in \${n}\` };
    throw new Error('Not interface text');`;
  assert.deepStrictEqual(texts('dist/a.js', src).sort(), [
    'Stop SSH server', 'Stop the server on {0}?', 'Agents stop. The server starts again.',
    'Stop Server', 'Cancel', 'Working…', '{0} of {1} in {0}', 'Startup failed',
  ].sort());
});

t('data:text/html pages: tag text and sentences, scripts and errors skipped', () => {
  const src = `
    const heading = down ? \`Disconnected from \${host}\` : 'Reconnecting…';
    log.info('Loading the page now');
    const fail = new TypeError('Bad page state');
    const html = \`<title>\${title}</title><style>p{}</style><h1>Welcome &amp; hello</h1>
      <script>const x = 'Not this';</script><p>Scan with \${device}</p>\`;
    win.loadURL(\`data:text/html;charset=utf-8,\${encodeURIComponent(html)}\`);`;
  const got = texts('dist/page.js', src);
  assert.deepStrictEqual(got.sort(), ['Disconnected from {0}', 'Reconnecting…', 'Scan with {0}', 'Welcome & hello'].sort());
});

t('report: new strings, stale keys, ignore and assembled lists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'main-strings-'));
  try {
    const asar = path.join(dir, 'app.asar');
    writeAsar(asar, {
      'package.json': '{}',
      'dist/main.js': "dialog.showMessageBox({ title: 'Known', message: 'Brand new', detail: 'Skip me', buttons: ['Open ' + name] });",
      'dist/preload.js': "x({ title: 'From a preload' });",
      'dist/__mocks__/electron.js': "x({ label: 'Mock label' });",
      'dist/other.js': "const s = 'Only ' +\n  'joined';",
    });
    const locale = { menu: { Gone: 'x', 'Only joined': 'y' }, dialogs: { Known: 'k', 'Built {0}': 'b', 'Open Thing': 'o' } };
    const lists = { ignore: ['Skip me', 'Open {0}'], assembled: { 'Open Thing': 'main.js' } };
    const r = report({ asarPath: asar, locale, lists });
    assert.strictEqual(r.files, 2, 'preloads and mocks are skipped');
    assert.deepStrictEqual(r.new.map((c) => [c.en, c.file, c.kind]), [['Brand new', 'dist/main.js', 'message']]);
    assert.deepStrictEqual(r.stale, [{ section: 'dialogs', key: 'Built {0}' }, { section: 'menu', key: 'Gone' }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message.split('\n').join('\n      ')); }
}
console.log(failed ? `${failed} failed` : `all ${tests.length} passed`);
process.exit(failed ? 1 : 0);
