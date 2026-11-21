package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// The window's texts live in frontend/dist/i18n/<code>.json. These tests keep
// the files complete and consistent, and keep the markup and script from asking
// for an id that no file defines, which would show the raw id to the user.

const i18nDir = "frontend/dist/i18n"

// readI18nFiles loads every language file from disk, keyed by code.
func readI18nFiles(t *testing.T) map[string]map[string]string {
	t.Helper()
	entries, err := os.ReadDir(i18nDir)
	if err != nil {
		t.Fatalf("reading %s: %v", i18nDir, err)
	}
	out := map[string]map[string]string{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(i18nDir, e.Name()))
		if err != nil {
			t.Fatalf("reading %s: %v", e.Name(), err)
		}
		var messages map[string]string
		if err := json.Unmarshal(data, &messages); err != nil {
			t.Fatalf("%s is not a valid flat JSON object of strings: %v", e.Name(), err)
		}
		out[strings.TrimSuffix(e.Name(), ".json")] = messages
	}
	if _, ok := out["en"]; !ok {
		t.Fatal("en.json is missing")
	}
	return out
}

func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

var placeholderPattern = regexp.MustCompile(`\{(\w+)\}`)

func placeholdersOf(text string) string {
	found := placeholderPattern.FindAllString(text, -1)
	sort.Strings(found)
	return strings.Join(found, ",")
}

func TestUIMessageFilesShareTheEnglishKeys(t *testing.T) {
	files := readI18nFiles(t)
	english := files["en"]

	for _, code := range []string{"en", "zh-TW", "zh-CN"} {
		if _, ok := files[code]; !ok {
			t.Errorf("the %s interface language is missing", code)
		}
	}

	for code, messages := range files {
		if code == "en" {
			continue
		}
		for _, key := range sortedKeys(english) {
			if _, ok := messages[key]; !ok {
				t.Errorf("%s.json lacks %q", code, key)
			}
		}
		for _, key := range sortedKeys(messages) {
			if _, ok := english[key]; !ok {
				t.Errorf("%s.json has %q, which en.json does not", code, key)
			}
		}
	}

	for code, messages := range files {
		if messages["language.selfName"] == "" {
			t.Errorf("%s.json needs a language.selfName", code)
		}
		for key, text := range messages {
			if strings.TrimSpace(text) == "" {
				t.Errorf("%s.json has an empty text for %q", code, key)
			}
			// A renamed or dropped placeholder shows as a literal {name}.
			if want, got := placeholdersOf(english[key]), placeholdersOf(text); want != got {
				t.Errorf("%s.json %q uses placeholders [%s], en.json uses [%s]", code, key, got, want)
			}
		}
	}
}

// The backend lists the directory, so what it loads has to equal what is on disk.
func TestUIMessagesLoadThroughTheBackend(t *testing.T) {
	loaded, err := loadUIMessages()
	if err != nil {
		t.Fatalf("loadUIMessages: %v", err)
	}
	for code := range readI18nFiles(t) {
		if _, ok := loaded[code]; !ok {
			t.Errorf("the backend did not load %s", code)
		}
	}
}

func TestUIIdsUsedByMarkupAndScriptExist(t *testing.T) {
	english := readI18nFiles(t)["en"]
	html := readFrontend(t, "index.html")
	script := readFrontend(t, "app.js")

	check := func(where, id string) {
		if _, ok := english[id]; !ok {
			t.Errorf("%s uses the interface id %q, which en.json does not define", where, id)
		}
	}

	markup := regexp.MustCompile(`data-i18n(?:-title)?="([^"]+)"`).FindAllStringSubmatch(html, -1)
	if len(markup) == 0 {
		t.Fatal("index.html has no data-i18n attributes; the markup is not translated")
	}
	for _, m := range markup {
		check("index.html", m[1])
	}

	// Only literal lookups can be checked here; ids built at run time are
	// covered by the tests below.
	literal := regexp.MustCompile(`\bt\(\s*'([^']+)'\s*[,)]`).FindAllStringSubmatch(script, -1)
	if len(literal) == 0 {
		t.Fatal("app.js has no t('...') lookups")
	}
	for _, m := range literal {
		check("app.js", m[1])
	}
}

// Ids the script builds from backend data: section names, issue codes and the
// progress stages Go reports. They are read from the Go source so a new stage or
// issue code without a translation fails here.
func TestUIDynamicIdsExist(t *testing.T) {
	english := readI18nFiles(t)["en"]
	script := readFrontend(t, "app.js")

	for _, section := range []string{"text", "menu", "dialogs", "patterns", "valueMaps", "valueRules", "file", "language", "name"} {
		if _, ok := english["section."+section]; !ok {
			t.Errorf("en.json lacks section.%s", section)
		}
	}

	sources, err := filepath.Glob("internal/core/*.go")
	if err != nil || len(sources) == 0 {
		t.Fatalf("listing the core sources: %v", err)
	}
	sources = append(sources, "app.go")

	stage := regexp.MustCompile(`[pP]rogress\("([^"]+)"`)
	issue := regexp.MustCompile(`\bIssue\w+\s*=\s*"(\w+)"`)
	stages, codes := 0, 0
	for _, source := range sources {
		if strings.HasSuffix(source, "_test.go") {
			continue
		}
		data, err := os.ReadFile(source)
		if err != nil {
			t.Fatalf("reading %s: %v", source, err)
		}
		for _, m := range stage.FindAllStringSubmatch(string(data), -1) {
			stages++
			if _, ok := english["progress."+m[1]]; !ok {
				t.Errorf("progress stage %q (%s) has no progress.%s text in en.json", m[1], source, m[1])
			}
		}
		for _, m := range issue.FindAllStringSubmatch(string(data), -1) {
			codes++
			if _, ok := english["issue."+m[1]]; !ok {
				t.Errorf("issue code %q (%s) has no issue.%s text in en.json", m[1], source, m[1])
			}
			if !strings.Contains(script, "case '"+m[1]+"'") {
				t.Errorf("app.js does not handle the issue code %q", m[1])
			}
		}
	}
	if stages == 0 || codes == 0 {
		t.Errorf("found %d progress stages and %d issue codes in the Go sources; the patterns need updating", stages, codes)
	}
}
