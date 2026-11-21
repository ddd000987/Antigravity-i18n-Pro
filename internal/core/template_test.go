package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func templateService(t *testing.T) *Service {
	t.Helper()
	assets := os.DirFS("../..")
	store, err := NewLocaleStore(assets, assets, "assets/locales", "assets/patches")
	if err != nil {
		t.Fatal(err)
	}
	if notes, err := os.ReadFile("../../assets/catalog/notes.json"); err == nil {
		if err := store.SetNotes(notes); err != nil {
			t.Fatal(err)
		}
	}
	svc := NewService(store)
	// Tests must never close or relaunch the user's real Antigravity.
	svc.stopApp = func(bool, int) (bool, bool, bool, error) { return false, true, false, nil }
	svc.appRunning = func() (bool, error) { return false, nil }
	svc.launchApp = func(*paths) error { return nil }
	return svc
}

// exportBlank writes a blank template and returns it decoded for editing.
func exportBlank(t *testing.T, svc *Service) (string, map[string]any) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "template.json")
	if _, err := svc.ExportTemplate(path, ""); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("exported template is not valid JSON: %v", err)
	}
	return path, doc
}

func writeDoc(t *testing.T, path string, doc map[string]any) {
	t.Helper()
	data, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

func findRule(doc map[string]any, id string) map[string]any {
	for _, r := range doc["patterns"].([]any) {
		m := r.(map[string]any)
		if m["id"] == id {
			return m
		}
	}
	return nil
}

func TestBlankTemplateListsEveryStringEmpty(t *testing.T) {
	svc := templateService(t)
	_, doc := exportBlank(t, svc)
	ref, err := svc.store.LoadLocale(DefaultLocale)
	if err != nil {
		t.Fatal(err)
	}
	text := doc["text"].(map[string]any)
	if len(text) != len(ref.Text) {
		t.Fatalf("template has %d text keys, reference %d", len(text), len(ref.Text))
	}
	for k, v := range text {
		if v != "" {
			t.Fatalf("blank template has a translation for %q", k)
		}
	}
	// A translator never sees a regex: rules carry an example and the source
	// with placeholders instead.
	rule := findRule(doc, "thoughtFor")
	if rule == nil {
		t.Fatal("rule thoughtFor missing from the template")
	}
	if _, ok := rule["pattern"]; ok {
		t.Fatal("a template rule exposes its regex")
	}
	if rule["source"] != "Thought for {1}{2}" || rule["example"] != "Thought for 5s" {
		t.Fatalf("unexpected rule entry: %v", rule)
	}
	if !strings.Contains(rule["note"].(string), "valueMaps.durationUnit") {
		t.Fatalf("rule note does not explain its value map: %v", rule["note"])
	}
	notes := doc["notes"].(map[string]any)["text"].(map[string]any)
	if len(notes) == 0 {
		t.Fatal("template has no screen-location notes")
	}
}

func TestPrefilledTemplateRoundTripsTheReference(t *testing.T) {
	svc := templateService(t)
	path := filepath.Join(t.TempDir(), "tw.json")
	if _, err := svc.ExportTemplate(path, DefaultLocale); err != nil {
		t.Fatal(err)
	}
	report, err := svc.CheckLocaleFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !report.OK || len(report.Issues) != 0 {
		t.Fatalf("prefilled reference template has issues: %+v", report.Issues)
	}
	if report.Progress.Percent != 100 || report.MissingKeys != 0 {
		t.Fatalf("prefilled reference is not complete: %+v", report.Progress)
	}
	// The file rebuilds the same patterns the bundled pack has.
	loc, _, err := svc.loadLocaleFile(path)
	if err != nil || loc == nil {
		t.Fatalf("could not load the prefilled template: %v", err)
	}
	ref, _ := svc.store.LoadLocale(DefaultLocale)
	if len(loc.Patterns) != len(ref.Patterns) || len(loc.Text) != len(ref.Text) {
		t.Fatalf("rebuilt %d patterns / %d texts, want %d / %d",
			len(loc.Patterns), len(loc.Text), len(ref.Patterns), len(ref.Text))
	}
	for i := range ref.Patterns {
		if loc.Patterns[i].ID != ref.Patterns[i].ID {
			t.Fatalf("rule %d is %s, want %s: rule order decides which rule wins", i, loc.Patterns[i].ID, ref.Patterns[i].ID)
		}
	}
	if _, err := svc.store.buildPreloadFragment(loc); err != nil {
		t.Fatal(err)
	}
}

func TestPartialTranslationApplies(t *testing.T) {
	svc := templateService(t)
	path, doc := exportBlank(t, svc)
	doc["language"] = "fr"
	doc["name"] = "Français"
	doc["text"].(map[string]any)["Settings"] = "Paramètres"
	findRule(doc, "thoughtFor")["template"] = "A réfléchi {1}{2}"
	writeDoc(t, path, doc)

	report, err := svc.CheckLocaleFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !report.OK {
		t.Fatalf("partial file rejected: %+v", report.Issues)
	}
	if report.Progress.Done != 2 || report.Progress.Percent != 0 {
		t.Fatalf("progress = %+v, want 2 done", report.Progress)
	}
	loc, _, _ := svc.loadLocaleFile(path)
	if len(loc.Patterns) != 1 || loc.Patterns[0].Pattern == "" || loc.Patterns[0].Replace["2"] != "durationUnit" {
		t.Fatalf("rule was not filled in from the catalog: %+v", loc.Patterns)
	}
	if _, ok := loc.ValueMaps["durationUnit"]; !ok {
		t.Fatal("an untranslated value map referenced by a rule was not supplied")
	}

	appDir := installLayout(t, fixtureAsar(t))
	result, err := svc.ApplyLocale(Options{AppDir: appDir, LocaleFile: path})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if result.Locale != "fr" || result.LocaleName != "Français" {
		t.Fatalf("applied %+v", result)
	}
	status, err := svc.GetStatus(appDir)
	if err != nil || status.CurrentLanguage != "fr" {
		t.Fatalf("status after applying a file: %+v, %v", status, err)
	}
}

func TestBrokenTranslationsAreReportedWithLines(t *testing.T) {
	svc := templateService(t)
	path, doc := exportBlank(t, svc)
	doc["language"] = "fr"
	doc["name"] = "Français"
	text := doc["text"].(map[string]any)
	var markerKey string
	for k := range text {
		if strings.Count(k, "<>") == 1 {
			markerKey = k
			break
		}
	}
	text[markerKey] = "sans marqueur"
	findRule(doc, "thoughtFor")["template"] = "A réfléchi {1}"
	findRule(doc, "workedFor")["template"] = "{1}{2}{3}"
	writeDoc(t, path, doc)

	report, err := svc.CheckLocaleFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if report.OK {
		t.Fatal("broken translations were accepted")
	}
	codes := map[string]Issue{}
	for _, i := range report.Issues {
		codes[i.Code+":"+i.Key] = i
	}
	marker, ok := codes[IssueMarkers+":"+markerKey]
	if !ok || marker.Line == 0 || marker.Want != 1 || marker.Got != 0 {
		t.Fatalf("lost marker not reported with its line: %+v", report.Issues)
	}
	missing, ok := codes[IssuePlaceholders+":thoughtFor"]
	if !ok || len(missing.Missing) != 1 || missing.Missing[0] != "{2}" || missing.Line == 0 {
		t.Fatalf("missing {2} not reported: %+v", report.Issues)
	}
	extra, ok := codes[IssuePlaceholders+":workedFor"]
	if !ok || len(extra.Extra) != 1 || extra.Extra[0] != "{3}" {
		t.Fatalf("unknown {3} not reported: %+v", report.Issues)
	}
	appDir := installLayout(t, fixtureAsar(t))
	if _, err := svc.ApplyLocale(Options{AppDir: appDir, LocaleFile: path}); err == nil {
		t.Fatal("apply accepted a file with errors")
	}
}

func TestSyntaxErrorNamesTheLine(t *testing.T) {
	svc := templateService(t)
	path := filepath.Join(t.TempDir(), "bad.json")
	if err := os.WriteFile(path, []byte("{\n  \"language\": \"fr\",\n  \"name\": \"x\"\n  \"text\": {}\n}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	report, err := svc.CheckLocaleFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if report.OK || len(report.Issues) != 1 || report.Issues[0].Code != IssueJSON || report.Issues[0].Line != 4 {
		t.Fatalf("syntax error not located on line 4: %+v", report.Issues)
	}
}

func TestUpdateTemplateAddsNewKeysAndKeepsTranslations(t *testing.T) {
	svc := templateService(t)
	path, doc := exportBlank(t, svc)
	doc["language"] = "fr"
	doc["name"] = "Français"
	doc["author"] = "kept as written"
	text := doc["text"].(map[string]any)
	text["Settings"] = "Paramètres"
	// Simulate a file made for an older release: two strings it never had,
	// one string the current release no longer shows, and a dropped rule.
	delete(text, "Cancel")
	delete(text, "Copy")
	text["An old string"] = "Une vieille chaîne"
	var rules []any
	for _, r := range doc["patterns"].([]any) {
		if r.(map[string]any)["id"] != "workedFor" {
			rules = append(rules, r)
		}
	}
	rules = append(rules, map[string]any{"id": "goneRule", "template": "x"})
	doc["patterns"] = rules
	writeDoc(t, path, doc)

	summary, err := svc.UpdateTemplate(path, "")
	if err != nil {
		t.Fatal(err)
	}
	if summary.Added["text"] != 2 || summary.Added["patterns"] != 1 || summary.BackupPath == "" {
		t.Fatalf("unexpected summary: %+v", summary)
	}
	if summary.Obsolete["text"] != 1 || summary.Obsolete["patterns"] != 1 {
		t.Fatalf("obsolete entries not counted: %+v", summary.Obsolete)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var updated map[string]any
	if err := json.Unmarshal(raw, &updated); err != nil {
		t.Fatal(err)
	}
	ut := updated["text"].(map[string]any)
	if ut["Settings"] != "Paramètres" || ut["An old string"] != "Une vieille chaîne" {
		t.Fatal("existing translations were not kept")
	}
	if v, ok := ut["Cancel"]; !ok || v != "" {
		t.Fatal("a new string was not added empty")
	}
	if updated["author"] != "kept as written" || updated["language"] != "fr" {
		t.Fatal("the file's own fields were not kept")
	}
	if findRule(updated, "goneRule") != nil {
		t.Fatal("a rule the release dropped was carried forward")
	}
	if r := findRule(updated, "workedFor"); r == nil || !strings.HasPrefix(r["note"].(string), "[NEW]") {
		t.Fatalf("new rule not marked: %v", r)
	}
	newText := updated["newEntries"].(map[string]any)["text"].([]any)
	if len(newText) != 2 {
		t.Fatalf("newEntries.text = %v", newText)
	}
	if note := updated["notes"].(map[string]any)["text"].(map[string]any)["Cancel"]; note == nil || !strings.HasPrefix(note.(string), "[NEW]") {
		t.Fatalf("new text not marked in notes: %v", note)
	}
	// Running it again finds nothing new and still keeps everything.
	again, err := svc.UpdateTemplate(path, "")
	if err != nil || again.AddedTotal != 0 {
		t.Fatalf("second update: %+v, %v", again, err)
	}
	backup, _ := os.ReadFile(summary.BackupPath)
	if !strings.Contains(string(backup), "An old string") {
		t.Fatal("the backup is not the original file")
	}
}

func TestSettingsRememberChoiceAndHintReapply(t *testing.T) {
	svc := templateService(t)
	svc.SettingsPath = filepath.Join(t.TempDir(), "settings.json")
	appDir := installLayout(t, fixtureAsar(t))

	hint, err := svc.GetReapplyHint(appDir)
	if err != nil || hint.Needed {
		t.Fatalf("hint before any apply: %+v, %v", hint, err)
	}
	if _, err := svc.ApplyLocale(Options{AppDir: appDir, Locale: "zh-TW"}); err != nil {
		t.Fatal(err)
	}
	if got := svc.LoadSettings().LastLocale; got != "zh-TW" {
		t.Fatalf("remembered %q", got)
	}
	if hint, _ := svc.GetReapplyHint(appDir); hint.Needed {
		t.Fatal("hint fired while the translation is still installed")
	}

	// An Antigravity update replaces app.asar with a fresh English one.
	clean, err := os.ReadFile(fixtureAsar(t))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(asarOf(appDir), clean, 0o644); err != nil {
		t.Fatal(err)
	}
	hint, err = svc.GetReapplyHint(appDir)
	if err != nil || !hint.Needed || hint.Locale != "zh-TW" || hint.Name == "" {
		t.Fatalf("hint after an update: %+v, %v", hint, err)
	}
	if _, err := svc.Reapply(Options{AppDir: appDir}); err != nil {
		t.Fatalf("reapply: %v", err)
	}
	if status, _ := svc.GetStatus(appDir); status.CurrentLanguage != "zh-TW" {
		t.Fatalf("reapply left %q", status.CurrentLanguage)
	}

	// Restoring English on purpose is remembered too, so no reminder follows.
	if _, err := svc.RestoreOfficial(Options{AppDir: appDir}); err != nil {
		t.Fatal(err)
	}
	if hint, _ := svc.GetReapplyHint(appDir); hint.Needed {
		t.Fatal("hint fired after a deliberate restore")
	}
}
