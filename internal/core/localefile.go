package core

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// An external language file is a locale JSON the user wrote or filled in from
// an exported template. It is checked far more forgivingly than a bundled
// pack: anything left empty is simply untranslated and stays English, and
// pattern rules name a reference rule by id instead of carrying a regex. What
// is not forgiven is a translation that would break the interface: a lost {n}
// drops a value from the sentence, and a lost <> marker means the sentence
// cannot be written back into the elements it came from.

// Issue codes, so the window can phrase each problem in its own language.
const (
	IssueJSON         = "json"         // the file is not valid JSON
	IssueType         = "type"         // a field holds the wrong kind of value
	IssueMeta         = "meta"         // language or name is missing or malformed
	IssueMarkers      = "markers"      // the number of <> markers differs from the source
	IssuePlaceholders = "placeholders" // {n} placeholders are missing or unknown
	IssueUnknownRule  = "unknownRule"  // a rule id this release does not have
	IssueEmpty        = "empty"        // nothing is translated yet
	IssueInvalid      = "invalid"      // the assembled locale failed full validation
)

// Issue severities. Only errors block an apply.
const (
	SeverityError   = "error"
	SeverityWarning = "warning"
)

// Issue is one problem found in a language file.
type Issue struct {
	Severity string   `json:"severity"`
	Code     string   `json:"code"`
	Section  string   `json:"section"`
	Key      string   `json:"key"`
	Line     int      `json:"line"`
	Want     int      `json:"want"`
	Got      int      `json:"got"`
	Missing  []string `json:"missing"`
	Extra    []string `json:"extra"`
	Message  string   `json:"message"`
}

// SectionProgress is how much of one part of the catalog a file translates.
type SectionProgress struct {
	Section string `json:"section"`
	Done    int    `json:"done"`
	Total   int    `json:"total"`
}

// Progress is a file's translation coverage of the current catalog.
type Progress struct {
	Sections []SectionProgress `json:"sections"`
	Done     int               `json:"done"`
	Total    int               `json:"total"`
	Percent  int               `json:"percent"`
}

// FileReport is the result of checking a language file.
type FileReport struct {
	Path     string   `json:"path"`
	Language string   `json:"language"`
	Name     string   `json:"name"`
	OK       bool     `json:"ok"`
	Issues   []Issue  `json:"issues"`
	Progress Progress `json:"progress"`
	// MissingKeys counts catalog entries the file does not list at all, which
	// means it was made for an older release; update-template adds them.
	MissingKeys int `json:"missingKeys"`
	// UnknownKeys counts entries the current release no longer shows.
	UnknownKeys int `json:"unknownKeys"`
}

func (r *FileReport) add(issue Issue) {
	if issue.Severity == "" {
		issue.Severity = SeverityError
	}
	r.Issues = append(r.Issues, issue)
}

// Errors returns the blocking issues.
func (r *FileReport) Errors() []Issue {
	var out []Issue
	for _, i := range r.Issues {
		if i.Severity == SeverityError {
			out = append(out, i)
		}
	}
	return out
}

// LocaleFileError is returned when a language file cannot be applied.
type LocaleFileError struct {
	Report *FileReport
}

func (e *LocaleFileError) Error() string {
	errs := e.Report.Errors()
	var b strings.Builder
	fmt.Fprintf(&b, "the language file %s has %d problem(s):", e.Report.Path, len(errs))
	for i, issue := range errs {
		if i == 10 {
			fmt.Fprintf(&b, "\n  ... and %d more", len(errs)-10)
			break
		}
		b.WriteString("\n  ")
		b.WriteString(issue.Describe())
	}
	return b.String()
}

// Describe renders an issue as one English line.
func (i Issue) Describe() string {
	where := i.Section
	if i.Key != "" {
		where += " \"" + truncate(i.Key, 60) + "\""
	}
	if i.Line > 0 {
		where = fmt.Sprintf("line %d, %s", i.Line, where)
	}
	if where == "" {
		return i.Message
	}
	return where + ": " + i.Message
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

// fileLocale is a language file as written, before anything is filled in
// from the catalog.
type fileLocale struct {
	Language                string                       `json:"language"`
	Name                    string                       `json:"name"`
	EnglishName             string                       `json:"englishName"`
	HTMLLang                string                       `json:"htmlLang"`
	ChromiumLang            string                       `json:"chromiumLang"`
	Dir                     string                       `json:"dir"`
	PluralLocale            string                       `json:"pluralLocale"`
	Punctuation             map[string]string            `json:"punctuation"`
	PunctuationSkipSuffixes []string                     `json:"punctuationSkipSuffixes"`
	Text                    map[string]string            `json:"text"`
	Menu                    map[string]string            `json:"menu"`
	Dialogs                 map[string]string            `json:"dialogs"`
	ValueMaps               map[string]map[string]string `json:"valueMaps"`
	ValueRules              map[string][]fileValueRule   `json:"valueRules"`
	Patterns                []filePattern                `json:"patterns"`
	AllowSourceEqual        []string                     `json:"allowSourceEqual"`
}

type fileValueRule struct {
	Pattern  string `json:"pattern"`
	Match    string `json:"match"`
	Flags    string `json:"flags"`
	Template string `json:"template"`
}

type filePattern struct {
	ID          string            `json:"id"`
	Pattern     string            `json:"pattern"`
	Flags       string            `json:"flags"`
	Scope       string            `json:"scope"`
	Template    string            `json:"template"`
	Templates   map[string]string `json:"templates"`
	Sample      string            `json:"sample"`
	Example     string            `json:"example"`
	Source      string            `json:"source"`
	PluralGroup *int              `json:"pluralGroup"`
	Replace     map[string]string `json:"replace"`
	TrimGroups  []int             `json:"trimGroups"`
}

func (p filePattern) translated() bool {
	if strings.TrimSpace(p.Template) != "" {
		return true
	}
	for _, v := range p.Templates {
		if strings.TrimSpace(v) != "" {
			return true
		}
	}
	return false
}

var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

// parseLocaleFile decodes raw, reporting JSON problems with a line number.
func parseLocaleFile(raw []byte, report *FileReport) (*fileLocale, bool) {
	raw = bytes.TrimPrefix(raw, utf8BOM)
	var file fileLocale
	if err := json.Unmarshal(raw, &file); err != nil {
		var syntax *json.SyntaxError
		var typeErr *json.UnmarshalTypeError
		switch {
		case errors.As(err, &syntax):
			line, col := lineCol(raw, int(syntax.Offset))
			report.add(Issue{Code: IssueJSON, Section: "file", Line: line,
				Message: fmt.Sprintf("not valid JSON at line %d, column %d: %v", line, col, syntax)})
		case errors.As(err, &typeErr):
			line, _ := lineCol(raw, int(typeErr.Offset))
			report.add(Issue{Code: IssueType, Section: typeErr.Field, Line: line,
				Message: fmt.Sprintf("'%s' must be %s, not %s", typeErr.Field, describeGoType(typeErr.Type.String()), typeErr.Value)})
		default:
			report.add(Issue{Code: IssueJSON, Section: "file", Message: err.Error()})
		}
		return nil, false
	}
	return &file, true
}

func describeGoType(t string) string {
	switch {
	case strings.HasPrefix(t, "map["):
		return "an object"
	case strings.HasPrefix(t, "[]"):
		return "an array"
	case t == "string":
		return "a string"
	case t == "int", t == "*int":
		return "a number"
	}
	return t
}

func lineCol(raw []byte, offset int) (int, int) {
	if offset > len(raw) {
		offset = len(raw)
	}
	if offset < 0 {
		offset = 0
	}
	before := raw[:offset]
	line := bytes.Count(before, []byte("\n")) + 1
	col := offset - bytes.LastIndexByte(before, '\n')
	return line, col
}

// keyLine finds the line a key is written on inside a section, or 0.
func keyLine(raw []byte, section, key string) int {
	start := 0
	if loc := regexp.MustCompile(`"` + regexp.QuoteMeta(section) + `"\s*:`).FindIndex(raw); loc != nil {
		start = loc[1]
	}
	// A key may be written literally or with <, > and & escaped as < and
	// friends, which is how Go and some editors save JSON.
	if line := findKeyLine(raw, start, jsonString(key)); line > 0 {
		return line
	}
	escaped, _ := json.Marshal(key)
	return findKeyLine(raw, start, escaped)
}

func findKeyLine(raw []byte, start int, needle []byte) int {
	for at := start; at < len(raw); {
		i := bytes.Index(raw[at:], needle)
		if i < 0 {
			return 0
		}
		end := at + i + len(needle)
		rest := bytes.TrimLeft(raw[end:], " \t\r\n")
		if len(rest) > 0 && rest[0] == ':' {
			line, _ := lineCol(raw, at+i)
			return line
		}
		at = end
	}
	return 0
}

func ruleLine(raw []byte, id string) int {
	loc := regexp.MustCompile(`"id"\s*:\s*` + regexp.QuoteMeta(string(jsonString(id)))).FindIndex(raw)
	if loc == nil {
		return 0
	}
	line, _ := lineCol(raw, loc[0])
	return line
}

// checkSentence compares the markers and placeholders of a translation with
// its source. groups is the number of capture groups a rule has, or -1 for a
// plain text entry, where the source's own placeholders are the reference.
func checkSentence(source, translation string, groups int) (markers bool, missing, extra []string) {
	markers = strings.Count(source, inlineMarker) == strings.Count(translation, inlineMarker)
	got := placeholderCounts(translation)
	want := map[int]int{}
	if groups < 0 {
		want = placeholderCounts(source)
	} else {
		for g := 1; g <= groups; g++ {
			want[g] = 1
		}
	}
	for _, n := range sortedIntKeys(want) {
		if got[n] < want[n] {
			missing = append(missing, "{"+strconv.Itoa(n)+"}")
		}
	}
	for _, n := range sortedIntKeys(got) {
		if want[n] == 0 || (groups < 0 && got[n] > want[n]) {
			extra = append(extra, "{"+strconv.Itoa(n)+"}")
		}
	}
	return markers, missing, extra
}

func sortedIntKeys(m map[int]int) []int {
	out := make([]int, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Ints(out)
	return out
}

// checkMissing reports only placeholders the translation leaves out.
func (r *FileReport) checkMissing(raw []byte, section, key, source, translation string, groups int, line int) bool {
	_, missing, _ := checkSentence(source, translation, groups)
	if len(missing) == 0 {
		return true
	}
	if line == 0 {
		line = keyLine(raw, section, key)
	}
	r.add(Issue{Code: IssuePlaceholders, Section: section, Key: key, Line: line, Missing: missing,
		Message: "placeholders do not match the source: missing " + strings.Join(missing, " ")})
	return false
}

// checkTranslation reports lost or extra <> markers and {n} placeholders.
// allowMissing skips the missing-placeholder check, for one plural form.
func (r *FileReport) checkTranslation(raw []byte, section, key, source, translation string, groups int, line int, allowMissing bool) bool {
	markers, missing, extra := checkSentence(source, translation, groups)
	if allowMissing {
		missing = nil
	}
	ok := true
	if line == 0 {
		line = keyLine(raw, section, key)
	}
	if !markers {
		r.add(Issue{Code: IssueMarkers, Section: section, Key: key, Line: line,
			Want: strings.Count(source, inlineMarker), Got: strings.Count(translation, inlineMarker),
			Message: fmt.Sprintf("the source has %d <> marker(s) but the translation has %d; keep every <> in order",
				strings.Count(source, inlineMarker), strings.Count(translation, inlineMarker))})
		ok = false
	}
	if len(missing) > 0 || len(extra) > 0 {
		var parts []string
		if len(missing) > 0 {
			parts = append(parts, "missing "+strings.Join(missing, " "))
		}
		if len(extra) > 0 {
			parts = append(parts, "unknown "+strings.Join(extra, " "))
		}
		r.add(Issue{Code: IssuePlaceholders, Section: section, Key: key, Line: line, Missing: missing, Extra: extra,
			Message: "placeholders do not match the source: " + strings.Join(parts, ", ")})
		ok = false
	}
	return ok
}

func nonEmpty(m map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range m {
		if strings.TrimSpace(v) != "" {
			out[k] = v
		}
	}
	return out
}

// CheckLocaleData checks a language file and, when it has no blocking issue,
// returns the locale it describes with every rule filled in from the catalog.
func (s *LocaleStore) CheckLocaleData(path string, raw []byte) (*Locale, *FileReport, error) {
	report := &FileReport{Path: path}
	cat, err := s.catalog()
	if err != nil {
		return nil, nil, err
	}
	raw = bytes.TrimPrefix(raw, utf8BOM)
	file, ok := parseLocaleFile(raw, report)
	if !ok {
		return nil, report, nil
	}
	report.Language = file.Language
	report.Name = file.Name

	// Metadata. 'language' ends up as <html lang> and in the status report, so
	// a template whose fields are still empty is caught here.
	switch {
	case strings.TrimSpace(file.Language) == "":
		report.add(Issue{Code: IssueMeta, Section: "language", Line: keyLine(raw, "language", "language"),
			Message: "set 'language' to a language code such as fr, de or pt-BR"})
	case !LocaleCodeRe.MatchString(file.Language):
		report.add(Issue{Code: IssueMeta, Section: "language", Line: keyLine(raw, "language", "language"),
			Message: fmt.Sprintf("'%s' is not a language code; use a code such as fr, de or pt-BR", file.Language)})
	case CanonicalLocale(file.Language) == EnglishLocale:
		report.add(Issue{Code: IssueMeta, Section: "language", Line: keyLine(raw, "language", "language"),
			Message: "'en' is the official build; pick another code for a translation"})
	}
	if strings.TrimSpace(file.Name) == "" {
		report.add(Issue{Code: IssueMeta, Section: "name", Line: keyLine(raw, "name", "name"),
			Message: "set 'name' to the language's own name, for example Français"})
	}

	loc := &Locale{
		Language:                strings.TrimSpace(file.Language),
		Name:                    strings.TrimSpace(file.Name),
		EnglishName:             strings.TrimSpace(file.EnglishName),
		HTMLLang:                strings.TrimSpace(file.HTMLLang),
		ChromiumLang:            strings.TrimSpace(file.ChromiumLang),
		Dir:                     strings.TrimSpace(file.Dir),
		PluralLocale:            strings.TrimSpace(file.PluralLocale),
		Text:                    map[string]string{},
		Menu:                    nonEmpty(file.Menu),
		Dialogs:                 nonEmpty(file.Dialogs),
		Punctuation:             nonEmpty(file.Punctuation),
		PunctuationSkipSuffixes: file.PunctuationSkipSuffixes,
		ValueMaps:               map[string]map[string]string{},
		ValueRules:              map[string][]ValueRule{},
		AllowSourceEqual:        file.AllowSourceEqual,
	}

	// Text, in document order so issues read top to bottom.
	textOrder := objectKeys(sectionRaw(raw, "text"))
	if len(textOrder) == 0 {
		textOrder = sortedKeys(file.Text)
	}
	for _, key := range textOrder {
		value, ok := file.Text[key]
		if !ok || strings.TrimSpace(value) == "" {
			continue
		}
		if report.checkTranslation(raw, "text", key, key, value, -1, 0, false) {
			loc.Text[key] = value
		}
	}

	for name, m := range file.ValueMaps {
		loc.ValueMaps[name] = nonEmpty(m)
	}
	for _, name := range sortedMapKeys(file.ValueRules) {
		for index, rule := range file.ValueRules[name] {
			if strings.TrimSpace(rule.Template) == "" {
				continue
			}
			pattern, flags := rule.Pattern, rule.Flags
			if pattern == "" {
				refRules := cat.ValueRules[name]
				if index >= len(refRules) {
					report.add(Issue{Severity: SeverityWarning, Code: IssueUnknownRule,
						Section: "valueRules." + name, Key: strconv.Itoa(index + 1),
						Message: "this release has no such value rule; it is skipped"})
					continue
				}
				pattern, flags = refRules[index].Pattern, refRules[index].Flags
			}
			loc.ValueRules[name] = append(loc.ValueRules[name], ValueRule{Pattern: pattern, Flags: flags, Template: rule.Template})
		}
	}

	for _, entry := range file.Patterns {
		if !entry.translated() {
			continue
		}
		var rule PatternRule
		if entry.Pattern != "" {
			// A complete rule, as in a bundled pack. It is the author's own
			// regex, so the full validator below is what checks it.
			sample := entry.Sample
			if sample == "" {
				sample = entry.Example
			}
			rule = PatternRule{ID: entry.ID, Pattern: entry.Pattern, Flags: entry.Flags, Scope: entry.Scope,
				Template: entry.Template, Templates: entry.Templates, Sample: sample,
				PluralGroup: entry.PluralGroup, Replace: entry.Replace, TrimGroups: entry.TrimGroups}
		} else {
			ref, ok := cat.rule(entry.ID)
			if !ok {
				report.add(Issue{Severity: SeverityWarning, Code: IssueUnknownRule, Section: "patterns", Key: entry.ID,
					Line: ruleLine(raw, entry.ID), Message: "this release has no rule with this id; it is skipped"})
				continue
			}
			rule = ref.Rule
			rule.Template, rule.Templates = "", nil
			line := ruleLine(raw, entry.ID)
			good := true
			if forms := nonEmpty(entry.Templates); len(forms) > 0 {
				rule.Templates = forms
				// One plural form may legitimately leave the count out ("one
				// file"), so each form is checked for markers and unknown
				// placeholders, and only the forms together must use every value.
				for _, form := range sortedMapKeys(forms) {
					good = report.checkTranslation(raw, "patterns", entry.ID, ref.Source, forms[form], ref.Groups, line, true) && good
				}
				if good {
					good = report.checkMissing(raw, "patterns", entry.ID, ref.Source, strings.Join(sortedValues(forms), " "), ref.Groups, line)
				}
			} else {
				rule.Template = entry.Template
				good = report.checkTranslation(raw, "patterns", entry.ID, ref.Source, entry.Template, ref.Groups, line, false)
			}
			if !good {
				continue
			}
		}
		// A rule may translate a captured word through a table the file did
		// not fill in; an empty table leaves that word in English instead of
		// failing the whole file.
		for _, name := range sortedMapKeys(rule.Replace) {
			_, isMap := loc.ValueMaps[name]
			_, isRule := loc.ValueRules[name]
			if isMap || isRule {
				continue
			}
			if _, ok := cat.ValueRules[name]; ok {
				loc.ValueRules[name] = []ValueRule{}
			} else {
				loc.ValueMaps[name] = map[string]string{}
			}
		}
		loc.Patterns = append(loc.Patterns, rule)
	}

	// The engine uses the first rule that matches, and the catalog's order is
	// the one the rules were tested in (specific before general). A file may
	// list them in any order, so catalog rules are put back in that order. A
	// rule of the author's own comes first, so it can override a built-in one.
	rank := func(r PatternRule) int {
		if i, ok := cat.ruleByID[r.ID]; ok && r.ID != "" {
			return i
		}
		return -1
	}
	sort.SliceStable(loc.Patterns, func(i, j int) bool { return rank(loc.Patterns[i]) < rank(loc.Patterns[j]) })

	report.Progress, report.MissingKeys, report.UnknownKeys = fileProgress(cat, file)

	if len(report.Errors()) == 0 {
		if len(loc.Text) == 0 {
			report.add(Issue{Code: IssueEmpty, Section: "text",
				Message: "no text is translated yet; fill in at least one entry under 'text'"})
		} else if err := validateLocale(loc.Language, loc); err != nil {
			report.add(Issue{Code: IssueInvalid, Section: "file", Message: err.Error()})
		}
	}
	report.OK = len(report.Errors()) == 0
	if !report.OK {
		return nil, report, nil
	}
	return loc, report, nil
}

func sortedValues(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for _, k := range sortedMapKeys(m) {
		out = append(out, m[k])
	}
	return out
}

// sectionRaw returns the raw JSON of one top-level member, or nil.
func sectionRaw(raw []byte, name string) json.RawMessage {
	_, members, err := objectMembers(bytes.TrimPrefix(raw, utf8BOM))
	if err != nil {
		return nil
	}
	return members[name]
}

// fileProgress measures a file against the catalog. Only entries the current
// release actually shows count, so a file full of obsolete keys does not look
// complete.
func fileProgress(cat *catalog, file *fileLocale) (Progress, int, int) {
	var p Progress
	missing, unknown := 0, 0
	section := func(name string, keys []string, values map[string]string) {
		if len(keys) == 0 {
			return
		}
		sp := SectionProgress{Section: name, Total: len(keys)}
		known := map[string]bool{}
		for _, k := range keys {
			known[k] = true
			v, ok := values[k]
			if !ok {
				missing++
				continue
			}
			if strings.TrimSpace(v) != "" {
				sp.Done++
			}
		}
		for k := range values {
			if !known[k] {
				unknown++
			}
		}
		p.Sections = append(p.Sections, sp)
	}
	section("text", cat.TextKeys, file.Text)
	section("menu", cat.MenuKeys, file.Menu)
	section("dialogs", cat.DialogKeys, file.Dialogs)

	if len(cat.Rules) > 0 {
		byID := map[string]filePattern{}
		for _, e := range file.Patterns {
			if e.ID != "" {
				byID[e.ID] = e
			}
		}
		sp := SectionProgress{Section: "patterns", Total: len(cat.Rules)}
		for _, r := range cat.Rules {
			e, ok := byID[r.Rule.ID]
			if !ok {
				missing++
				continue
			}
			if e.translated() {
				sp.Done++
			}
		}
		for id, e := range byID {
			if _, ok := cat.rule(id); !ok && e.Pattern == "" {
				unknown++
			}
		}
		p.Sections = append(p.Sections, sp)
	}

	vm := SectionProgress{Section: "valueMaps"}
	for _, name := range cat.ValueMapNames {
		for _, k := range cat.ValueMapKeys[name] {
			if k == "" {
				continue // an empty source word needs no translation
			}
			vm.Total++
			v, ok := file.ValueMaps[name][k]
			if !ok {
				missing++
				continue
			}
			if strings.TrimSpace(v) != "" {
				vm.Done++
			}
		}
	}
	if vm.Total > 0 {
		p.Sections = append(p.Sections, vm)
	}

	for _, sp := range p.Sections {
		p.Done += sp.Done
		p.Total += sp.Total
	}
	if p.Total > 0 {
		p.Percent = p.Done * 100 / p.Total
	}
	return p, missing, unknown
}

// CheckLocaleFile reads and checks a language file without applying it.
func (s *Service) CheckLocaleFile(path string) (*FileReport, error) {
	_, report, err := s.loadLocaleFile(path)
	if report != nil {
		return report, nil
	}
	return nil, err
}

func (s *Service) loadLocaleFile(path string) (*Locale, *FileReport, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, fmt.Errorf("cannot read the language file: %w", err)
	}
	return s.store.CheckLocaleData(path, raw)
}
