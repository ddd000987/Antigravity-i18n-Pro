package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// templateFormat versions the layout of exported templates.
const templateFormat = 1

// templateAbout is written at the top of every template, so the file explains
// itself to whoever opens it in a text editor.
var templateAbout = []string{
	"Antigravity-i18n-Pro translation template.",
	"Fill in the empty strings. Anything left empty stays in English, so you can apply a partial translation and keep going.",
	"Set 'language' (a code such as fr, de or pt-BR) and 'name' (your language's own name) before applying.",
	"Keep every placeholder {1}, {2}, ... and every <> marker. <> stands for an inline element such as a link, a code span or a keyboard key; keep them in their original order.",
	"'text' holds the interface strings, 'menu' the native menu bar and 'dialogs' the quit confirmation dialog.",
	"'patterns' are strings with values filled in by the app: translate 'template'. 'source' shows the English with its placeholders and 'example' a real string it matches. If your language needs plural forms, replace 'template' with 'templates': {\"one\": \"...\", \"other\": \"...\"} (CLDR categories zero, one, two, few, many, other; 'other' is required).",
	"'valueMaps' translate words captured by patterns; 'valueRules' translate parts of durations such as '3 days'.",
	"'punctuation' maps trailing English punctuation to your own (leave empty to keep it); 'notes' says where strings appear on screen.",
	"Check without applying: antigravity-i18n-pro check --locale-file <this file>. Apply: antigravity-i18n-pro apply --locale-file <this file>, or 'Load language file' in the window.",
	"After an Antigravity update: antigravity-i18n-pro update-template --locale-file <this file> adds the new strings and keeps everything you translated.",
}

// templateValues are the translations a template is filled with: none for a
// blank export, a bundled pack for a prefilled one, or the user's own file
// for an update.
type templateValues struct {
	meta  ordered
	extra ordered // unknown top-level members of a user file, kept as written

	text, menu, dialogs, punct map[string]string
	textOrder, menuOrder       []string
	dialogOrder, punctOrder    []string
	skipSuffixes               []string
	valueMaps                  map[string]map[string]string
	valueMapOrder              map[string][]string
	valueRules                 map[string][]fileValueRule
	patterns                   map[string]filePattern
	custom                     []filePattern
	allowSourceEqual           []string
}

// newMarks records what an update added, so it can be listed and flagged.
type newMarks struct {
	added    map[string][]string
	obsolete map[string][]string
}

func (m *newMarks) add(section, key string) {
	if m != nil {
		m.added[section] = append(m.added[section], key)
	}
}

func (m *newMarks) isNew(section, key string) bool {
	if m == nil {
		return false
	}
	for _, k := range m.added[section] {
		if k == key {
			return true
		}
	}
	return false
}

func metaFields(language, name, englishName, htmlLang, chromiumLang, dir, pluralLocale string) ordered {
	var o ordered
	o.set("language", language)
	o.set("name", name)
	o.set("englishName", englishName)
	o.set("htmlLang", htmlLang)
	if chromiumLang != "" {
		o.set("chromiumLang", chromiumLang)
	}
	if dir == "" {
		dir = "ltr"
	}
	o.set("dir", dir)
	if pluralLocale != "" {
		o.set("pluralLocale", pluralLocale)
	}
	return o
}

// valuesFromLocale prefills a template from a bundled pack.
func valuesFromLocale(cat *catalog, loc *Locale) *templateValues {
	v := &templateValues{
		meta:          metaFields(loc.Language, loc.Name, loc.EnglishName, loc.HTMLLang, loc.ChromiumLang, loc.Dir, loc.PluralLocale),
		text:          loc.Text,
		menu:          loc.Menu,
		dialogs:       loc.Dialogs,
		punct:         loc.Punctuation,
		skipSuffixes:  loc.PunctuationSkipSuffixes,
		valueMaps:     loc.ValueMaps,
		valueRules:    map[string][]fileValueRule{},
		patterns:      map[string]filePattern{},
		valueMapOrder: map[string][]string{},
	}
	for name, rules := range loc.ValueRules {
		for _, r := range rules {
			v.valueRules[name] = append(v.valueRules[name], fileValueRule{Pattern: r.Pattern, Flags: r.Flags, Template: r.Template})
		}
	}
	for _, r := range loc.Patterns {
		if _, ok := cat.rule(r.ID); ok && r.ID != "" {
			v.patterns[r.ID] = filePattern{ID: r.ID, Template: r.Template, Templates: r.Templates}
			continue
		}
		v.custom = append(v.custom, fullPattern(r))
	}
	return v
}

func fullPattern(r PatternRule) filePattern {
	return filePattern{ID: r.ID, Pattern: r.Pattern, Flags: r.Flags, Scope: r.Scope, Template: r.Template,
		Templates: r.Templates, Sample: r.Sample, PluralGroup: r.PluralGroup, Replace: r.Replace, TrimGroups: r.TrimGroups}
}

// knownTopLevel are the members a template writes itself.
var knownTopLevel = map[string]bool{
	"$schema": true, "_about": true, "templateInfo": true, "language": true, "name": true, "englishName": true,
	"htmlLang": true, "chromiumLang": true, "dir": true, "pluralLocale": true, "punctuation": true,
	"punctuationSkipSuffixes": true, "text": true, "menu": true, "dialogs": true, "patterns": true,
	"valueMaps": true, "valueRules": true, "allowSourceEqual": true, "notes": true, "newEntries": true,
	"obsoleteEntries": true,
}

// valuesFromFile reads a user's file for an update, keeping its order.
func valuesFromFile(cat *catalog, raw []byte, file *fileLocale) *templateValues {
	keys, members, _ := objectMembers(raw)
	v := &templateValues{
		meta:          metaFields(file.Language, file.Name, file.EnglishName, file.HTMLLang, file.ChromiumLang, file.Dir, file.PluralLocale),
		text:          file.Text,
		menu:          file.Menu,
		dialogs:       file.Dialogs,
		punct:         file.Punctuation,
		textOrder:     objectKeys(members["text"]),
		menuOrder:     objectKeys(members["menu"]),
		dialogOrder:   objectKeys(members["dialogs"]),
		punctOrder:    objectKeys(members["punctuation"]),
		skipSuffixes:  file.PunctuationSkipSuffixes,
		valueMaps:     file.ValueMaps,
		valueMapOrder: map[string][]string{},
		valueRules:    file.ValueRules,
		patterns:      map[string]filePattern{},

		allowSourceEqual: file.AllowSourceEqual,
	}
	for _, k := range keys {
		if !knownTopLevel[k] {
			v.extra.set(k, members[k])
		}
	}
	if raw, ok := members["valueMaps"]; ok {
		if _, maps, err := objectMembers(raw); err == nil {
			for name, m := range maps {
				v.valueMapOrder[name] = objectKeys(m)
			}
		}
	}
	for _, p := range file.Patterns {
		if _, ok := cat.rule(p.ID); ok && p.ID != "" {
			v.patterns[p.ID] = p
			continue
		}
		if p.Pattern != "" {
			v.custom = append(v.custom, p)
		}
	}
	return v
}

// orderedSection writes catalog keys first, then the file's own extra keys in
// the order the file had them. With marks set, a catalog key the file did not
// list at all is recorded as new, and a file key the catalog lacks as obsolete.
func orderedSection(section string, catKeys []string, values map[string]string, fileOrder []string, marks *newMarks) ordered {
	var o ordered
	known := map[string]bool{}
	for _, k := range catKeys {
		known[k] = true
		v, ok := values[k]
		if !ok {
			marks.add(section, k)
		}
		o.set(k, v)
	}
	order := fileOrder
	if len(order) == 0 {
		order = sortedKeys(values)
	}
	for _, k := range order {
		if known[k] {
			continue
		}
		if _, ok := values[k]; !ok {
			continue
		}
		known[k] = true
		if marks != nil {
			marks.obsolete[section] = append(marks.obsolete[section], k)
		}
		o.set(k, values[k])
	}
	return o
}

func ruleNote(cat *catalog, r catalogRule) string {
	var parts []string
	if r.Groups > 0 {
		var ph []string
		for g := 1; g <= r.Groups; g++ {
			ph = append(ph, "{"+strconv.Itoa(g)+"}")
		}
		parts = append(parts, "values filled in by the app: keep "+strings.Join(ph, " "))
	}
	for _, capture := range sortedMapKeys(r.Rule.Replace) {
		name := r.Rule.Replace[capture]
		kind := "valueMaps"
		if _, ok := cat.ValueRules[name]; ok {
			kind = "valueRules"
		}
		parts = append(parts, fmt.Sprintf("{%s} is translated through %s.%s", capture, kind, name))
	}
	if strings.Contains(r.Source, inlineMarker) {
		parts = append(parts, "keep each <> (an inline element such as a link, code or key)")
	}
	return strings.Join(parts, "; ")
}

func textNote(cat *catalog, key string) string {
	note := cat.Notes[key]
	if strings.Contains(key, inlineMarker) {
		hint := "keep each <> (an inline element such as a link, code or key)"
		if note == "" {
			return "Sentence with inline elements; " + hint
		}
		return note + "; " + hint
	}
	return note
}

// buildTemplateDoc assembles the template in the order translators read it.
func buildTemplateDoc(cat *catalog, v *templateValues, marks *newMarks) ordered {
	var doc ordered
	doc.set("_about", templateAbout)
	var info ordered
	info.set("format", templateFormat)
	info.set("tool", "Antigravity-i18n-Pro "+Version)
	if cat.BasedOn != "" {
		info.set("strings", cat.BasedOn)
	}
	info.set("generated", time.Now().UTC().Format(time.RFC3339))
	doc.set("templateInfo", info)
	for _, m := range v.meta {
		doc.set(m.Key, m.Value)
	}
	doc = append(doc, v.extra...)

	doc.set("punctuation", orderedSection("punctuation", cat.PunctKeys, v.punct, v.punctOrder, nil))
	skip := v.skipSuffixes
	if skip == nil {
		skip = []string{}
	}
	doc.set("punctuationSkipSuffixes", skip)
	doc.set("text", orderedSection("text", cat.TextKeys, v.text, v.textOrder, marks))
	doc.set("menu", orderedSection("menu", cat.MenuKeys, v.menu, v.menuOrder, marks))
	doc.set("dialogs", orderedSection("dialogs", cat.DialogKeys, v.dialogs, v.dialogOrder, marks))

	var patterns []any
	for _, r := range cat.Rules {
		var e ordered
		e.set("id", r.Rule.ID)
		e.set("example", r.Rule.Sample)
		e.set("source", r.Source)
		user, ok := v.patterns[r.Rule.ID]
		if !ok && marks != nil {
			marks.add("patterns", r.Rule.ID)
		}
		if len(user.Templates) > 0 {
			var forms ordered
			for _, c := range append(append([]string{}, pluralCategories...), sortedMapKeys(user.Templates)...) {
				if t, ok := user.Templates[c]; ok && !hasKey(forms, c) {
					forms.set(c, t)
				}
			}
			e.set("templates", forms)
		} else {
			e.set("template", user.Template)
		}
		note := ruleNote(cat, r)
		if marks.isNew("patterns", r.Rule.ID) {
			note = strings.TrimSuffix("[NEW] "+note, " ")
		}
		if note != "" {
			e.set("note", note)
		}
		patterns = append(patterns, e)
	}
	for _, p := range v.custom {
		patterns = append(patterns, customPatternEntry(p))
	}
	if patterns == nil {
		patterns = []any{}
	}
	doc.set("patterns", patterns)

	var maps ordered
	for _, name := range cat.ValueMapNames {
		maps.set(name, orderedSection("valueMaps."+name, cat.ValueMapKeys[name], v.valueMaps[name], v.valueMapOrder[name], marks))
	}
	for _, name := range sortedMapKeys(v.valueMaps) {
		if _, ok := cat.ValueMapKeys[name]; !ok {
			maps.set(name, orderedSection("valueMaps."+name, nil, v.valueMaps[name], v.valueMapOrder[name], nil))
		}
	}
	doc.set("valueMaps", maps)

	var rules ordered
	for _, name := range cat.ValueRuleNames {
		var list []any
		for i, r := range cat.ValueRules[name] {
			var e ordered
			e.set("match", r.Pattern)
			tmpl := ""
			if user := v.valueRules[name]; i < len(user) {
				tmpl = user[i].Template
			}
			e.set("template", tmpl)
			list = append(list, e)
		}
		rules.set(name, list)
	}
	doc.set("valueRules", rules)
	if len(v.allowSourceEqual) > 0 {
		doc.set("allowSourceEqual", v.allowSourceEqual)
	}

	var textNotes ordered
	for _, k := range cat.TextKeys {
		note := textNote(cat, k)
		if marks.isNew("text", k) {
			note = strings.TrimSpace("[NEW] " + note)
		}
		if note != "" {
			textNotes.set(k, note)
		}
	}
	var notes ordered
	notes.set("text", textNotes)
	doc.set("notes", notes)

	if marks != nil {
		doc.set("newEntries", marksSection(marks.added))
		if len(marks.obsolete) > 0 {
			doc.set("obsoleteEntries", marksSection(marks.obsolete))
		}
	}
	return doc
}

func hasKey(o ordered, key string) bool {
	for _, m := range o {
		if m.Key == key {
			return true
		}
	}
	return false
}

func marksSection(m map[string][]string) ordered {
	var o ordered
	for _, section := range sortedMapKeys(m) {
		o.set(section, m[section])
	}
	return o
}

func customPatternEntry(p filePattern) ordered {
	var e ordered
	if p.ID != "" {
		e.set("id", p.ID)
	}
	e.set("pattern", p.Pattern)
	if p.Flags != "" {
		e.set("flags", p.Flags)
	}
	if p.Scope != "" {
		e.set("scope", p.Scope)
	}
	if len(p.Templates) > 0 {
		var forms ordered
		for _, c := range sortedMapKeys(p.Templates) {
			forms.set(c, p.Templates[c])
		}
		e.set("templates", forms)
	} else {
		e.set("template", p.Template)
	}
	sample := p.Sample
	if sample == "" {
		sample = p.Example
	}
	e.set("sample", sample)
	if p.PluralGroup != nil {
		e.set("pluralGroup", *p.PluralGroup)
	}
	if len(p.Replace) > 0 {
		var r ordered
		for _, k := range sortedMapKeys(p.Replace) {
			r.set(k, p.Replace[k])
		}
		e.set("replace", r)
	}
	if len(p.TrimGroups) > 0 {
		e.set("trimGroups", p.TrimGroups)
	}
	return e
}

// TemplateSummary describes an exported template.
type TemplateSummary struct {
	Path    string `json:"path"`
	From    string `json:"from"`
	Entries int    `json:"entries"`
}

// BuildTemplate renders a template, blank or prefilled from a bundled pack.
func (s *LocaleStore) BuildTemplate(from string) ([]byte, int, error) {
	cat, err := s.catalog()
	if err != nil {
		return nil, 0, err
	}
	v := &templateValues{meta: metaFields("", "", "", "", "", "ltr", "")}
	if from != "" && CanonicalLocale(from) != EnglishLocale {
		loc, err := s.LoadLocale(from)
		if err != nil {
			return nil, 0, err
		}
		v = valuesFromLocale(cat, loc)
	}
	entries := len(cat.TextKeys) + len(cat.MenuKeys) + len(cat.DialogKeys) + len(cat.Rules)
	return writeJSON(buildTemplateDoc(cat, v, nil)), entries, nil
}

// ExportTemplate writes a translation template to path.
func (s *Service) ExportTemplate(path, from string) (*TemplateSummary, error) {
	data, entries, err := s.store.BuildTemplate(from)
	if err != nil {
		return nil, err
	}
	if err := writeFileAtomic(path, data); err != nil {
		return nil, err
	}
	return &TemplateSummary{Path: path, From: from, Entries: entries}, nil
}

// UpdateSummary describes what update-template changed.
type UpdateSummary struct {
	Path       string         `json:"path"`
	BackupPath string         `json:"backupPath"`
	Added      map[string]int `json:"added"`
	AddedTotal int            `json:"addedTotal"`
	Obsolete   map[string]int `json:"obsolete"`
	Progress   Progress       `json:"progress"`
}

// UpdateTemplate merges the current catalog into a user's language file: new
// English strings are added empty and listed under newEntries, translations
// already in the file are kept exactly, and rules the release dropped are
// listed under obsoleteEntries. The original is kept as a .bak copy first.
func (s *Service) UpdateTemplate(path, outPath string) (*UpdateSummary, error) {
	cat, err := s.store.catalog()
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("cannot read the language file: %w", err)
	}
	raw = bytes.TrimPrefix(raw, utf8BOM)
	report := &FileReport{Path: path}
	file, ok := parseLocaleFile(raw, report)
	if !ok {
		return nil, &LocaleFileError{Report: report}
	}
	marks := &newMarks{added: map[string][]string{}, obsolete: map[string][]string{}}
	v := valuesFromFile(cat, raw, file)
	// Rules the user wrote by id only cannot work without the catalog entry,
	// so a dropped one is listed rather than carried forward.
	for _, p := range file.Patterns {
		if _, ok := cat.rule(p.ID); !ok && p.Pattern == "" && p.ID != "" {
			marks.obsolete["patterns"] = append(marks.obsolete["patterns"], p.ID)
		}
	}
	doc := buildTemplateDoc(cat, v, marks)
	data := writeJSON(doc)

	if outPath == "" {
		outPath = path
	}
	summary := &UpdateSummary{Path: outPath, Added: map[string]int{}, Obsolete: map[string]int{}}
	if sameFile(outPath, path) {
		backup := path + ".bak-" + time.Now().Format("20060102-150405")
		if err := os.WriteFile(backup, raw, 0o644); err != nil {
			return nil, fmt.Errorf("cannot write the backup copy: %w", err)
		}
		summary.BackupPath = backup
	}
	if err := writeFileAtomic(outPath, data); err != nil {
		return nil, err
	}
	for section, keys := range marks.added {
		summary.Added[section] = len(keys)
		summary.AddedTotal += len(keys)
	}
	for section, keys := range marks.obsolete {
		summary.Obsolete[section] = len(keys)
	}
	var updated fileLocale
	if err := json.Unmarshal(data, &updated); err == nil {
		summary.Progress, _, _ = fileProgress(cat, &updated)
	}
	return summary, nil
}

func sameFile(a, b string) bool {
	aa, err1 := filepath.Abs(a)
	bb, err2 := filepath.Abs(b)
	if err1 != nil || err2 != nil {
		return a == b
	}
	return strings.EqualFold(filepath.Clean(aa), filepath.Clean(bb))
}

// writeFileAtomic writes data next to path and renames it into place, so an
// interrupted write never leaves a half-written language file.
func writeFileAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	if dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	tmp, err := os.CreateTemp(dir, ".antigravity-i18n-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return err
	}
	if err := os.Rename(name, path); err != nil {
		os.Remove(name)
		return err
	}
	return nil
}
