// Exercises the DOM engine (assets/patches/engine.jsfrag: sentence layer and
// per-node path) in jsdom with a small test locale, including React-style
// in-place text updates, plus one smoke test against the real zh-TW locale.
//
// Usage:  node engine.test.js   (or: npm test)
// Input:  none (uses the repository's engine template and locales)
// Output: one line per test; exit code 1 if any test fails
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { buildPreloadFragment, loadLocale } = require('./lib/locale');

const testLocale = {
  language: 'zh-TW', name: 't', englishName: 't', htmlLang: 'zh-TW', dir: 'ltr',
  punctuation: { '.': '。', ':': '：' }, punctuationSkipSuffixes: ['。', '：'],
  valueMaps: { nouns: { automations: '自動化', 'scheduled tasks': '排程任務' } },
  valueRules: {},
  patterns: [
    { id: 'noYet', pattern: '^No (.+?) yet$', template: '尚無{1}', replace: { 1: 'nouns' } },
    { id: 'panel', pattern: '^Open (.+?) panel$', template: '開啟 {1} 面板', scope: 'sentence' },
    { id: 'commit', pattern: '^Commit (.+?) files? to (.+?)$', template: '將 {1} 個檔案提交至 {2}' },
  ],
  text: {
    Save: '儲存', No: '否', Terms: '條款', 'Learn more by visiting our <>.': '如需了解詳情，請造訪我們的<>。',
    'Press <> to send': '按 <> 傳送', 'Wrong <> order <>': '錯誤', 'Open': '開啟',
  },
};

async function run(locale, html, steps) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { runScripts: 'outside-only' });
  const { window } = dom;
  window.eval(buildPreloadFragment(locale));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  await tick();
  await steps(window.document, tick, window);
  window.close();
}
const texts = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue);
const t = (name, fn) => tests.push([name, fn]);
const tests = [];

t('split sentence joins and maps the noun', () => run(testLocale, '<p id=p></p>', async (doc, tick) => {
  const p = doc.getElementById('p');
  ['No ', 'automations', ' yet'].forEach((s) => p.appendChild(doc.createTextNode(s)));
  await tick();
  assert.strictEqual(p.textContent, '尚無自動化');
  assert.deepStrictEqual(texts(p), ['尚無自動化', '', '']);
}));

t('initial render of a split sentence', () => run(testLocale, '<p id=p>No <!---->automations<!----> yet</p>', async (doc) => {
  assert.strictEqual(doc.getElementById('p').textContent, '尚無自動化');
}));

t('React updates the middle piece', () => run(testLocale, '<p id=p></p>', async (doc, tick) => {
  const p = doc.getElementById('p');
  const nodes = ['No ', 'automations', ' yet'].map((s) => p.appendChild(doc.createTextNode(s)));
  await tick();
  nodes[1].nodeValue = 'scheduled tasks';
  await tick();
  assert.strictEqual(p.textContent, '尚無排程任務');
  await tick(); await tick();
  assert.strictEqual(p.textContent, '尚無排程任務', 'stable, no feedback loop');
}));

t('sentence that stops matching restores the English source', () => run(testLocale, '<p id=p></p>', async (doc, tick) => {
  const p = doc.getElementById('p');
  const nodes = ['No ', 'automations', ' yet'].map((s) => p.appendChild(doc.createTextNode(s)));
  await tick();
  nodes[2].nodeValue = ' here';
  await tick();
  // "No" alone is still a per-node dictionary hit; the rest is the source.
  assert.deepStrictEqual(texts(p), ['否 ', 'automations', ' here']);
}));

t('pattern with captures across pieces', () => run(testLocale, '<p id=p></p>', async (doc, tick) => {
  const p = doc.getElementById('p');
  ['Commit ', '3', ' files', ' to ', 'main'].forEach((s) => p.appendChild(doc.createTextNode(s)));
  await tick();
  assert.strictEqual(p.textContent, '將 3 個檔案提交至 main');
}));

t('inline link keeps its position and its own translation', () => run(testLocale, '<p id=p>Learn more by visiting our <a href="#">Terms</a>.</p>', async (doc) => {
  const p = doc.getElementById('p');
  assert.strictEqual(p.textContent, '如需了解詳情，請造訪我們的條款。');
  assert.strictEqual(p.querySelector('a').textContent, '條款');
}));

t('inline kbd keeps its content inside a joined sentence', () => run(testLocale, '<p id=p>Press <kbd>Enter</kbd> to send</p>', async (doc) => {
  const p = doc.getElementById('p');
  assert.strictEqual(p.textContent, '按 Enter 傳送');
  assert.strictEqual(p.querySelector('kbd').textContent, 'Enter', 'kbd content untouched');
}));

t('translation that drops a marker falls back to per-node', () => run(testLocale, '<p id=p>Wrong <b>x</b> order <b>y</b></p>', async (doc) => {
  assert.strictEqual(doc.getElementById('p').textContent, 'Wrong x order y');
}));

t('icon plus label still translates the label', () => run(testLocale, '<button id=b><span class="icon"></span>Save</button>', async (doc) => {
  assert.strictEqual(doc.getElementById('b').textContent, '儲存');
}));

t('block children are never joined', () => run(testLocale, '<div id=d>No <div>automations</div> yet</div>', async (doc) => {
  assert.deepStrictEqual(texts(doc.getElementById('d')), ['否 ', ' yet']);
}));

t('code and textbox content untouched (jsdom lacks isContentEditable)', () => run(testLocale, '<pre id=c>No <span>automations</span> yet</pre><div role="textbox" id=e>Save</div>', async (doc) => {
  assert.strictEqual(doc.getElementById('c').textContent, 'No automations yet');
  assert.strictEqual(doc.getElementById('e').textContent, 'Save');
}));

t('single text node behaves as before and survives re-render', () => run(testLocale, '<span id=s>Save</span>', async (doc, tick) => {
  const s = doc.getElementById('s');
  assert.strictEqual(s.textContent, '儲存');
  s.firstChild.nodeValue = 'Open';
  await tick();
  assert.strictEqual(s.textContent, '開啟');
}));

t('nodes added later are joined', () => run(testLocale, '<div id=root></div>', async (doc, tick) => {
  const p = doc.createElement('p');
  ['No ', 'automations', ' yet'].forEach((s) => p.appendChild(doc.createTextNode(s)));
  doc.getElementById('root').appendChild(p);
  await tick();
  assert.strictEqual(p.textContent, '尚無自動化');
}));

t('a piece removed by React re-evaluates the sentence', () => run(testLocale, '<p id=p></p>', async (doc, tick) => {
  const p = doc.getElementById('p');
  const nodes = ['No ', 'automations', ' yet'].map((s) => p.appendChild(doc.createTextNode(s)));
  await tick();
  p.removeChild(nodes[2]);
  await tick();
  assert.deepStrictEqual(texts(p), ['否 ', 'automations']);
}));

t('sentence-scoped rule skips a lone text node but joins pieces', () => run(testLocale, '<span id=a>Open Foo panel</span><span id=b>Open <!---->Foo<!----> panel</span>', async (doc) => {
  assert.strictEqual(doc.getElementById('a').textContent, 'Open Foo panel');
  assert.strictEqual(doc.getElementById('b').textContent, '開啟 Foo 面板');
}));

t('real zh-TW locale loads and translates a known string', () => run(loadLocale('zh-TW'), '<span id=s>Settings</span>', async (doc) => {
  assert.notStrictEqual(doc.getElementById('s').textContent, 'Settings');
}));

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message.split('\n').join('\n      ')); }
  }
  console.log(failed ? `${failed} failed` : `all ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
