// HISTORICAL EXAMPLE: one of the one-off scripts that patched the Antigravity
// 2.34 release end to end (zh-TW). Kept to show how such a release update is
// done; it is not a general tool. The data files it touches are command-line
// arguments.
//
// Writes sentences.json + sent-1.out.json for merge-sent.js: the 2.34 split
// sentences (from the sentences.js delta), the combined forms that appear when
// two Fragments render into the same parent, and the third-party disclaimer.
//
// Usage:  node build.js <sentences-delta.json> <outDir>
// Input:  sentences.js output limited to the new sentences
// Output: <outDir>/sentences.json and <outDir>/sent-1.out.json
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('../../../../lib/cli');
const { args: [deltaPath, outDir] } = parseArgs(process.argv.slice(2), { usage: 'node build.js <sentences-delta.json> <outDir>', min: 2, max: 2 });
const delta = JSON.parse(fs.readFileSync(deltaPath, 'utf8'));
const items = delta.map(({ kind, key, sample, captures }) => ({ kind, key, sample, captures }));
const text = (key) => items.push({ kind: 'text', key, sample: key, captures: [] });

const TURN_ON = 'In System Settings, turn on <>. If it isn\'t in the list, drag it in from the small window next to System Settings.';
const CLICK = 'In System Settings, click <>, choose <>, then turn it on.';
const AGAIN_DRAG = 'Already on? Select <>, click <>, then drag it back in from the small window.';
const AGAIN_ADD = 'Already on? Select <>, click <>, then click <> and add it again.';
const DISCLAIMER = 'Google does not control the availability or functionality of third party developer tools. Your data from third party developer tools connected to your Antigravity instance may be shared with Google. Google will protect any such data in accordance with the Google Privacy Policy, found here: <>';
for (const k of [AGAIN_DRAG, AGAIN_ADD, `${TURN_ON} ${AGAIN_DRAG}`, `${CLICK} ${AGAIN_ADD}`, DISCLAIMER]) text(k);

const zh = {
  [TURN_ON]: '在「系統設定」中開啟 <>。如果清單中沒有，請從「系統設定」旁的小視窗將它拖曳進去。',
  [CLICK]: '在「系統設定」中點選 <>，選擇 <>，然後將它開啟。',
  'click <> and add it again.': '點選 <> 再重新加入。',
  '^Already on\\? Select <>, click <>, then (.+?)$': '已經開啟了嗎？請選取 <>，點選 <>，然後{1}',
  '^Telemetry is turned off for your account\\. (.+?) does not collect any of your prompts, content, or model responses but will still collect general usage patterns \\(e\\.g\\., feature adoption, active user counts\\)\\.$':
    '您的帳戶已關閉遙測。{1} 不會收集您的任何提示、內容或模型回應，但仍會收集一般使用模式（例如功能採用率、活躍使用者數）。',
  'Messages now send immediately. Configure in <>': '訊息現在會立即傳送。如需調整，請前往<>',
  'Workflows are changing on October 19th—stay tuned for updates. You can use the agent to migrate your workflows. <>':
    '工作流程將於 10 月 19 日變更，敬請期待後續更新。您可以使用代理程式來遷移您的工作流程。<>',
  [AGAIN_DRAG]: '已經開啟了嗎？請選取 <>，點選 <>，然後從小視窗將它拖曳回來。',
  [AGAIN_ADD]: '已經開啟了嗎？請選取 <>，點選 <>，然後點選 <> 再重新加入。',
  [DISCLAIMER]: 'Google 無法控制第三方開發人員工具的可用性或功能。連結至您 Antigravity 執行個體的第三方開發人員工具資料，可能會與 Google 共用。Google 將依據 Google 隱私權政策保護這類資料，政策請見：<>',
};
zh[`${TURN_ON} ${AGAIN_DRAG}`] = `${zh[TURN_ON]}${zh[AGAIN_DRAG]}`;
zh[`${CLICK} ${AGAIN_ADD}`] = `${zh[CLICK]}${zh[AGAIN_ADD]}`;

const out = { items: {}, skipped: [] };
for (const it of items) {
  if (!zh[it.key]) throw new Error(`no translation: ${it.key}`);
  out.items[it.key] = { zh: zh[it.key] };
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'sentences.json'), JSON.stringify(items, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, 'sent-1.out.json'), JSON.stringify(out, null, 2) + '\n');
console.log('items', items.length);
