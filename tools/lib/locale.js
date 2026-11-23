// Shared locale helpers for the maintenance scripts.
//
//   repoRoot                      absolute path of the repository root
//   DEFAULT_LOCALE                the locale every script uses when --locale is omitted
//   localePath(codeOrPath)        "zh-TW" -> <repo>/assets/locales/zh-TW.json; a value
//                                 with a path separator or ending in .json is a file path
//   loadLocale(codeOrPath)        parsed locale JSON
//   saveLocale(codeOrPath, loc)   writes the locale back (2-space indent, trailing newline)
//   buildPreloadFragment(locale)  the engine fragment the Go side injects into the renderer:
//                                 assets/patches/engine.jsfrag with the first
//                                 LOCALE_DATA_PLACEHOLDER replaced by the renderer data
'use strict';
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const DEFAULT_LOCALE = 'zh-TW';
const DEFAULT_ENGINE = path.join(repoRoot, 'assets', 'patches', 'engine.jsfrag');
const PLACEHOLDER = 'LOCALE_DATA_PLACEHOLDER';
const DEFAULT_DIALOG = path.join(repoRoot, 'assets', 'patches', 'dialog.jsfrag');
const DIALOG_PLACEHOLDER = 'DIALOG_DATA_PLACEHOLDER';

// Mirrors the field list of buildPreloadFragment in internal/core/locale.go.
// Native maps (menu, dialogs) and report-only metadata (allowSourceEqual) are
// not part of the renderer data. Empty values are omitted like Go's omitempty.
const RENDERER_FIELDS = [
  'language', 'name', 'englishName', 'htmlLang', 'chromiumLang', 'dir', 'pluralLocale',
  'text', 'punctuation', 'punctuationSkipSuffixes', 'valueMaps', 'valueRules', 'patterns',
];

function localePath(codeOrPath = DEFAULT_LOCALE) {
  if (/[\\/]/.test(codeOrPath) ||/\.json$/i.test(codeOrPath)) return path.resolve(codeOrPath);
  return path.join(repoRoot, 'assets', 'locales', `${codeOrPath}.json`);
}

function loadLocale(codeOrPath = DEFAULT_LOCALE) {
  const file = localePath(codeOrPath);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read locale "${codeOrPath}" (${file}): ${err.message}`);
  }
}

function saveLocale(codeOrPath, locale) {
  fs.writeFileSync(localePath(codeOrPath), JSON.stringify(locale, null, 2) + '\n', 'utf8');
}

function isEmpty(v) {
  if (v === undefined || v === null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

function rendererData(locale) {
  const data = {};
  for (const k of RENDERER_FIELDS) if (!isEmpty(locale[k])) data[k] = locale[k];
  return data;
}

function buildPreloadFragment(locale, enginePath = DEFAULT_ENGINE) {
  const template = fs.readFileSync(enginePath, 'utf8');
  const at = template.indexOf(PLACEHOLDER);
  if (at < 0) throw new Error(`${enginePath} has no ${PLACEHOLDER}`);
  // Replace the first occurrence only: the template mentions the placeholder
  // in its own comments.
  return template.slice(0, at) + JSON.stringify(rendererData(locale)) + template.slice(at + PLACEHOLDER.length);
}

// Mirrors buildDialogFragment in internal/core/locale.go.
function buildDialogFragment(locale, templatePath = DEFAULT_DIALOG) {
  const template = fs.readFileSync(templatePath, 'utf8');
  const at = template.indexOf(DIALOG_PLACEHOLDER);
  if (at < 0) throw new Error(`${templatePath} has no ${DIALOG_PLACEHOLDER}`);
  const native = { ...(locale.menu || {}), ...(locale.dialogs || {}) };
  return template.slice(0, at) + JSON.stringify(native) + template.slice(at + DIALOG_PLACEHOLDER.length);
}

module.exports = {
  repoRoot, DEFAULT_LOCALE, DEFAULT_ENGINE, localePath, loadLocale, saveLocale, rendererData,
  buildPreloadFragment, buildDialogFragment,
};
