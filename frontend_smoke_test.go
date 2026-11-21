package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/dop251/goja"
)

// The window's script is not covered by any compiler or by go vet, and a
// runtime error part way through it leaves the HTML untouched: the page still
// renders, showing whatever the markup hardcoded, so nothing looks broken from
// the outside. That is exactly how a mistyped variable hid behind a working
// window. This runs the real app.js against a DOM stub so such an error fails
// the build instead of silently freezing the interface.

// domStub builds just enough of a browser for app.js: element lookups, the
// event registration it does, timers, and the Wails binding object.
//
// Every element the markup gives an id or a data-i18n attribute is created from
// its real tag (class and attributes included), so a hidden class set in the
// HTML is hidden here too and the script's own class changes can be read back.
const domStub = `
var __els = {};
var __i18nEls = [];

function makeEl(id) {
  var el = {
    id: id,
    title: '',
    className: '',
    disabled: false,
    type: '',
    value: '',
    lang: '',
    scrollTop: 0,
    scrollHeight: 0,
    onclick: null,
    style: {},
    _children: [],
    _attrs: {},
    _listeners: {},
    _click: null,
    setAttribute: function (name, value) { this._attrs[name] = String(value); },
    getAttribute: function (name) {
      return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null;
    },
    appendChild: function (c) { this._children.push(c); },
    querySelectorAll: function () { return []; },
    addEventListener: function (type, fn) {
      this._listeners[type] = fn;
      if (type === 'click') { this._click = fn; }
    }
  };
  el.classList = {
    add: function (c) {
      var cs = el.className.split(/\s+/).filter(Boolean);
      if (cs.indexOf(c) < 0) { cs.push(c); }
      el.className = cs.join(' ');
    },
    remove: function (c) {
      el.className = el.className.split(/\s+/).filter(function (x) { return x && x !== c; }).join(' ');
    },
    toggle: function (c) {
      if (el.classList.contains(c)) { el.classList.remove(c); } else { el.classList.add(c); }
    },
    contains: function (c) { return el.className.split(/\s+/).indexOf(c) >= 0; }
  };
  // A real element's textContent includes its children's text, and the chip
  // label is built from two spans, so the stub has to concatenate them.
  var _text = '';
  Object.defineProperty(el, 'textContent', {
    get: function () {
      var out = _text;
      for (var i = 0; i < el._children.length; i++) { out += el._children[i].textContent; }
      return out;
    },
    set: function (v) { _text = v; }
  });
  // Clearing innerHTML is how the script resets the locale list, so the chip
  // tally has to follow it or repeated renders inflate the count.
  var _html = '';
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return _html; },
    set: function (v) { _html = v; el._children = []; _text = ''; }
  });
  return el;
}

for (var i = 0; i < __htmlTags.length; i++) {
  var spec = __htmlTags[i];
  var el = makeEl(spec.id);
  for (var name in spec.attrs) {
    el._attrs[name] = spec.attrs[name];
  }
  el.className = spec.attrs['class'] || '';
  if (spec.attrs.title) { el.title = spec.attrs.title; }
  if (spec.id) { __els[spec.id] = el; }
  if (spec.attrs['data-i18n'] !== undefined || spec.attrs['data-i18n-title'] !== undefined) { __i18nEls.push(el); }
}

var __timers = [];
var __ready = null;
var __status = null;
var __locales = null;
var __navLanguages = ['en-US'];
var __uiInfo = { saved: '', messages: {} };
var __reapplyHint = { needed: false };
var __chosenFile = '';
var __report = null;
var __exportResult = null;
var __updateResult = null;
var __holdApply = false;
var __heldApply = null;
var __progressHandler = null;
var __calls = [];

function __callsOf(name) {
  return __calls.filter(function (c) { return c.name === name; });
}

var document = {
  title: '',
  body: makeEl('body'),
  documentElement: { lang: '', scrollHeight: 0, clientHeight: 0 },
  getElementById: function (id) {
    if (!__els[id]) { throw new Error('app.js asked for #' + id + ' which index.html does not define'); }
    return __els[id];
  },
  querySelector: function () { return makeEl('q'); },
  querySelectorAll: function (selector) {
    var attr = selector === '[data-i18n]' ? 'data-i18n' : (selector === '[data-i18n-title]' ? 'data-i18n-title' : '');
    if (!attr) { return []; }
    return __i18nEls.filter(function (e) { return e.getAttribute(attr) !== null; });
  },
  createElement: function (tag) { return makeEl('new-' + tag); },
  addEventListener: function () {}
};

var window = {
  document: document,
  addEventListener: function (type, fn) { if (type === 'DOMContentLoaded') { __ready = fn; } },
  runtime: {
    EventsOn: function (name, fn) { if (name === 'progress') { __progressHandler = fn; } },
    // The fallback path records that it was reached, so a test can assert the
    // button did something instead of silently ignoring the click.
    ClipboardSetText: function (text) {
      __clipboardCalls += 1;
      __clipboardText = text;
      return Promise.resolve(true);
    }
  }
};

// __navigatorClipboard lets a test remove navigator.clipboard, which is what an
// older WebView2 without a secure context looks like. The interface language
// comes from navigator.languages, which a test sets through __navLanguages.
var __navigatorClipboard = null;
var navigator = {};
Object.defineProperty(navigator, 'clipboard', {
  get: function () { return __navigatorClipboard; }
});
Object.defineProperty(navigator, 'languages', {
  get: function () { return __navLanguages; }
});
Object.defineProperty(navigator, 'language', {
  get: function () { return __navLanguages[0]; }
});

var __clipboardText = null;
var __clipboardCalls = 0;

// __clicked and __firedChipClick let a test dispatch the listener the script
// registered on a chip, which is the path a real click takes.
var __clicked = null;
function __firedChipClick(el) { if (el && el._click) { el._click(); } }

function setTimeout(fn, ms) { __timers.push(fn); return __timers.length; }
function clearTimeout() {}

function __record(name, args) { __calls.push({ name: name, args: Array.prototype.slice.call(args) }); }

var __App = {
  GetVersion: function () { __record('GetVersion', arguments); return Promise.resolve('1.2.3'); },
  GetStatus: function () { __record('GetStatus', arguments); return Promise.resolve(__status); },
  GetLocales: function () { __record('GetLocales', arguments); return Promise.resolve(__locales); },
  GetLogs: function () { return Promise.resolve([]); },
  GetUIInfo: function () { __record('GetUIInfo', arguments); return Promise.resolve(__uiInfo); },
  SetUILanguage: function (code) { __record('SetUILanguage', arguments); return Promise.resolve(); },
  GetReapplyHint: function () { __record('GetReapplyHint', arguments); return Promise.resolve(__reapplyHint); },
  ApplyLocale: function (code, confirmed) {
    __record('ApplyLocale', arguments);
    if (!confirmed) { return Promise.reject(new Error('confirmation required')); }
    if (__holdApply) { return new Promise(function (resolve) { __heldApply = resolve; }); }
    return Promise.resolve({ LocaleName: code, Relaunched: true });
  },
  ApplyLocaleFile: function (path, confirmed) {
    __record('ApplyLocaleFile', arguments);
    if (!confirmed) { return Promise.reject(new Error('confirmation required')); }
    return Promise.resolve({ LocaleName: 'From file', Relaunched: true });
  },
  Reapply: function (confirmed) {
    __record('Reapply', arguments);
    if (!confirmed) { return Promise.reject(new Error('confirmation required')); }
    return Promise.resolve({ LocaleName: 'Reapplied', Relaunched: true });
  },
  RestoreLocale: function (confirmed) {
    __record('RestoreLocale', arguments);
    if (!confirmed) { return Promise.reject(new Error('confirmation required')); }
    return Promise.resolve({});
  },
  LaunchAntigravity: function () { __record('LaunchAntigravity', arguments); return Promise.resolve(); },
  SelectAppDir: function (title) { __record('SelectAppDir', arguments); return Promise.resolve(''); },
  SetAppDir: function () { return Promise.resolve(__status); },
  ChooseLocaleFile: function (title) { __record('ChooseLocaleFile', arguments); return Promise.resolve(__chosenFile); },
  CheckLocaleFile: function (path) { __record('CheckLocaleFile', arguments); return Promise.resolve(__report); },
  ExportTemplate: function (from, title) { __record('ExportTemplate', arguments); return Promise.resolve(__exportResult); },
  UpdateTemplate: function (title) { __record('UpdateTemplate', arguments); return Promise.resolve(__updateResult); }
};

// Assigned rather than declared: "go" is a reserved word and cannot appear in a
// variable name.
window.go = { main: { App: __App } };
`

func readFrontend(t *testing.T, name string) string {
	t.Helper()
	data, err := os.ReadFile("frontend/dist/" + name)
	if err != nil {
		t.Fatalf("reading frontend/dist/%s: %v", name, err)
	}
	return string(data)
}

type htmlTag struct {
	ID    string            `json:"id"`
	Attrs map[string]string `json:"attrs"`
}

var (
	openTagPattern = regexp.MustCompile(`<[a-zA-Z][a-zA-Z0-9]*\b([^<>]*)>`)
	attrPattern    = regexp.MustCompile(`([\w-]+)="([^"]*)"`)
)

// htmlTags extracts every opening tag that has an id or a data-i18n attribute,
// so the stub only offers those elements and a reference to a missing one
// surfaces as an error.
func htmlTags(html string) []htmlTag {
	var tags []htmlTag
	for _, m := range openTagPattern.FindAllStringSubmatch(html, -1) {
		attrs := map[string]string{}
		for _, a := range attrPattern.FindAllStringSubmatch(m[1], -1) {
			attrs[a[1]] = a[2]
		}
		_, hasI18n := attrs["data-i18n"]
		_, hasI18nTitle := attrs["data-i18n-title"]
		if attrs["id"] == "" && !hasI18n && !hasI18nTitle {
			continue
		}
		tags = append(tags, htmlTag{ID: attrs["id"], Attrs: attrs})
	}
	return tags
}

// uiMessagesJSON reads the real interface files, so the tests render the same
// texts the backend hands to the window.
func uiMessagesJSON(t *testing.T) string {
	t.Helper()
	data, err := json.Marshal(readI18nFiles(t))
	if err != nil {
		t.Fatalf("encoding the interface messages: %v", err)
	}
	return string(data)
}

// chipCount reports how many chips the locale list currently holds. The element
// is cleared and refilled on every render, so its children are the live count.
func chipCount(t *testing.T, vm *goja.Runtime) int {
	t.Helper()
	v, err := vm.RunString("__els['localeChips']._children.length")
	if err != nil {
		t.Fatalf("counting chips: %v", err)
	}
	return int(v.ToInteger())
}

// clickChip dispatches the click listener app.js registered on the chip whose
// label matches, returning the primary button text afterwards.
func clickChip(t *testing.T, vm *goja.Runtime, label string) string {
	t.Helper()
	script := `
		(function () {
			var chips = __els['localeChips']._children;
			for (var i = 0; i < chips.length; i++) {
				// The label is followed by the coverage figure, so match on the prefix.
				if (chips[i].textContent.indexOf('` + label + `') === 0) { __clicked = chips[i]; return true; }
			}
			return false;
		})();
	`
	v, err := vm.RunString(script)
	if err != nil {
		t.Fatalf("looking up chip %q: %v", label, err)
	}
	if !v.ToBoolean() {
		t.Fatalf("no chip labelled %q", label)
	}
	if _, err := vm.RunString("__firedChipClick(__clicked);"); err != nil {
		t.Fatalf("clicking chip %q: %v", label, err)
	}
	return elementText(t, vm, "btnPrimaryAction")
}

// frontendConfig seeds the stub's data. Status and locales are JSON literals.
type frontendConfig struct {
	status    string
	locales   string
	languages []string // navigator.languages; nil means English
	saved     string   // the saved interface language
	setup     string   // extra JavaScript run after the stub, before app.js
}

func runFrontend(t *testing.T, statusJSON, localesJSON string) *goja.Runtime {
	t.Helper()
	return runFrontendWith(t, frontendConfig{status: statusJSON, locales: localesJSON})
}

func runFrontendWith(t *testing.T, cfg frontendConfig) *goja.Runtime {
	t.Helper()
	html := readFrontend(t, "index.html")
	appJS := readFrontend(t, "app.js")

	tagsJSON, err := json.Marshal(htmlTags(html))
	if err != nil {
		t.Fatalf("encoding the markup: %v", err)
	}
	languages := cfg.languages
	if languages == nil {
		languages = []string{"en-US"}
	}
	languagesJSON, _ := json.Marshal(languages)
	savedJSON, _ := json.Marshal(cfg.saved)

	vm := goja.New()
	// The tag list is defined first because the stub's element loop reads it.
	prelude := "var __htmlTags = " + string(tagsJSON) + ";\n" +
		domStub +
		"__status = " + cfg.status + ";\n" +
		"__locales = " + cfg.locales + ";\n" +
		"__navLanguages = " + string(languagesJSON) + ";\n" +
		"__uiInfo = { saved: " + string(savedJSON) + ", messages: " + uiMessagesJSON(t) + " };\n" +
		cfg.setup + "\n"

	if _, err := vm.RunString(prelude); err != nil {
		t.Fatalf("DOM stub failed: %v", err)
	}
	if _, err := vm.RunString(appJS); err != nil {
		t.Fatalf("app.js threw while loading, so the page would show only its markup: %v", err)
	}
	return vm
}

// fireReady runs the DOMContentLoaded handler and the timers it schedules, so
// the same initialization path a real window takes is exercised here.
func fireReady(t *testing.T, vm *goja.Runtime) {
	t.Helper()
	if _, err := vm.RunString(`if (!__ready) { throw new Error('app.js never registered DOMContentLoaded'); } __ready();`); err != nil {
		t.Fatalf("DOMContentLoaded handler threw: %v", err)
	}
	// Drain the deferred initialization, then let promise jobs settle.
	for i := 0; i < 5; i++ {
		if _, err := vm.RunString(`
			var pending = __timers; __timers = [];
			for (var i = 0; i < pending.length; i++) { pending[i](); }
		`); err != nil {
			t.Fatalf("deferred initialization threw: %v", err)
		}
	}
}

// drainPromises lets queued microtasks run, so a .then handler registered by a
// click has finished before the test reads the DOM.
func drainPromises(t *testing.T, vm *goja.Runtime) {
	t.Helper()
	for i := 0; i < 8; i++ {
		if _, err := vm.RunString(`void 0`); err != nil {
			t.Fatalf("draining promises: %v", err)
		}
	}
}

func evalJS(t *testing.T, vm *goja.Runtime, script string) goja.Value {
	t.Helper()
	v, err := vm.RunString(script)
	if err != nil {
		t.Fatalf("running %q: %v", script, err)
	}
	return v
}

func elementText(t *testing.T, vm *goja.Runtime, id string) string {
	t.Helper()
	return evalJS(t, vm, `__els['`+id+`'] ? __els['`+id+`'].textContent : '<missing>'`).String()
}

func hasClass(t *testing.T, vm *goja.Runtime, id, class string) bool {
	t.Helper()
	return evalJS(t, vm, `__els['`+id+`'].classList.contains('`+class+`')`).ToBoolean()
}

func childCount(t *testing.T, vm *goja.Runtime, id string) int {
	t.Helper()
	return int(evalJS(t, vm, `__els['`+id+`']._children.length`).ToInteger())
}

func callCount(t *testing.T, vm *goja.Runtime, name string) int {
	t.Helper()
	return int(evalJS(t, vm, `__callsOf('`+name+`').length`).ToInteger())
}

// clickEl dispatches the click listener registered on an element and lets the
// promises it started settle.
func clickEl(t *testing.T, vm *goja.Runtime, id string) {
	t.Helper()
	evalJS(t, vm, `
		if (!__els['`+id+`']._click) { throw new Error('#`+id+` has no click listener'); }
		__els['`+id+`']._click();
	`)
	drainPromises(t, vm)
}

// confirmDialog accepts the open confirmation modal, as a click on its button
// would.
func confirmDialog(t *testing.T, vm *goja.Runtime) {
	t.Helper()
	if hasClass(t, vm, "applyConfirmModal", "hidden") {
		t.Fatal("expected the confirmation dialog to be open")
	}
	evalJS(t, vm, `__els['btnConfirmApply'].onclick()`)
	drainPromises(t, vm)
}

func selectValue(t *testing.T, vm *goja.Runtime, id, value string) {
	t.Helper()
	evalJS(t, vm, fmt.Sprintf(`__els['%s'].value = %q; __els['%s']._listeners.change();`, id, value, id))
	drainPromises(t, vm)
}

func optionTexts(t *testing.T, vm *goja.Runtime, id string) []string {
	t.Helper()
	raw := evalJS(t, vm, `JSON.stringify(__els['`+id+`']._children.map(function (c) { return c.value + '=' + c.textContent; }))`).String()
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("decoding the options of #%s: %v", id, err)
	}
	return out
}

// uiText is what a language file says for an id.
func uiText(t *testing.T, code, id string) string {
	t.Helper()
	text := readI18nFiles(t)[code][id]
	if text == "" {
		t.Fatalf("%s.json has no text for %q", code, id)
	}
	return text
}

const testStatusPatched = `{
  "AppDir": "C:\\Antigravity",
  "CurrentLanguage": "zh-CN",
  "LocaleName": "简体中文",
  "AppVersion": "2.23.0",
  "HasCleanBackup": true,
  "CleanBackupStatus": "valid",
  "StateIsStale": false
}`

const testStatusUnpatched = `{
  "AppDir": "C:\\Antigravity",
  "CurrentLanguage": "en",
  "LocaleName": "",
  "AppVersion": "2.23.0",
  "HasCleanBackup": true,
  "CleanBackupStatus": "valid",
  "StateIsStale": false
}`

const testLocales = `[
  {"code":"en","name":"English","englishName":"English","translations":0,"coverage":100},
  {"code":"ja","name":"日本語","englishName":"Japanese","translations":644,"coverage":26},
  {"code":"zh-CN","name":"简体中文","englishName":"Simplified Chinese","translations":2406,"coverage":100}
]`

// A patched install has to name the language it is currently showing, and the
// button has to describe the selection rather than a fixed word.
func TestFrontendRendersStatusAndLocales(t *testing.T) {
	vm := runFrontend(t, testStatusPatched, testLocales)
	fireReady(t, vm)

	if got := elementText(t, vm, "statusLabel"); !strings.Contains(got, "zh-CN") {
		t.Errorf("status label did not report the installed language: %q", got)
	}
	if got := elementText(t, vm, "appPathDisplay"); !strings.Contains(got, "Antigravity") {
		t.Errorf("install path was not rendered: %q", got)
	}
	if got := elementText(t, vm, "appVersion"); !strings.Contains(got, "2.23.0") {
		t.Errorf("the Antigravity version was not rendered: %q", got)
	}

	// Every locale becomes a chip, including English.
	if n := chipCount(t, vm); n != 3 {
		t.Errorf("expected one chip per locale (3), got %d", n)
	}
	// Before any selection changes, the button names what is installed.
	if got := elementText(t, vm, "btnPrimaryAction"); !strings.Contains(got, "简体中文") {
		t.Errorf("primary button should name the selected locale, got %q", got)
	}
}

// Choosing another language has to move the button off the installed one, or it
// keeps advertising a language the click will not install.
func TestFrontendPrimaryButtonFollowsSelection(t *testing.T) {
	vm := runFrontend(t, testStatusPatched, testLocales)
	fireReady(t, vm)

	if got := clickChip(t, vm, "日本語"); !strings.Contains(got, "日本語") {
		t.Errorf("after choosing Japanese the button should name it, got %q", got)
	}
	// English is not a pack, so picking it while localized means restoring.
	if got := clickChip(t, vm, "English"); !strings.Contains(got, "English") {
		t.Errorf("choosing English should name it, got %q", got)
	}
}

// An unpatched install has nothing to re-apply, so it must offer to apply.
func TestFrontendOffersApplyWhenUnpatched(t *testing.T) {
	vm := runFrontend(t, testStatusUnpatched, testLocales)
	fireReady(t, vm)

	got := elementText(t, vm, "btnPrimaryAction")
	if !strings.Contains(got, "Apply") {
		t.Errorf("an unpatched install should offer to apply, got %q", got)
	}
	if got := elementText(t, vm, "statusLabel"); !strings.Contains(got, "English") {
		t.Errorf("the status should read as English, got %q", got)
	}
}

// The version badge has to come from the backend. A number baked into the
// markup would keep showing a release that no longer matches the binary.
func TestFrontendVersionBadgeComesFromBackend(t *testing.T) {
	vm := runFrontend(t, testStatusPatched, testLocales)
	fireReady(t, vm)

	got := elementText(t, vm, "appVersionBadge")
	if !strings.Contains(got, "1.2.3") {
		t.Errorf("the badge should show the version reported by the backend, got %q", got)
	}
}

// With navigator.clipboard missing the copy button used to do nothing at all,
// which reads as a broken control. It now falls back to the Wails runtime call.
func TestFrontendCopyLogsFallsBackToRuntime(t *testing.T) {
	vm := runFrontend(t, testStatusPatched, testLocales)
	fireReady(t, vm)

	evalJS(t, vm, `
		__navigatorClipboard = null;
		__clipboardCalls = 0;
		__els['btnCopyLogs']._click();
	`)
	drainPromises(t, vm)

	if n := evalJS(t, vm, `__clipboardCalls`).ToInteger(); n != 1 {
		t.Fatalf("the runtime clipboard was called %d times, want 1", n)
	}
	if got := elementText(t, vm, "msgTitle"); !strings.Contains(got, "Copied") {
		t.Errorf("the user was not told the copy succeeded, got %q", got)
	}
}

// uiLanguageOf reports which language the window rendered in, through the
// document language and the About button, which every language words differently.
func uiLanguageOf(t *testing.T, vm *goja.Runtime) (lang, about string) {
	t.Helper()
	return evalJS(t, vm, `document.documentElement.lang`).String(), elementText(t, vm, "btnAbout")
}

// The window language follows the saved choice, then the system, then English.
func TestFrontendPicksTheInterfaceLanguage(t *testing.T) {
	cases := []struct {
		name      string
		languages []string
		saved     string
		want      string
	}{
		{"Taiwan Chinese", []string{"zh-TW"}, "", "zh-TW"},
		{"Traditional script", []string{"zh-Hant-TW"}, "", "zh-TW"},
		{"Hong Kong", []string{"zh-HK"}, "", "zh-TW"},
		{"Macau", []string{"zh-MO"}, "", "zh-TW"},
		{"case-insensitive exact match", []string{"ZH-tw"}, "", "zh-TW"},
		{"Simplified script", []string{"zh-Hans-CN"}, "", "zh-CN"},
		{"mainland Chinese", []string{"zh-CN"}, "", "zh-CN"},
		{"bare Chinese", []string{"zh"}, "", "zh-CN"},
		{"Singapore", []string{"zh-SG"}, "", "zh-CN"},
		{"no matching language", []string{"fr-FR"}, "", "en"},
		{"primary subtag", []string{"en-GB"}, "", "en"},
		{"first supported preference wins", []string{"fr-FR", "zh-TW"}, "", "zh-TW"},
		{"no system language", []string{}, "", "en"},
		{"saved choice beats the system", []string{"zh-TW"}, "zh-CN", "zh-CN"},
		{"saved English beats the system", []string{"zh-TW"}, "en", "en"},
		{"unknown saved language is ignored", []string{"zh-CN"}, "xx", "zh-CN"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			vm := runFrontendWith(t, frontendConfig{
				status: testStatusPatched, locales: testLocales,
				languages: tc.languages, saved: tc.saved,
			})
			fireReady(t, vm)

			lang, about := uiLanguageOf(t, vm)
			if lang != tc.want {
				t.Errorf("document language = %q, want %q", lang, tc.want)
			}
			if want := uiText(t, tc.want, "header.about"); about != want {
				t.Errorf("the About button reads %q, want %q (%s)", about, want, tc.want)
			}
		})
	}
}

// The three bundled languages really are different, or the test above could
// pass on three copies of English.
func TestFrontendLanguagesDiffer(t *testing.T) {
	en := uiText(t, "en", "header.about")
	tw := uiText(t, "zh-TW", "header.about")
	cn := uiText(t, "zh-CN", "header.about")
	if en == tw || en == cn {
		t.Errorf("the Chinese files must not repeat the English text: %q %q %q", en, tw, cn)
	}
	if !strings.Contains(uiText(t, "zh-TW", "btn.apply"), "套用") {
		t.Errorf("zh-TW should use the Taiwan wording 套用")
	}
}

// The header select offers Follow system, then each language by its own name,
// and a change is remembered and shown at once.
func TestFrontendLanguageSelectSwitchesTheWindow(t *testing.T) {
	vm := runFrontendWith(t, frontendConfig{
		status: testStatusPatched, locales: testLocales, languages: []string{"en-US"},
	})
	fireReady(t, vm)

	options := optionTexts(t, vm, "uiLanguageSelect")
	want := []string{
		"=" + uiText(t, "en", "language.system"),
		"en=English",
		"zh-CN=简体中文",
		"zh-TW=繁體中文（台灣）",
	}
	if strings.Join(options, "|") != strings.Join(want, "|") {
		t.Fatalf("language options = %v, want %v", options, want)
	}
	if v := evalJS(t, vm, `__els['uiLanguageSelect'].value`).String(); v != "" {
		t.Errorf("with nothing saved the select should read Follow system, got %q", v)
	}

	selectValue(t, vm, "uiLanguageSelect", "zh-TW")

	if got := evalJS(t, vm, `JSON.stringify(__callsOf('SetUILanguage').map(function (c) { return c.args; }))`).String(); got != `[["zh-TW"]]` {
		t.Errorf("SetUILanguage calls = %s", got)
	}
	lang, about := uiLanguageOf(t, vm)
	if lang != "zh-TW" || about != uiText(t, "zh-TW", "header.about") {
		t.Errorf("the static texts did not switch: lang %q, about %q", lang, about)
	}
	// Dynamic texts are rendered from stored state, so they switch too.
	wantStatus := strings.Replace(uiText(t, "zh-TW", "status.localized"), "{code}", "zh-CN", 1)
	if got := elementText(t, vm, "statusLabel"); got != wantStatus {
		t.Errorf("the status label did not switch: %q, want %q", got, wantStatus)
	}
	if got := elementText(t, vm, "btnSecondaryAction"); got != uiText(t, "zh-TW", "btn.openApp") {
		t.Errorf("the open button did not switch: %q", got)
	}
	// The language names themselves are not translated.
	if got := optionTexts(t, vm, "uiLanguageSelect"); got[0] != "="+uiText(t, "zh-TW", "language.system") || got[1] != "en=English" {
		t.Errorf("options after switching = %v", got)
	}
	if v := evalJS(t, vm, `__els['uiLanguageSelect'].value`).String(); v != "zh-TW" {
		t.Errorf("the select should keep the chosen language, got %q", v)
	}

	// Follow system goes back to what the system says and clears the setting.
	selectValue(t, vm, "uiLanguageSelect", "")
	if got := evalJS(t, vm, `JSON.stringify(__callsOf('SetUILanguage').map(function (c) { return c.args; }))`).String(); got != `[["zh-TW"],[""]]` {
		t.Errorf("SetUILanguage calls = %s", got)
	}
	if lang, _ := uiLanguageOf(t, vm); lang != "en" {
		t.Errorf("following the system should return to English, got %q", lang)
	}
}

// The fallback selection for an unpatched install is Taiwan Chinese.
func TestFrontendDefaultSelectionIsTaiwanChinese(t *testing.T) {
	vm := runFrontend(t, testStatusUnpatched, `[
	  {"code":"en","name":"English","englishName":"English","translations":0,"coverage":100},
	  {"code":"zh-CN","name":"简体中文","englishName":"Simplified Chinese","translations":2406,"coverage":100},
	  {"code":"zh-TW","name":"繁體中文","englishName":"Traditional Chinese","translations":2406,"coverage":100}
	]`)
	fireReady(t, vm)

	if got := elementText(t, vm, "btnPrimaryAction"); !strings.Contains(got, "繁體中文") {
		t.Errorf("the default selection should be zh-TW, got %q", got)
	}
	clickEl(t, vm, "btnPrimaryAction")
	confirmDialog(t, vm)
	if got := evalJS(t, vm, `JSON.stringify(__callsOf('ApplyLocale').map(function (c) { return c.args; }))`).String(); got != `[["zh-TW",true]]` {
		t.Errorf("ApplyLocale calls = %s", got)
	}
}

const testReportWithErrors = `{
  "path": "C:\\lang\\fr.json", "language": "fr", "name": "Français", "ok": false,
  "issues": [
    {"severity":"warning","code":"empty","section":"file","key":"","line":0,"want":0,"got":0,"missing":null,"extra":null,"message":"nothing is translated yet"},
    {"severity":"error","code":"markers","section":"text","key":"Open <>file<>","line":12,"want":2,"got":1,"missing":null,"extra":null,"message":"marker count differs"},
    {"severity":"error","code":"placeholders","section":"menu","key":"{1} items","line":30,"want":0,"got":0,"missing":["{1}"],"extra":["{2}"],"message":"placeholder mismatch"},
    {"severity":"error","code":"meta","section":"language","key":"","line":2,"want":0,"got":0,"missing":null,"extra":null,"message":"language must look like fr-FR"}
  ],
  "progress": {
    "sections": [
      {"section":"text","done":10,"total":100},
      {"section":"valueRules.plural","done":0,"total":3}
    ],
    "done": 10, "total": 103, "percent": 10
  },
  "missingKeys": 7, "unknownKeys": 0
}`

const testReportOK = `{
  "path": "C:\\lang\\de.json", "language": "de", "name": "Deutsch", "ok": true,
  "issues": [],
  "progress": {"sections":[{"section":"text","done":100,"total":100}],"done":100,"total":100,"percent":100},
  "missingKeys": 0, "unknownKeys": 0
}`

func loadReport(t *testing.T, vm *goja.Runtime, path string) {
	t.Helper()
	evalJS(t, vm, fmt.Sprintf(`__chosenFile = %q;`, path))
	clickEl(t, vm, "btnLoadFile")
}

// A file with errors lists them, says what each means and offers no apply.
func TestFrontendReportWithErrorsListsIssuesAndBlocksApply(t *testing.T) {
	vm := runFrontendWith(t, frontendConfig{
		status: testStatusUnpatched, locales: testLocales,
		setup: `__report = ` + testReportWithErrors + `;`,
	})
	fireReady(t, vm)

	if !hasClass(t, vm, "reportPanel", "hidden") {
		t.Fatal("the report must stay hidden until a file is loaded")
	}
	loadReport(t, vm, `C:\lang\fr.json`)

	if got := evalJS(t, vm, `JSON.stringify(__callsOf('CheckLocaleFile').map(function (c) { return c.args; }))`).String(); got != `[["C:\\lang\\fr.json"]]` {
		t.Errorf("CheckLocaleFile calls = %s", got)
	}
	if hasClass(t, vm, "reportPanel", "hidden") {
		t.Fatal("the report was not shown")
	}
	if got := elementText(t, vm, "reportTitle"); got != "Français (fr)" {
		t.Errorf("report title = %q", got)
	}
	if got := elementText(t, vm, "reportPercent"); !strings.Contains(got, "10%") || !strings.Contains(got, "10 of 103") {
		t.Errorf("progress text = %q", got)
	}
	if got := evalJS(t, vm, `__els['reportBarFill'].style.width`).String(); got != "10%" {
		t.Errorf("progress bar width = %q", got)
	}
	if n := childCount(t, vm, "reportSections"); n != 2 {
		t.Errorf("expected 2 section rows, got %d", n)
	}
	sections := elementText(t, vm, "reportSections")
	for _, want := range []string{"Text", "Value rule plural", "10 / 100"} {
		if !strings.Contains(sections, want) {
			t.Errorf("section rows lack %q: %q", want, sections)
		}
	}

	if n := childCount(t, vm, "reportIssues"); n != 4 {
		t.Fatalf("expected 4 issue lines, got %d", n)
	}
	issues := elementText(t, vm, "reportIssues")
	for _, want := range []string{
		"line 12", "Text", "Open <>file<>", // markers: location
		"expected 2, found 1",  // markers: want/got
		"line 30", "{1} items", // placeholders: location
		"missing {1}", "unexpected {2}", // placeholders: missing/extra
		"language must look like fr-FR",                    // meta: the English detail
		"The language code or name at the top of the file", // meta: the translation
		"Error", "Warning", "nothing is translated yet",
	} {
		if !strings.Contains(issues, want) {
			t.Errorf("issue list lacks %q:\n%s", want, issues)
		}
	}
	// Errors are shown before warnings, and styled differently.
	first := evalJS(t, vm, `__els['reportIssues']._children[0].className`).String()
	last := evalJS(t, vm, `__els['reportIssues']._children[3].className`).String()
	if !strings.Contains(first, "error") || !strings.Contains(last, "warning") {
		t.Errorf("issue classes: first %q, last %q", first, last)
	}

	if hasClass(t, vm, "reportMissingHint", "hidden") || !strings.Contains(elementText(t, vm, "reportMissingHint"), "7") {
		t.Errorf("the missing-entries hint was not shown: %q", elementText(t, vm, "reportMissingHint"))
	}
	if !hasClass(t, vm, "btnApplyFile", "hidden") {
		t.Error("a file with errors must not offer Apply")
	}
	if hasClass(t, vm, "reportBlocked", "hidden") {
		t.Error("the user should be told the errors must be fixed first")
	}
	if n := callCount(t, vm, "ApplyLocaleFile"); n != 0 {
		t.Errorf("ApplyLocaleFile was called %d times for a file with errors", n)
	}
}

// Only the first 50 issues are listed, with the rest counted, and a long key is
// shortened.
func TestFrontendReportCapsTheIssueList(t *testing.T) {
	vm := runFrontendWith(t, frontendConfig{
		status: testStatusUnpatched, locales: testLocales,
		setup: `
			var issues = [];
			for (var i = 1; i <= 60; i++) {
				issues.push({severity: 'error', code: 'markers', section: 'text',
					key: new Array(101).join('k'), line: i, want: 1, got: 0, message: 'm'});
			}
			__report = {path: 'C:\\a.json', language: 'xx', name: 'X', ok: false, issues: issues,
				progress: {sections: [], done: 0, total: 5, percent: 0}, missingKeys: 0, unknownKeys: 0};
		`,
	})
	fireReady(t, vm)
	loadReport(t, vm, `C:\a.json`)

	if n := childCount(t, vm, "reportIssues"); n != 51 {
		t.Fatalf("expected 50 issues plus the remainder line, got %d", n)
	}
	if got := evalJS(t, vm, `__els['reportIssues']._children[50].textContent`).String(); got != "and 10 more" {
		t.Errorf("remainder line = %q", got)
	}
	if got := evalJS(t, vm, `__els['reportIssues']._children[0].textContent`).String(); strings.Contains(got, strings.Repeat("k", 100)) || !strings.Contains(got, "…") {
		t.Errorf("a 100-character key should be truncated: %q", got)
	}
}

// A clean file offers Apply, which asks first and then applies the file.
func TestFrontendReportOKAppliesTheFileAfterConfirmation(t *testing.T) {
	vm := runFrontendWith(t, frontendConfig{
		status: testStatusUnpatched, locales: testLocales,
		setup: `__report = ` + testReportOK + `;`,
	})
	fireReady(t, vm)
	loadReport(t, vm, `C:\lang\de.json`)

	if hasClass(t, vm, "btnApplyFile", "hidden") {
		t.Fatal("a clean file should offer Apply")
	}
	if !hasClass(t, vm, "reportBlocked", "hidden") {
		t.Error("a clean file should not say errors must be fixed")
	}
	if got := elementText(t, vm, "reportIssuesTitle"); got != uiText(t, "en", "report.noIssues") {
		t.Errorf("issues title = %q", got)
	}

	statusCalls := callCount(t, vm, "GetStatus")
	clickEl(t, vm, "btnApplyFile")
	if n := callCount(t, vm, "ApplyLocaleFile"); n != 0 {
		t.Fatalf("the file was applied without asking: %d calls", n)
	}
	if got := elementText(t, vm, "applyConfirmTitle"); !strings.Contains(got, "Deutsch") {
		t.Errorf("the confirmation should name the file's language: %q", got)
	}
	confirmDialog(t, vm)

	if got := evalJS(t, vm, `JSON.stringify(__callsOf('ApplyLocaleFile').map(function (c) { return c.args; }))`).String(); got != `[["C:\\lang\\de.json",true]]` {
		t.Errorf("ApplyLocaleFile calls = %s", got)
	}
	if got := elementText(t, vm, "msgTitle"); got != uiText(t, "en", "msg.appliedTitle") {
		t.Errorf("the result was not reported: %q", got)
	}
	if callCount(t, vm, "GetStatus") <= statusCalls {
		t.Error("the status was not refreshed after applying the file")
	}
}

// The report is rendered from stored state, so changing language translates it.
func TestFrontendReportFollowsTheInterfaceLanguage(t *testing.T) {
	vm := runFrontendWith(t, frontendConfig{
		status: testStatusUnpatched, locales: testLocales, languages: []string{"zh-TW"},
		setup: `__report = ` + testReportWithErrors + `;`,
	})
	fireReady(t, vm)
	loadReport(t, vm, `C:\lang\fr.json`)

	issues := elementText(t, vm, "reportIssues")
	if !strings.Contains(issues, "第 12 行") {
		t.Errorf("the issue location was not translated: %s", issues)
	}
	selectValue(t, vm, "uiLanguageSelect", "en")
	if issues := elementText(t, vm, "reportIssues"); !strings.Contains(issues, "line 12") {
		t.Errorf("the report did not re-render in English: %s", issues)
	}
}

// Cancelling a dialog changes nothing and leaves the buttons usable.
func TestFrontendCancelledDialogsAreQuiet(t *testing.T) {
	vm := runFrontend(t, testStatusUnpatched, testLocales)
	fireReady(t, vm)

	loadReport(t, vm, "")
	if !hasClass(t, vm, "reportPanel", "hidden") {
		t.Error("a cancelled open dialog must not show a report")
	}
	clickEl(t, vm, "btnExportTemplate")
	if !hasClass(t, vm, "exportResult", "hidden") {
		t.Error("a cancelled save dialog must not show a result")
	}
	clickEl(t, vm, "btnUpdateTemplate")
	if !hasClass(t, vm, "updateResult", "hidden") {
		t.Error("a cancelled update must not show a result")
	}
	if evalJS(t, vm, `__els['btnExportTemplate'].disabled || __els['btnLoadFile'].disabled || __els['btnUpdateTemplate'].disabled`).ToBoolean() {
		t.Error("the buttons stayed disabled after the dialogs closed")
	}
	if !hasClass(t, vm, "msgModal", "hidden") {
		t.Errorf("a cancelled dialog should not raise a message: %q", elementText(t, vm, "msgBody"))
	}
}

func TestFrontendExportTemplate(t *testing.T) {
	vm := runFrontendWith(t, frontendConfig{
		status: testStatusUnpatched, locales: testLocales,
		setup: `__exportResult = {path: 'C:\\out\\ja.json', from: 'ja', entries: 321};`,
	})
	fireReady(t, vm)

	// Blank, then every bundled locale except English.
	want := []string{"=Blank template", "ja=Prefill from 日本語", "zh-CN=Prefill from 简体中文"}
	if got := optionTexts(t, vm, "exportFromSelect"); strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("export options = %v, want %v", got, want)
	}

	evalJS(t, vm, `__els['exportFromSelect'].value = 'ja';`)
	clickEl(t, vm, "btnExportTemplate")

	if got := evalJS(t, vm, `JSON.stringify(__callsOf('ExportTemplate').map(function (c) { return c.args; }))`).String(); got != `[["ja","`+uiText(t, "en", "dialog.exportTitle")+`"]]` {
		t.Errorf("ExportTemplate calls = %s", got)
	}
	if hasClass(t, vm, "exportResult", "hidden") {
		t.Fatal("the export result was not shown")
	}
	got := elementText(t, vm, "exportResult")
	if !strings.Contains(got, `C:\out\ja.json`) || !strings.Contains(got, "321") {
		t.Errorf("the result should say where the file went and how many entries: %q", got)
	}
}

func TestFrontendUpdateTemplate(t *testing.T) {
	vm := runFrontendWith(t, frontendConfig{
		status: testStatusUnpatched, locales: testLocales, languages: []string{"en-US"},
		setup: `__updateResult = {
			path: 'C:\\lang\\fr.json', backupPath: 'C:\\lang\\fr.json.bak',
			added: {text: 5, menu: 2}, addedTotal: 7, obsolete: {patterns: 1},
			progress: {sections: [], done: 50, total: 100, percent: 50}
		};`,
	})
	fireReady(t, vm)
	clickEl(t, vm, "btnUpdateTemplate")

	if got := evalJS(t, vm, `__callsOf('UpdateTemplate')[0].args[0]`).String(); got != uiText(t, "en", "dialog.updateTitle") {
		t.Errorf("the dialog title was not the translated one: %q", got)
	}
	got := elementText(t, vm, "updateResult")
	for _, want := range []string{"Added 7 new entries", "Text 5", "Menus 2", `C:\lang\fr.json.bak`, "Patterns 1", "50%"} {
		if !strings.Contains(got, want) {
			t.Errorf("the update summary lacks %q:\n%s", want, got)
		}
	}
}

// The reminder appears only when the backend says an update removed the
// language, and reapplying asks first.
func TestFrontendReapplyBanner(t *testing.T) {
	t.Run("hidden when nothing is needed", func(t *testing.T) {
		vm := runFrontend(t, testStatusUnpatched, testLocales)
		fireReady(t, vm)
		if !hasClass(t, vm, "reapplyBanner", "hidden") {
			t.Error("the banner must stay hidden when no reapply is needed")
		}
		if callCount(t, vm, "GetReapplyHint") != 1 {
			t.Error("the hint should be requested once after the status loads")
		}
	})

	t.Run("shown and reapplies after confirmation", func(t *testing.T) {
		vm := runFrontendWith(t, frontendConfig{
			status: testStatusUnpatched, locales: testLocales,
			setup: `__reapplyHint = {needed: true, locale: 'zh-TW', localeFile: '', name: '繁體中文', fileMissing: false, appVersion: '2.24.0'};`,
		})
		fireReady(t, vm)

		if hasClass(t, vm, "reapplyBanner", "hidden") {
			t.Fatal("the banner was not shown")
		}
		text := elementText(t, vm, "reapplyText")
		if !strings.Contains(text, "v2.24.0") || !strings.Contains(text, "繁體中文") || !strings.Contains(text, "official English") {
			t.Errorf("banner text = %q", text)
		}
		if hasClass(t, vm, "btnReapply", "hidden") || !hasClass(t, vm, "btnReapplyLoad", "hidden") {
			t.Error("a present file should offer Reapply, not Load")
		}

		clickEl(t, vm, "btnReapply")
		if callCount(t, vm, "Reapply") != 0 {
			t.Fatal("Reapply ran without confirmation")
		}
		confirmDialog(t, vm)
		if got := evalJS(t, vm, `JSON.stringify(__callsOf('Reapply').map(function (c) { return c.args; }))`).String(); got != `[[true]]` {
			t.Errorf("Reapply calls = %s", got)
		}
		if !hasClass(t, vm, "reapplyBanner", "hidden") {
			t.Error("the banner should disappear after a successful reapply")
		}
	})

	t.Run("missing file offers to load one", func(t *testing.T) {
		vm := runFrontendWith(t, frontendConfig{
			status: testStatusUnpatched, locales: testLocales,
			setup: `__reapplyHint = {needed: true, locale: 'xx', localeFile: 'C:\\gone\\xx.json', name: 'xx.json', fileMissing: true, appVersion: '2.24.0'};`,
		})
		fireReady(t, vm)

		text := elementText(t, vm, "reapplyText")
		if !strings.Contains(text, `C:\gone\xx.json`) || !strings.Contains(text, "missing") {
			t.Errorf("the banner should name the missing file: %q", text)
		}
		if !hasClass(t, vm, "btnReapply", "hidden") || hasClass(t, vm, "btnReapplyLoad", "hidden") {
			t.Error("a missing file should offer Load, not Reapply")
		}
		evalJS(t, vm, `__chosenFile = ''`)
		clickEl(t, vm, "btnReapplyLoad")
		if callCount(t, vm, "ChooseLocaleFile") != 1 {
			t.Error("Load language file did not open the file picker")
		}
	})

	t.Run("not now hides it", func(t *testing.T) {
		vm := runFrontendWith(t, frontendConfig{
			status: testStatusUnpatched, locales: testLocales,
			setup: `__reapplyHint = {needed: true, locale: 'zh-TW', name: 'T', appVersion: ''};`,
		})
		fireReady(t, vm)
		if text := elementText(t, vm, "reapplyText"); strings.Contains(text, "v{") || strings.Contains(text, "to v") {
			t.Errorf("without a version the text must not mention one: %q", text)
		}
		clickEl(t, vm, "btnReapplyDismiss")
		if !hasClass(t, vm, "reapplyBanner", "hidden") {
			t.Error("Not now should hide the banner")
		}
		if callCount(t, vm, "Reapply") != 0 {
			t.Error("Not now must not reapply")
		}
	})
}

// Progress stages arrive in English from Go and are translated by id, falling
// back to the English sentence for a stage nobody has translated yet. While an
// operation runs the buttons are disabled.
func TestFrontendTranslatesProgressStagesAndLocksButtons(t *testing.T) {
	vm := runFrontendWith(t, frontendConfig{
		status: testStatusUnpatched, locales: testLocales, languages: []string{"zh-TW"},
		setup: `__holdApply = true;`,
	})
	fireReady(t, vm)

	clickEl(t, vm, "btnPrimaryAction")
	confirmDialog(t, vm)

	for _, id := range []string{"btnPrimaryAction", "btnChangePath", "btnExportTemplate", "btnLoadFile", "btnUpdateTemplate"} {
		if !evalJS(t, vm, `__els['`+id+`'].disabled`).ToBoolean() {
			t.Errorf("#%s should be disabled while an operation runs", id)
		}
	}
	if hasClass(t, vm, "progressBox", "hidden") {
		t.Fatal("the progress box was not shown")
	}

	evalJS(t, vm, `__progressHandler({stage: 'Writing app.asar', detail: 'C:\\x\\app.asar'})`)
	if got := elementText(t, vm, "progressStage"); got != uiText(t, "zh-TW", "progress.Writing app.asar") {
		t.Errorf("a known stage should be translated: %q", got)
	}
	if got := elementText(t, vm, "progressDetail"); got != `C:\x\app.asar` {
		t.Errorf("the detail should pass through: %q", got)
	}
	evalJS(t, vm, `__progressHandler({stage: 'A stage added next year'})`)
	if got := elementText(t, vm, "progressStage"); got != "A stage added next year" {
		t.Errorf("an unknown stage should show its English text: %q", got)
	}

	evalJS(t, vm, `__heldApply({LocaleName: 'x', Relaunched: true})`)
	drainPromises(t, vm)
	if evalJS(t, vm, `__els['btnPrimaryAction'].disabled`).ToBoolean() {
		t.Error("the buttons should unlock when the operation ends")
	}
}

// The saved settings file is where Go keeps these, so make sure every language
// directory entry the tests rely on is also reachable by the backend loader.
func TestFrontendMarkupIsTranslatable(t *testing.T) {
	html := readFrontend(t, "index.html")
	if !strings.Contains(html, `id="uiLanguageSelect"`) {
		t.Error("index.html needs the interface language select")
	}
	// Chinese text baked into the markup would never change language.
	if regexp.MustCompile(`[\p{Han}]`).MatchString(html) {
		t.Error("index.html contains hard-coded Chinese; it belongs in frontend/dist/i18n")
	}
	if regexp.MustCompile(`[\p{Han}]`).MatchString(readFrontend(t, "app.js")) {
		t.Error("app.js contains hard-coded Chinese; it belongs in frontend/dist/i18n")
	}
	if _, err := os.Stat(filepath.Join("frontend", "dist", "i18n", "en.json")); err != nil {
		t.Errorf("en.json is missing: %v", err)
	}
}
