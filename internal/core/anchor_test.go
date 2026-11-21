package core

import (
	"os"
	"strings"
	"testing"
)

// Antigravity 2.33 and later ship neither the language block nor the debugging
// port block, so the switch has to land after the occluded-windows switch.
func TestLanguageSwitchFallsBackToOccludedSwitch(t *testing.T) {
	source := "\"use strict\";\n" +
		"electron_1.app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');\n" +
		"electron_1.app.whenReady().then(main);\n"
	out, err := applyLanguageSwitch(source, &Locale{Language: "zh-TW"})
	if err != nil {
		t.Fatal(err)
	}
	want := "appendSwitch('disable-backgrounding-occluded-windows');\n" +
		"if (!electron_1.app.commandLine.hasSwitch('lang')) {\n" +
		"    electron_1.app.commandLine.appendSwitch('lang', 'zh-TW');\n}"
	if !strings.Contains(out, want) {
		t.Fatalf("switch not inserted after the occluded-windows anchor:\n%s", out)
	}
	// A second run rewrites the block it inserted instead of adding another.
	again, err := applyLanguageSwitch(out, &Locale{Language: "ja"})
	if err != nil {
		t.Fatal(err)
	}
	if n := strings.Count(again, "appendSwitch('lang'"); n != 1 {
		t.Fatalf("language switch appears %d times, want 1", n)
	}
	if !strings.Contains(again, "'lang', 'ja'") {
		t.Fatal("switching locale did not rewrite the language code")
	}
}

// The anchor must start a line: the same call nested in a function is not the
// top-level startup switch.
func TestOccludedSwitchMustStartLine(t *testing.T) {
	source := "function f() { electron_1.app.commandLine.appendSwitch('disable-backgrounding-occluded-windows'); }\n"
	out, err := applyLanguageSwitch(source, &Locale{Language: "zh-TW"})
	if err != nil {
		t.Fatal(err)
	}
	if out != source {
		t.Fatal("an indented call was used as the anchor")
	}
}

func TestPatternScopeValidation(t *testing.T) {
	base := func(scope string) *Locale {
		return &Locale{
			Language: "ja", Name: "Japanese", Text: map[string]string{"Hello": "こんにちは"},
			Patterns: []PatternRule{{Pattern: `^No (\d+) yet$`, Template: "{1}", Sample: "No 3 yet", Scope: scope}},
		}
	}
	if err := validateLocale("ja", base("sentence")); err != nil {
		t.Fatalf("scope 'sentence' rejected: %v", err)
	}
	if err := validateLocale("ja", base("")); err != nil {
		t.Fatalf("missing scope rejected: %v", err)
	}
	if err := validateLocale("ja", base("sentense")); err == nil || !strings.Contains(err.Error(), "scope") {
		t.Fatalf("misspelled scope accepted: %v", err)
	}
}

// TestPatchRealArchive builds a patched copy of a real Antigravity archive
// without touching the installation. It is how a new Antigravity release is
// checked for moved anchors before anyone runs apply against it.
func TestPatchRealArchive(t *testing.T) {
	src := os.Getenv("ANTIGRAVITY_ASAR")
	if src == "" {
		t.Skip("set ANTIGRAVITY_ASAR to a real app.asar to run this test")
	}
	assets := os.DirFS("../..")
	store, err := NewLocaleStore(assets, assets, "assets/locales", "assets/patches")
	if err != nil {
		t.Fatal(err)
	}
	loc, err := store.LoadLocale(DefaultLocale)
	if err != nil {
		t.Fatal(err)
	}
	preload, err := store.buildPreloadFragment(loc)
	if err != nil {
		t.Fatal(err)
	}
	menu, err := store.buildMenuFragment(loc)
	if err != nil {
		t.Fatal(err)
	}
	dialog, err := store.buildDialogFragment(loc)
	if err != nil {
		t.Fatal(err)
	}
	staged, err := buildPatchedArchive(src, loc, preload, menu, dialog)
	if err != nil {
		t.Fatalf("patching %s: %v", src, err)
	}
	defer os.Remove(staged)
	arc, err := ReadArchive(staged)
	if err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{"dist/main.js", "dist/menu.js", "dist/preload.js"} {
		data, err := arc.ReadFile(rel)
		if err != nil {
			t.Fatal(err)
		}
		if err := checkJavaScriptSyntax(rel, string(data)); err != nil {
			t.Fatalf("%s: %v", rel, err)
		}
	}
	main, _ := arc.ReadFile("dist/main.js")
	if !strings.Contains(string(main), "appendSwitch('lang', 'zh-TW')") {
		t.Fatal("language switch missing from the patched main.js")
	}
	t.Logf("patched %s (%s)", src, arc.Identity().Version)
}
