// Counts how each English glossary term is rendered across the dictionary, to
// spot inconsistent terminology. The term table below is for zh-TW; adapt it
// to another language.
//
// Usage:  node gloss.js [--locale <code|path>]
// Input:  the locale (default zh-TW)
// Output: per term, a JSON map of renderings -> counts, plus examples of the minority renderings
const { parseArgs } = require('./lib/cli');
const { loadLocale, DEFAULT_LOCALE } = require('./lib/locale');
const { opts } = parseArgs(process.argv.slice(2), { usage: 'node gloss.js [--locale <code|path>]', options: { locale: DEFAULT_LOCALE } });
const loc = loadLocale(opts.locale);
const G = {
  Agent: '代理程式|代理(?!程式|人)|智能體|助理',
  Workspace: '工作區|工作空間',
  Repositor: '存放庫|儲存庫|倉庫|版本庫',
  Worktree: '工作樹|工作目錄',
  Hook: '掛鉤|鉤子|勾點|Hook',
  Conversation: '對話|會話|聊天',
  Prompt: '提示詞|提示(?!詞)|Prompt',
  Sandbox: '沙箱|沙盒',
  Commit: '提交|認可|送出|Commit',
  Extension: '擴充功能|擴充套件|擴展',
  Credit: '額度|點數|積分',
  Token: 'token|權杖|Token|詞元',
  Skill: '技能|Skill|skill',
  Pane: '窗格|面板',
  Panel: '面板|窗格',
  Plugin: '外掛程式|外掛|插件|Plugin',
  Marketplace: '市集|市場|商店',
  Customization: '自訂|自定義',
  Click: '按一下|點選|點擊|按下',
  Select: '選取|選擇',
  Directory: '目錄|資料夾',
  Folder: '資料夾|目錄',
  Log: '記錄|日誌|紀錄|Log',
  Task: '任務|工作',
  Artifact: 'Artifact|成品|產出',
  Review: '審查|檢閱|審核',
  Approv: '核准|批准|同意',
  Account: '帳號|帳戶',
  Learn: '了解|瞭解',
  Current: '目前|當前',
};
const gl = {};
const ex = {};
for (const [k, v] of Object.entries(loc.text)) {
  for (const [t, src] of Object.entries(G)) {
    if (!new RegExp('\\b' + t, 'i').test(k)) continue;
    const ms = v.match(new RegExp(src, 'g')) || ['(none)'];
    for (const m of ms) {
      (gl[t] = gl[t] || {})[m] = (gl[t][m] || 0) + 1;
      const key = t + ':' + m;
      (ex[key] = ex[key] || []).push(`${k} => ${v}`);
    }
  }
}
for (const [t, o] of Object.entries(gl)) {
  console.log(t.padEnd(14), JSON.stringify(o));
  const counts = Object.entries(o).sort((a, b) => b[1] - a[1]);
  for (const [m] of counts.slice(1)) console.log('   minority', m + ':', ex[t + ':' + m].slice(0, 4).join(' || '));
}
