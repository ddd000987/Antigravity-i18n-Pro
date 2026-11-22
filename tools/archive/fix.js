// HISTORICAL one-off review pass, kept as a template for similar clean-ups:
// terminology consistency, punctuation, no-op entries, and pattern ordering /
// over-matching guards. The explicit value fixes in section 2 are specific to
// the zh-TW dictionary of that release; edit them before reusing. Modifies the
// locale file in place.
//
// Usage:  node fix.js [--locale <code|path>]
// Input/Output: the locale (default zh-TW), rewritten in place; the change log is printed
const { parseArgs } = require('../lib/cli');
const { loadLocale, saveLocale, DEFAULT_LOCALE } = require('../lib/locale');
const { opts } = parseArgs(process.argv.slice(2), { usage: 'node fix.js [--locale <code|path>]', options: { locale: DEFAULT_LOCALE } });
const loc = loadLocale(opts.locale);
const log = [];
const CJK = '㐀-鿿';

// 1. Entries whose value equals the key do nothing.
for (const k of ['Artifact', 'Artifacts', 'Cookie', 'Shift', 'Chief of Staff canvas']) {
  if (loc.text[k] === k) { delete loc.text[k]; log.push(`removed no-op ${k}`); }
}

// 2. Explicit value fixes (variant pairs, select wording, wording).
const SET = {
  'Queued Messages': '佇列中的訊息',
  'Queued messages': '佇列中的訊息',
  'Your Plan:': '您的方案：',
  'New conversation': '新增對話',
  'Authentication Required': '需要驗證',
  'MCP servers': 'MCP 伺服器',
  'Notification preferences': '通知偏好設定',
  'Bad response': '回應不佳',
  'Bad Response': '回應不佳',
  'Good response': '回應良好',
  'Good Response': '回應良好',
  'More Actions': '更多動作',
  'Select Environment': '選取環境',
  'Select model': '選取模型',
  'Select project folder': '選取專案資料夾',
  'Select language': '選取語言',
  'Select Previous Conversation': '選取上一個對話',
  'Select Next Conversation': '選取下一個對話',
  'Select a folder.': '選取資料夾。',
  'Found references to': '找到以下項目的參照',
  'Substring or list check (e.g.': '子字串或清單檢查 (例如',
};
for (const [k, v] of Object.entries(SET)) {
  if (!(k in loc.text)) { log.push(`MISSING key ${k}`); continue; }
  if (loc.text[k] !== v) { log.push(`set ${k}: ${loc.text[k]} -> ${v}`); loc.text[k] = v; }
}

// 3. Term replacements applied to every value and template.
const TERMS = [
  [/帳號/g, '帳戶'],
  [/瞭解/g, '了解'],
  [/點擊/g, '點選'],
  [/Token/g, 'token'],
  [/skills/g, '技能'],
];
// Full-width parentheses after Chinese text when the pair is complete.
const PAREN = new RegExp(`([${CJK}]) ?\\(([^()]*)\\)`, 'g');
// Space between Chinese text and a placeholder, matching the dictionary style.
const SPACE_L = new RegExp(`([${CJK}])\\{`, 'g');
const SPACE_R = new RegExp(`\\}([${CJK}])`, 'g');
function clean(v, isTemplate) {
  let out = v;
  for (const [re, to] of TERMS) out = out.replace(re, to);
  out = out.replace(PAREN, '$1（$2）');
  if (isTemplate) out = out.replace(SPACE_L, '$1 {').replace(SPACE_R, '} $1');
  return out;
}
let termChanges = 0;
for (const [k, v] of Object.entries(loc.text)) {
  const nv = clean(v, false);
  if (nv !== v) { loc.text[k] = nv; termChanges++; }
}
for (const p of loc.patterns) {
  if (p.template) { const nv = clean(p.template, true); if (nv !== p.template) { p.template = nv; termChanges++; } }
  if (p.templates) for (const [c, t] of Object.entries(p.templates)) { const nv = clean(t, true); if (nv !== t) { p.templates[c] = nv; termChanges++; } }
}
log.push(`term/punctuation changes ${termChanges}`);
const sm = loc.patterns.find((p) => p.id === 'selectModel');
if (sm) sm.template = sm.template.replace('選擇模型', '選取模型');

// 4. Drop the duplicate of the original selectModel rule.
loc.patterns = loc.patterns.filter((p) => p.id !== 'ui217');

// 5. Guard captures of short generic rules: the value must start with a
//    non-lowercase character or be a single token, so prose such as
//    "Set up the database" is not half translated. RE2-compatible (no lookaround).
const GUARD = '([^a-z\\s].*?|\\S+?)';
let guarded = 0;
for (const p of loc.patterns) {
  if (!p.id.startsWith('ui')) continue;
  const fixed = p.pattern.replace(/\(\.\+\?\)/g, '').replace(/[\^$\\]/g, '').replace(/[^A-Za-z]/g, '');
  if (fixed.length >= 25 || !p.pattern.includes('(.+?)')) continue;
  // Only guard captures that continue a phrase ("Set up X", "X may have"),
  // not value slots after ": ", inside brackets or quotes, which often hold
  // lowercase error text.
  const parts = p.pattern.split('(.+?)');
  let changed = false;
  let out = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const before = parts[i - 1];
    const slot = /(:\s*|\\\(|["'“‘「])$/.test(before);
    out += (slot ? '(.+?)' : GUARD) + parts[i];
    if (!slot) changed = true;
  }
  if (!changed) continue;
  p.pattern = out;
  guarded++;
}
log.push(`guarded rules ${guarded}`);

// 6. Order so that a rule is never shadowed by an earlier, more generic one.
const re = (p) => new RegExp(p.pattern, p.flags || '');
for (let pass = 0; pass < 50; pass++) {
  let moved = false;
  for (let i = 0; i < loc.patterns.length; i++) {
    const p = loc.patterns[i];
    if (!p.sample) continue;
    const j = loc.patterns.findIndex((q) => re(q).test(p.sample));
    if (j !== -1 && j < i) {
      loc.patterns.splice(i, 1);
      loc.patterns.splice(j, 0, p);
      moved = true;
      log.push(`moved ${p.id} before ${loc.patterns[j + 1].id}`);
    }
  }
  if (!moved) break;
}

saveLocale(opts.locale, loc);
console.log(log.join('\n'));
console.log('text', Object.keys(loc.text).length, 'patterns', loc.patterns.length);
