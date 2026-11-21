package core

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// The catalog is the list of English strings the current Antigravity release
// shows, in the order translators should see them. It is read from the
// reference locale (DefaultLocale): that pack is kept complete for the release
// this build targets, so its keys are the source strings and its pattern rules
// are the regexes every other language reuses. A translator only supplies text;
// they never have to write or touch a regular expression.

// catalogRule is a dynamic rule as a translator sees it.
type catalogRule struct {
	Rule PatternRule
	// Source is the English with each captured value replaced by {n}, derived
	// from the rule's own sample, so a translator sees what to translate
	// instead of the regex that recognises it.
	Source string
	// Groups is the number of capture groups, and so the placeholders a
	// translation must use.
	Groups int
}

type catalog struct {
	TextKeys   []string
	MenuKeys   []string
	DialogKeys []string
	PunctKeys  []string
	Rules      []catalogRule
	ruleByID   map[string]int

	ValueMapNames  []string
	ValueMapKeys   map[string][]string
	ValueRuleNames []string
	ValueRules     map[string][]ValueRule

	// Notes say where a text key shows up in the interface. They are generated
	// from the UI bundle by tools/ui-notes.js; a key without one simply has no
	// hint.
	Notes   map[string]string
	BasedOn string

	textSet map[string]bool
}

func (c *catalog) rule(id string) (catalogRule, bool) {
	i, ok := c.ruleByID[id]
	if !ok {
		return catalogRule{}, false
	}
	return c.Rules[i], true
}

// SetNotes installs the screen-location hints shown in exported templates.
// The data is the JSON written by tools/ui-notes.js.
func (s *LocaleStore) SetNotes(data []byte) error {
	var notes struct {
		GeneratedFrom string            `json:"generatedFrom"`
		Text          map[string]string `json:"text"`
	}
	if err := json.Unmarshal(data, &notes); err != nil {
		return fmt.Errorf("cannot read the screen-location notes: %w", err)
	}
	s.notesFrom = notes.GeneratedFrom
	s.notes = notes.Text
	s.catalogOnce = sync.Once{}
	return nil
}

// catalog builds the reference catalog once.
func (s *LocaleStore) catalog() (*catalog, error) {
	s.catalogOnce.Do(func() {
		s.catalogData, s.catalogErr = s.buildCatalog()
	})
	return s.catalogData, s.catalogErr
}

func (s *LocaleStore) buildCatalog() (*catalog, error) {
	raw, err := fs.ReadFile(s.localesFS, s.localeDir+"/"+DefaultLocale+".json")
	if err != nil {
		return nil, fmt.Errorf("the reference locale %s is missing: %w", DefaultLocale, err)
	}
	ref, err := s.LoadLocale(DefaultLocale)
	if err != nil {
		return nil, err
	}
	_, members, err := objectMembers(raw)
	if err != nil {
		return nil, fmt.Errorf("the reference locale %s is not valid JSON: %w", DefaultLocale, err)
	}
	c := &catalog{
		TextKeys:     objectKeys(members["text"]),
		MenuKeys:     objectKeys(members["menu"]),
		DialogKeys:   objectKeys(members["dialogs"]),
		PunctKeys:    objectKeys(members["punctuation"]),
		ruleByID:     map[string]int{},
		ValueMapKeys: map[string][]string{},
		ValueRules:   ref.ValueRules,
		Notes:        s.notes,
		BasedOn:      s.notesFrom,
		textSet:      map[string]bool{},
	}
	for _, k := range c.TextKeys {
		c.textSet[k] = true
	}
	if c.Notes == nil {
		c.Notes = map[string]string{}
	}
	c.ValueMapNames = objectKeys(members["valueMaps"])
	if raw, ok := members["valueMaps"]; ok {
		_, maps, err := objectMembers(raw)
		if err == nil {
			for _, name := range c.ValueMapNames {
				c.ValueMapKeys[name] = objectKeys(maps[name])
			}
		}
	}
	c.ValueRuleNames = objectKeys(members["valueRules"])
	for i, rule := range ref.Patterns {
		if rule.ID == "" {
			continue
		}
		source, groups := ruleSource(rule)
		c.ruleByID[rule.ID] = len(c.Rules)
		c.Rules = append(c.Rules, catalogRule{Rule: ref.Patterns[i], Source: source, Groups: groups})
	}
	return c, nil
}

// compileRule compiles a rule's regex with its JavaScript flags translated to
// RE2 syntax. Validation compiles the bare pattern because it only needs to
// know the regex is well formed; deriving a source string needs real matching.
func compileRule(pattern, flags string) (*regexp.Regexp, error) {
	prefix := ""
	for _, f := range flags {
		switch f {
		case 'i', 'm', 's':
			prefix += string(f)
		}
	}
	if prefix != "" {
		pattern = "(?" + prefix + ")" + pattern
	}
	return regexp.Compile(pattern)
}

// ruleSource turns a rule's sample into its English source with placeholders:
// the sample "Thought for 5s" under ^Thought for (\d+)(s|m)$ becomes
// "Thought for {1}{2}". Nested groups are covered by their outer group.
func ruleSource(rule PatternRule) (string, int) {
	groups := jsCaptureGroups(rule.Pattern)
	re, err := compileRule(rule.Pattern, rule.Flags)
	if err != nil {
		return rule.Sample, groups
	}
	loc := re.FindStringSubmatchIndex(rule.Sample)
	if loc == nil {
		return rule.Sample, groups
	}
	type span struct{ start, end, n int }
	var spans []span
	for g := 1; g*2+1 < len(loc); g++ {
		if loc[g*2] < 0 {
			continue
		}
		spans = append(spans, span{loc[g*2], loc[g*2+1], g})
	}
	sort.SliceStable(spans, func(i, j int) bool { return spans[i].start < spans[j].start })
	var b strings.Builder
	at := 0
	for _, sp := range spans {
		if sp.start < at {
			continue // nested inside the previous group
		}
		b.WriteString(rule.Sample[at:sp.start])
		b.WriteString("{" + strconv.Itoa(sp.n) + "}")
		at = sp.end
	}
	b.WriteString(rule.Sample[at:])
	return b.String(), groups
}

// placeholderCounts tallies the {n} placeholders in s.
func placeholderCounts(s string) map[int]int {
	out := map[int]int{}
	for _, m := range templatePlaceholderRe.FindAllStringSubmatch(s, -1) {
		n, _ := strconv.Atoi(m[1])
		out[n]++
	}
	return out
}

// inlineMarker stands for an inline element inside a joined sentence.
const inlineMarker = "<>"
