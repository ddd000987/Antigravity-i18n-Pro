// HISTORICAL EXAMPLE: one of the one-off scripts that patched the Antigravity
// 2.34 release end to end (zh-TW). Kept to show how such a release update is
// done; it is not a general tool. The data files it touches are command-line
// arguments.
//
// Builds sweep-1.json: menu labels missed by the 2.34 sweep, marketplace
// category names (server copy with &), and the marketplace plugin
// descriptions cached under ~/.gemini/antigravity/cache/marketplaces.
//
// Usage:  node build.js <out-sweep-1.json> [--locale <code|path>] [--marketplaces <dir>]
// Input:  the locale (default zh-TW; strings it already has are skipped) and the
//         marketplace cache (default ~/.gemini/antigravity/cache/marketplaces,
//         one <name>/marketplace.json per marketplace)
// Output: <out-sweep-1.json>
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseArgs } = require('../../../lib/cli');
const { loadLocale, DEFAULT_LOCALE } = require('../../../lib/locale');
const { args: [outPath], opts } = parseArgs(process.argv.slice(2), {
  usage: 'node build.js <out-sweep-1.json> [--locale <code|path>] [--marketplaces <dir>]',
  min: 1, max: 1,
  options: { locale: DEFAULT_LOCALE, marketplaces: path.join(os.homedir(), '.gemini', 'antigravity', 'cache', 'marketplaces') },
});
const loc = loadLocale(opts.locale);
const items = [];
const seen = new Set();
const add = (en, context) => {
  en = en.trim();
  if (!en || seen.has(en) || loc.text[en]) return;
  seen.add(en);
  items.push({ en, type: 'string', context });
};
add('Sort Projects', 'sidebar filter menu item, sibling of "Sort Conversations" → 排序對話');
add('Sort Workspaces', 'sidebar filter menu item, sibling of "Sort Conversations" → 排序對話');
for (const c of ['Data & Analytics', 'Design, Creative & Media', 'Productivity & Project Management', 'Cloud Hosting & Deployment']) {
  add(c, 'marketplace category heading (siblings: "Developer Tools" → 開發人員工具, "Build with Google" → 使用 Google 建構)');
}
const dir = opts.marketplaces;
for (const m of fs.readdirSync(dir)) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, m, 'marketplace.json'), 'utf8'));
  for (const p of j.plugins || []) {
    if (p.description) add(p.description.replace(/\s+/g, ' '), `marketplace plugin card description for "${p.displayName || p.name}" (${m})`);
  }
}
fs.writeFileSync(outPath, JSON.stringify(items, null, 2) + '\n');
console.log('items', items.length);
