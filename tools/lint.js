// Quality lint for a zh-TW dictionary: Mainland terms / simplified characters
// (via OpenCC and a term list), 你 vs 您, edge-whitespace and ellipsis drift,
// half-width punctuation, leftover placeholders, near-duplicate keys translated
// differently, and glossary consistency. Optionally compares with another
// dictionary. The checks are Chinese-specific.
//
// Usage:  node lint.js [--locale <code|path>] [--upstream <other-dictionary.json>]
// Input:  the locale (default zh-TW); optional second dictionary ({ text: {...} })
// Output: a report on stdout (first 25 entries per finding)
const fs = require('fs');
const OpenCC = require('opencc-js');
const { parseArgs } = require('./lib/cli');
const { loadLocale, DEFAULT_LOCALE } = require('./lib/locale');
const { opts } = parseArgs(process.argv.slice(2), {
  usage: 'node lint.js [--locale <code|path>] [--upstream <other-dictionary.json>]',
  options: { locale: DEFAULT_LOCALE, upstream: null },
});
const loc = loadLocale(opts.locale);
const up = opts.upstream ? JSON.parse(fs.readFileSync(opts.upstream, 'utf8')) : null;
const s2tw = OpenCC.Converter({ from: 'cn', to: 'twp' });
const t2tw = OpenCC.Converter({ from: 't', to: 'twp' });
const out = {};
const push = (k, v) => (out[k] = out[k] || []).push(v);
const MAIN = /設置|配置|運行|創建|默認|加載|消息|服務器|文件夾|視頻|屏幕|刷新|窗口|用戶(?!端)|項目|代碼|信息|菜單|鼠標|程序(?!碼)|軟件|硬件|網絡|數據|激活|登錄|賬|搜索|獲取|調用|接口|實時|緩存|內存|磁盤|光標|粘貼|剪貼板|文本|字符|變量|函數|對象|數組|卸載|視圖|模板|日誌|線程|進程|端口|地址|鏈接|質量|優化|擴展|插件|打開|重命名|批量|隊列|示例|導航|反饋|概覽|頭像|全屏|標簽|選項卡|兼容|文檔|在線|撤銷|文本框|單擊|點擊|雙擊|拖拽|滾動|圖標|音頻|支持|智能|算法|網關|調試|構建|依賴|實例|會話|令牌|密鑰|註銷|退出|文件|保存/g;
const isCJK = /[\u3400-\u9fff]/;
let you = 0, nin = 0;
const trailColonHalf = [], spacing = { spaced: 0, tight: 0 };
for (const [k, v] of Object.entries(loc.text)) {
  if (v !== s2tw(v)) push('opencc cn->twp differs (simplified char or mainland phrase)', `${k} => ${v}  ~>  ${s2tw(v)}`);
  const m = v.match(MAIN); if (m) push('mainland term', `${[...new Set(m)].join(',')}: ${k} => ${v}`);
  if (/你/.test(v)) you++; if (/您/.test(v)) nin++;
  if (/你/.test(v)) push('uses 你', `${k} => ${v}`);
  const lw = (s) => s.match(/^\s*/)[0], tw = (s) => s.match(/\s*$/)[0];
  if (lw(k) !== lw(v) || tw(k) !== tw(v)) push('edge whitespace differs', JSON.stringify(k) + ' => ' + JSON.stringify(v));
  if (k === v && /[A-Za-z]{3,}/.test(k)) push('value equals key', k);
  if (/\{\d+\}/.test(v)) push('placeholder in text value', `${k} => ${v}`);
  if (/\.\.\.$/.test(k) !== /\.\.\.$/.test(v) && /…$/.test(k) !== /…$/.test(v)) push('ellipsis style changed', `${k} => ${v}`);
  if (isCJK.test(v) && /[\u3400-\u9fff][,;!?]|[,;!?][\u3400-\u9fff]|[\u3400-\u9fff]\.(?!\.)|\((?=[\u3400-\u9fff])|[\u3400-\u9fff]\)/.test(v)) push('half-width punctuation in Chinese', `${k} => ${v}`);
  if (isCJK.test(v) && /[\u3400-\u9fff]:\s*$/.test(v)) trailColonHalf.push(k);
  if (isCJK.test(v) && /[A-Za-z0-9]/.test(v)) {
    if (/[\u3400-\u9fff] [A-Za-z0-9]|[A-Za-z0-9] [\u3400-\u9fff]/.test(v)) spacing.spaced++;
    if (/[\u3400-\u9fff][A-Za-z0-9]|[A-Za-z0-9][\u3400-\u9fff]/.test(v)) spacing.tight++;
  }
  if (!isCJK.test(v) && /[a-z]{3,} [a-z]{3,}/i.test(v)) push('value has no Chinese', `${k} => ${v}`);
}
// near-duplicate keys (case / trailing punctuation) translated differently
const norm = (s) => s.trim().toLowerCase().replace(/[.:…!?]+$/, '');
const byNorm = new Map();
for (const [k, v] of Object.entries(loc.text)) { const n = norm(k); (byNorm.get(n) || byNorm.set(n, []).get(n)).push([k, v]); }
const stripP = (s) => s.trim().replace(/[.:…!?。：！？]+$/, '');
for (const g of byNorm.values()) if (g.length > 1 && new Set(g.map(([, v]) => stripP(v))).size > 1) push('inconsistent variants', g.map(([k, v]) => `${k}=>${v}`).join(' | '));
// glossary consistency: same English term, multiple renderings
const GLOSS = { Agent: /代理程式|代理(?!程式)|智能體|助理/g, Workspace: /工作區|工作空間/g, Repository: /存放庫|儲存庫|倉庫|版本庫/g, Artifact: /Artifact|成品|產出物|構件/g, Worktree: /工作樹|工作目錄/g, Skill: /技能/g, Hook: /掛鉤|鉤子|勾點/g, Conversation: /對話|會話|聊天/g, Prompt: /提示詞|提示(?!詞)/g, Rule: /規則/g, Sandbox: /沙箱|沙盒/g, Commit: /提交|認可|送出/g, 'Pull Request': /提取要求|拉取請求|合併請求/g, Extension: /擴充功能|擴充套件|擴展/g, Credit: /額度|點數|積分/g, Server: /伺服器/g, Token: /token|權杖|Token|詞元/g };
const gl = {};
for (const [k, v] of Object.entries(loc.text)) for (const [term, re] of Object.entries(GLOSS)) {
  if (!new RegExp('\\b' + term + 's?\\b', 'i').test(k)) continue;
  for (const m of v.match(re) || []) { gl[term] = gl[term] || {}; gl[term][m] = (gl[term][m] || 0) + 1; }
}
console.log('you/您 counts', you, nin, '| trailing half-width colon after CJK', trailColonHalf.length, '| CJK-Latin spacing', JSON.stringify(spacing));
console.log('glossary renderings', JSON.stringify(gl));
for (const [k, list] of Object.entries(out)) console.log(`\n## ${k}: ${list.length}\n` + list.slice(0, 25).join('\n'));
if (up) {
  let same = 0, diff = [];
  for (const [k, v] of Object.entries(up.text)) if (k in loc.text) (loc.text[k] === v ? same++ : diff.push(`${k} => ours ${loc.text[k]} | up ${v}`));
  console.log(`\n## vs upstream zh-Hant: same ${same}, different ${diff.length}\n` + diff.slice(0, 40).join('\n'));
  let u = 0; for (const v of Object.values(up.text)) if (v !== t2tw(v)) u++;
  console.log('upstream values not in Taiwan phrasing per OpenCC:', u);
  console.log('upstream trailing colon style:', Object.values(up.text).filter((v) => /[\u3400-\u9fff]:\s*$/.test(v)).length, 'half vs', Object.values(up.text).filter((v) => /：\s*$/.test(v)).length, 'full');
}
