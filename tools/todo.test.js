// Round-trip test of the batch workflow (todo.js -> translate -> merge-todo.js).
// Copies the ja pack to a temp folder, removes a few entries of every kind, checks that
// todo.js lists exactly those, merges the original values back and expects the file to be
// identical to the original. A first pass with two broken values checks that they end up
// in problems.json instead of the pack.
//
// Usage:  node todo.test.js   (or: npm test)
// Input:  assets/locales/ja.json (read only), the zh-TW catalog
// Output: one line per check; exit code 1 on the first failure
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { repoRoot } = require('./lib/locale');
const C = require('./lib/catalog');

const run = (script, ...args) => execFileSync(process.execPath, [path.join(__dirname, script), ...args], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-test-'));
let passed = 0;
const ok = (name) => { passed++; console.log(`ok - ${name}`); };

try {
  const cat = C.loadCatalog();
  const source = path.join(repoRoot, 'assets', 'locales', 'ja.json');
  const original = readJson(source);
  const target = path.join(tmp, 'ja.json');
  const loc = JSON.parse(JSON.stringify(original));

  // ---- Remove entries ------------------------------------------------------
  const textIndex = new Map(cat.textKeys.map((k, i) => [k, i]));
  // Keys before the last few: a pack's own extra keys sit among those (see merge-todo.js).
  const textKeys = cat.textKeys.filter((k) => textIndex.get(k) < 4000 && loc.text[k] !== k);
  const withMarker = textKeys.find((k) => k.includes('<>') && loc.text[k].includes('<>'));
  const plain = textKeys.find((k) => k.length > 40 && !k.includes('<>') && !/\{\d+\}/.test(k));
  // A key that ends with its marker, so the slot after it is empty ("Open <>").
  const edgeMarker = textKeys.find((k) => k !== withMarker && /<>$/.test(k) && /<>$/.test(loc.text[k]));
  assert(withMarker && plain && edgeMarker, 'test data: two <> keys and a plain sentence are needed');
  const removedText = [withMarker, edgeMarker, plain,...[300, 700, 1100, 1500, 1900, 2300, 2700, 2900].map((i) => cat.textKeys[i])];
  const expected = new Set();
  for (const k of removedText) { delete loc.text[k]; expected.add(`t${textIndex.get(k)}`); }

  const menuKey = cat.menuKeys[3];
  delete loc.menu[menuKey];
  expected.add(`m${cat.menuKeys.indexOf(menuKey)}`);

  const mapName = 'limitType';
  const mapKey = cat.valueMapKeys[mapName][0];
  delete loc.valueMaps[mapName][mapKey];
  expected.add(`v:${mapName}:0`);

  // Two rules lose their template; one of them is the last catalog rule of its pack, which is
  // removed entirely (merge-todo copies the zh-TW rule back and order-rules.js re-sorts).
  const catalogIds = new Set(cat.rules.map((r) => r.rule.id));
  const lastIdx = loc.patterns.map((p) => catalogIds.has(p.id)).lastIndexOf(true);
  const wholeRule = loc.patterns[lastIdx];
  const refRule = cat.rules.find((r) => r.rule.id === wholeRule.id).rule;
  assert.deepStrictEqual({ ...refRule, template: undefined }, { ...wholeRule, template: undefined },
    'test data: the removed rule must equal the zh-TW rule except for its template');
  loc.patterns.splice(lastIdx, 1);
  const stripped = loc.patterns.find((p, i) => i < 300 && catalogIds.has(p.id) && typeof p.template === 'string' && !p.replace);
  delete stripped.template;
  expected.add(`p:${wholeRule.id}`);
  expected.add(`p:${stripped.id}`);
  fs.writeFileSync(target, JSON.stringify(loc, null, 2) + '\n');

  // ---- todo.js -------------------------------------------------------------
  const outDir = path.join(tmp, 'work');
  const summary = run('todo.js', outDir, '--locale', target);
  const manifest = readJson(path.join(outDir, 'manifest.json'));
  assert.deepStrictEqual(new Set(Object.keys(manifest.items)), expected, 'manifest lists exactly the removed items');
  assert.strictEqual(manifest.batches, 1);
  const batch = readJson(path.join(outDir, 'todo-1.json'));
  assert.deepStrictEqual(batch.langs, ['ja']);
  assert.deepStrictEqual(new Set(batch.items.map((i) => i.id)), expected, 'todo-1.json lists exactly the removed items');
  assert(summary.includes('ja'), 'the summary names the language');
  ok('todo.js lists exactly the removed items');

  assert.throws(() => run('todo.js', outDir, '--locale', target), 'a used folder is refused');
  ok('todo.js refuses a folder that already has a manifest');

  // ---- original values ------------------------------------------------------
  const originalValue = (id) => {
    const m = manifest.items[id];
    if (m.kind === 'text') return original.text[m.key];
    if (m.kind === 'menu') return original.menu[m.key];
    if (m.kind === 'pattern') { const p = original.patterns.find((x) => x.id === m.ruleId); return p.template !== undefined ? p.template : p.templates; }
    if (m.kind === 'valueMap') return original.valueMaps[m.map][m.key];
    throw new Error(`unexpected kind ${m.kind}`);
  };
  const good = Object.fromEntries(Object.keys(manifest.items).map((id) => [id, originalValue(id)]));

  // ---- merge, pass 1: two broken values --------------------------------------
  const markerId = `t${textIndex.get(withMarker)}`;
  const badPatternId = `p:${wholeRule.id}`;
  const pattern = batch.items.find((i) => i.id === badPatternId);
  assert(/\{1\}/.test(pattern.en), 'test data: the removed rule has a {1}');
  const outFile = path.join(outDir, 'todo-1.out.json');
  const edgeId = `t${textIndex.get(edgeMarker)}`;
  const bad = { ...good, [markerId]: good[markerId].replace(/<>/g, ''), [edgeId]: `${good[edgeId]}x`, [badPatternId]: good[badPatternId].replace(/\{1\}/g, ''), 'x99999': 'unknown' };
  fs.writeFileSync(outFile, JSON.stringify(bad));
  run('merge-todo.js', outDir);
  const problems = readJson(path.join(outDir, 'problems.json'));
  assert.deepStrictEqual(problems.ja.map((p) => p.id).sort(), [badPatternId, markerId, edgeId, 'x99999'].sort());
  assert(problems.ja.find((p) => p.id === markerId).error.includes('<>'));
  assert(problems.ja.find((p) => p.id === edgeId).error.includes('slot'), 'text after the last <> is rejected');
  assert(problems.ja.find((p) => p.id === badPatternId).error.includes('placeholders'));
  const partial = readJson(target);
  assert(!(withMarker in partial.text), 'the rejected <> value is not written');
  assert(!partial.patterns.some((p) => p.id === wholeRule.id), 'the rejected pattern is not written');
  assert.strictEqual(partial.text[plain], original.text[plain], 'accepted values are written');
  ok('wrong placeholder, lost <>, text in an empty <> slot and unknown id go to problems.json');

  // ---- merge, pass 2: everything right ---------------------------------------
  fs.writeFileSync(outFile, JSON.stringify(good));
  const log = run('merge-todo.js', outDir);
  assert(!fs.existsSync(path.join(outDir, 'problems.json')), 'a clean run removes problems.json');
  const merged = fs.readFileSync(target, 'utf8');
  const result = JSON.parse(merged);
  assert.deepStrictEqual(Object.keys(result.text), Object.keys(original.text), 'text key order');
  assert.deepStrictEqual(Object.keys(result.menu), Object.keys(original.menu), 'menu key order');
  assert.deepStrictEqual(result.patterns.map((p) => p.id), original.patterns.map((p) => p.id), 'pattern order');
  assert.deepStrictEqual(result, original, 'the merged pack equals the original');
  assert.strictEqual(merged, JSON.stringify(original, null, 2) + '\n', 'byte-for-byte equal to the original');
  assert(/still untranslated 0\//.test(log), 'nothing is left untranslated');
  ok('merge-todo.js restores the original pack exactly');

  // ---- merge, pass 3: idempotent ----------------------------------------------
  run('merge-todo.js', outDir);
  assert.strictEqual(fs.readFileSync(target, 'utf8'), merged, 'a second merge changes nothing');
  ok('merge-todo.js is idempotent');

  // ---- todo.js on the merged pack ----------------------------------------------
  const again = run('todo.js', path.join(tmp, 'work2'), '--locale', target);
  assert(/nothing to translate/.test(again));
  assert(!fs.existsSync(path.join(tmp, 'work2')), 'no folder is created when there is nothing to do');
  ok('todo.js has nothing left after the merge');

  console.log(`${passed} checks passed`);
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
