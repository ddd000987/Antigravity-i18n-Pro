// End-to-end check of the sentence layer: rebuilds every split sentence as real
// DOM pieces (text nodes and inline elements), runs the real engine template
// with the locale, and checks the sentence came out joined and translated.
// Also times a large DOM.
// Same as sent-e2e.js, but lists every sentence that is not translated cleanly.
//
// Usage:  node sent-e2e-all.js <trDir> [--locale <code|path>]
// Input:  <trDir>/sentences.json (written by sentences.js); the locale (default zh-TW)
// Output: counts, sentences that still show English, and the timing, on stdout
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { parseArgs } = require('./lib/cli');
const { buildPreloadFragment, loadLocale, DEFAULT_LOCALE } = require('./lib/locale');
const { args: [trDir], opts } = parseArgs(process.argv.slice(2), {
  usage: 'node sent-e2e-all.js <trDir> [--locale <code|path>]', min: 1, max: 1, options: { locale: DEFAULT_LOCALE },
});
const loc = loadLocale(opts.locale);
const items = JSON.parse(fs.readFileSync(path.join(trDir, 'sentences.json'), 'utf8'));

const dom = new JSDOM('<!doctype html><html><body><div id=root></div></body></html>', { runScripts: 'outside-only' });
const { window } = dom;
const doc = window.document;
window.eval(buildPreloadFragment(loc));
const tick = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  const root = doc.getElementById('root');
  const cases = [];
  const samples = [
    ...loc.patterns.filter((p) => p.scope === 'sentence').map((p) => ({ key: p.pattern, sample: p.sample })),
    ...items.filter((i) => i.kind === 'text' && loc.text[i.key]).map((i) => ({ key: i.key, sample: i.key })),
  ];
  for (const item of samples) {
    // Split the sample into several text nodes at word gaps and at markers.
    const p = doc.createElement('p');
    item.sample.split('<>').forEach((chunk, i) => {
      if (i > 0) { const el = doc.createElement('span'); el.textContent = 'Foo'; p.appendChild(el); }
      chunk.split(/(?<= )/).forEach((piece) => piece && p.appendChild(doc.createTextNode(piece)));
    });
    if (p.childNodes.length < 2) p.insertBefore(doc.createElement('br'), p.firstChild);
    root.appendChild(p);
    cases.push({ item, p });
  }
  await tick();
  let ok = 0;
  const bad = [];
  for (const { item, p } of cases) {
    const text = p.textContent;
    const leftover = text.replace(/Foo|Value/g, '').match(/[A-Za-z]{3,}/g) || [];
    const joined = /[㐀-鿿]/.test(text);
    if (joined && leftover.length === 0) ok++;
    else bad.push(`${item.key}\n    -> ${text}`);
  }
  console.log(`sentences rendered ${cases.length}, translated cleanly ${ok}`);
  if (bad.length) console.log('check (English left, often product names):\n' + bad.join('\n'));

  // Timing: 3000 mixed elements inserted at once.
  const big = doc.createElement('div');
  for (let i = 0; i < 1000; i++) {
    const a = doc.createElement('p'); ['No ', 'automations', ' yet'].forEach((s) => a.appendChild(doc.createTextNode(s)));
    const b = doc.createElement('button'); b.innerHTML = '<span></span>Save';
    const c = doc.createElement('div'); c.textContent = 'Some unrelated chat text that will not match anything at all';
    big.append(a, b, c);
  }
  const t0 = Date.now();
  window.eval('translateNode')(big);
  console.log(`translateNode on 3000 elements: ${Date.now() - t0} ms`);
  window.close();
})();
