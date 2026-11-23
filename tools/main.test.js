// Exercises the main-process fragment (assets/patches/dialog.jsfrag) against a
// fake electron module: native menus, message, error and file dialogs.
//
// Usage:  node main.test.js   (or: npm test)
// Input:  none (uses the repository's dialog template and locales)
// Output: one line per test; exit code 1 if any test fails
const assert = require('assert');
const { buildDialogFragment, loadLocale } = require('./lib/locale');

const testLocale = {
  menu: { Quit: '結束', Copy: '複製', 'New Window': '新視窗' },
  dialogs: {
    Quit: '離開',
    Cancel: '取消',
    'Confirm Quit': '確認結束',
    'Stop the Antigravity server on {0}?': '要停止 {0} 上的 Antigravity 伺服器嗎？',
    'Copy {1} to {0}': '將 {1} 複製到 {0}',
    'Open workspace': '開啟工作區',
    'Cannot open folder': '無法開啟資料夾',
    'Connection info…': '連線資訊…',
  },
};

// A minimal stand-in for Electron's Menu (append and buildFromTemplate go
// through insert, as in lib/browser/api/menu.ts) and dialog.
function fakeElectron() {
  const calls = [];
  class MenuItem { constructor(o) { Object.assign(this, o); } }
  class Menu {
    constructor() { this.items = []; this.native = []; }
    insert(pos, item) { this.native.splice(pos, 0, item.label); this.items.splice(pos, 0, item); }
    append(item) { this.insert(this.items.length, item); }
    static buildFromTemplate(template) {
      const menu = new Menu();
      for (const t of template) menu.append(t instanceof MenuItem ? t : new MenuItem(t));
      return menu;
    }
  }
  const record = (name) => function (...args) { calls.push({ name, self: this, args }); return name; };
  const dialog = {};
  for (const m of ['showMessageBox', 'showMessageBoxSync', 'showOpenDialog', 'showOpenDialogSync',
    'showSaveDialog', 'showSaveDialogSync', 'showErrorBox']) dialog[m] = record(m);
  // WebContents is reachable only through an instance, as in Electron.
  class WebContents { constructor() { app.emit('web-contents-created', {}, this); } }
  WebContents.prototype.loadURL = record('loadURL');
  WebContents.prototype.send = record('send');
  const app = new (require('events'))();
  return { electron: { Menu, MenuItem, dialog, app }, calls, WebContents };
}

function load(locale) {
  const fake = fakeElectron();
  new Function('electron_1', buildDialogFragment(locale))(fake.electron);
  return fake;
}

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('message box fields and buttons are translated, dialogs over menu', () => {
  const { electron, calls } = load(testLocale);
  const win = { id: 1 };
  const options = { title: 'Confirm Quit', message: 'Stop the Antigravity server on devbox?', detail: 'Unknown', buttons: ['Cancel', 'Quit'], type: 'question' };
  assert.strictEqual(electron.dialog.showMessageBox(win, options), 'showMessageBox');
  const [w, o] = calls[0].args;
  assert.strictEqual(w, win, 'the window argument is kept');
  assert.strictEqual(o.title, '確認結束');
  assert.strictEqual(o.message, '要停止 devbox 上的 Antigravity 伺服器嗎？');
  assert.strictEqual(o.detail, 'Unknown');
  assert.deepStrictEqual(o.buttons, ['取消', '離開']);
  assert.strictEqual(o.type, 'question');
  assert.strictEqual(options.title, 'Confirm Quit', 'the caller options are not mutated');
  assert.strictEqual(calls[0].self, electron.dialog, 'receiver kept');
});

t('single-argument message box and reordered placeholders', () => {
  const { electron, calls } = load(testLocale);
  electron.dialog.showMessageBoxSync({ message: 'Copy a.txt to /tmp' });
  assert.strictEqual(calls[0].args[0].message, '將 a.txt 複製到 /tmp');
});

t('a multi-line detail is translated line by line', () => {
  const { electron, calls } = load(testLocale);
  electron.dialog.showMessageBox({ detail: 'Confirm Quit\n\nStop the Antigravity server on a?\nunknown line' });
  assert.strictEqual(calls[0].args[0].detail, '確認結束\n\n要停止 a 上的 Antigravity 伺服器嗎？\nunknown line');
});

t('a sentence that only resembles a template is left alone', () => {
  const { electron, calls } = load(testLocale);
  electron.dialog.showMessageBox({ message: 'Stop the Antigravity server on devbox? Now' });
  assert.strictEqual(calls[0].args[0].message, 'Stop the Antigravity server on devbox? Now');
});

t('open dialog and error box', () => {
  const { electron, calls } = load(testLocale);
  electron.dialog.showOpenDialog({ title: 'Open workspace', properties: ['openDirectory'], filters: [{ name: 'Cancel', extensions: ['x'] }] });
  electron.dialog.showErrorBox('Cannot open folder', 'ENOENT: C:\\x');
  assert.strictEqual(calls[0].args[0].title, '開啟工作區');
  assert.deepStrictEqual(calls[0].args[0].properties, ['openDirectory']);
  assert.deepStrictEqual(calls[0].args[0].filters, [{ name: '取消', extensions: ['x'] }]);
  assert.deepStrictEqual(calls[1].args, ['無法開啟資料夾', 'ENOENT: C:\\x']);
});

t('menu labels are translated before the native insert, menu map included', () => {
  const { electron } = load(testLocale);
  const menu = electron.Menu.buildFromTemplate([
    { label: 'New Window', id: 'n' }, { type: 'separator' }, { label: 'Connection info…' }, { label: 'Other' },
  ]);
  menu.append(new electron.MenuItem({ label: 'Copy', sublabel: 'Cancel' }));
  assert.deepStrictEqual(menu.native, ['新視窗', undefined, '連線資訊…', 'Other', '複製']);
  assert.strictEqual(menu.items[4].sublabel, '取消');
  assert.strictEqual(menu.items[0].id, 'n');
});

t('a label assigned after insert is translated too', () => {
  const locale = { ...testLocale, dialogs: { ...testLocale.dialogs, 'No agents running': '沒有執行中的代理程式', '{0} agents running': '{0} 個代理程式正在執行' } };
  const { electron } = load(locale);
  const menu = electron.Menu.buildFromTemplate([{ id: 'running-agents', label: 'No agents running' }]);
  const item = menu.items[0];
  assert.strictEqual(item.label, '沒有執行中的代理程式');
  item.label = '3 agents running';
  assert.strictEqual(item.label, '3 個代理程式正在執行');
  item.label = 'Something else';
  assert.strictEqual(item.label, 'Something else');
  assert.ok(Object.keys(item).includes('label'), 'label stays enumerable');
});

t('data: HTML pages have their text translated, scripts and styles untouched', () => {
  const locale = { ...testLocale, dialogs: { ...testLocale.dialogs, "That's too long.": '太長了。', 'Disconnected from {0}': '已與 {0} 中斷連線', 'A & B': '甲與乙' } };
  const { calls, WebContents } = load(locale);
  const first = new WebContents();
  const second = new WebContents();
  const html = '<title>Cancel</title><style>p::after{content:"Cancel"}</style><h1>  Disconnected from dev&lt;1&gt;  </h1>'
    + '<p>That&#39;s too long.</p><p>A &amp; B</p><p>Other</p><script>const s = "Cancel";</script>';
  second.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`, { extra: 1 });
  first.loadURL('https://example.com/Cancel');
  first.loadURL('data:text/html,<p>Other</p>');
  const out = decodeURIComponent(calls[0].args[0].replace(/^data:text\/html;charset=utf-8,/, ''));
  assert.strictEqual(out, '<title>取消</title><style>p::after{content:"Cancel"}</style><h1>  已與 dev&lt;1&gt; 中斷連線  </h1>'
    + '<p>太長了。</p><p>甲與乙</p><p>Other</p><script>const s = "Cancel";</script>');
  assert.deepStrictEqual(calls[0].args[1], { extra: 1 });
  assert.strictEqual(calls[0].self, second);
  assert.strictEqual(calls[1].args[0], 'https://example.com/Cancel');
  assert.strictEqual(calls[2].args[0], 'data:text/html,<p>Other</p>', 'an untranslated page keeps its URL');
});

t('the SSH prompt title sent over IPC is translated, other channels are not', () => {
  const locale = { ...testLocale, dialogs: { ...testLocale.dialogs, 'Password for {0}': '{0} 的密碼' } };
  const { calls, WebContents } = load(locale);
  const contents = new WebContents();
  const payload = { title: 'Password for me@devbox', label: 'devbox', secret: true };
  contents.send('ssh-prompt:show', payload);
  contents.send('other', { title: 'Password for me@devbox' });
  assert.deepStrictEqual(calls[0].args, ['ssh-prompt:show', { title: 'me@devbox 的密碼', label: 'devbox', secret: true }]);
  assert.strictEqual(payload.title, 'Password for me@devbox', 'the caller payload is not mutated');
  assert.strictEqual(calls[1].args[1].title, 'Password for me@devbox');
});

t('a broken argument never blocks the native call', () => {
  const { electron, calls } = load(testLocale);
  electron.dialog.showMessageBox(null);
  electron.dialog.showErrorBox();
  assert.strictEqual(calls.length, 2);
});

t('real zh-TW locale builds a fragment that translates Confirm Quit', () => {
  const { electron, calls } = load(loadLocale('zh-TW'));
  electron.dialog.showMessageBox({ title: 'Confirm Quit', buttons: ['Cancel', 'Quit'] });
  assert.notStrictEqual(calls[0].args[0].title, 'Confirm Quit');
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message.split('\n').join('\n      ')); }
}
console.log(failed ? `${failed} failed` : `all ${tests.length} passed`);
process.exit(failed ? 1 : 0);
