// Times the engine's translateNode() on a mixed DOM of 3000 elements (three runs).
//
// Usage:  node bench.js [--locale <code|path>] [--engine <engine.jsfrag>]
// Input:  the locale (default zh-TW) and the engine template
//         (default assets/patches/engine.jsfrag)
// Output: one line with the engine file name and the three timings
const path = require('path');
const { JSDOM } = require('jsdom');
const { parseArgs } = require('./lib/cli');
const { loadLocale, buildPreloadFragment, DEFAULT_LOCALE, DEFAULT_ENGINE } = require('./lib/locale');
const { opts } = parseArgs(process.argv.slice(2), {
  usage: 'node bench.js [--locale <code|path>] [--engine <engine.jsfrag>]',
  options: { locale: DEFAULT_LOCALE, engine: DEFAULT_ENGINE },
});
const engine = opts.engine;
const frag = buildPreloadFragment(loadLocale(opts.locale), engine);
const times = [];
for (let r = 0; r < 3; r++) {
  const { window } = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' }); window.eval(frag);
  const doc = window.document; const big = doc.createElement('div');
  for (let i = 0; i < 1000; i++) {
    const a = doc.createElement('p'); ['No ', 'automations', ' yet'].forEach((s) => a.appendChild(doc.createTextNode(s)));
    const b = doc.createElement('button'); b.innerHTML = '<span></span>Save';
    const c = doc.createElement('div'); c.textContent = 'Some unrelated chat text that will not match anything at all';
    big.append(a, b, c);
  }
  const t0 = process.hrtime.bigint(); window.eval('translateNode')(big); times.push(Number(process.hrtime.bigint() - t0) / 1e6); window.close();
}
console.log(path.basename(engine), times.map((t) => t.toFixed(0) + 'ms').join(' '));
