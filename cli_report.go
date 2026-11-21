package main

import (
	"fmt"
	"sort"

	"antigravity-i18n/internal/core"
)

// printReport shows a language file check: every problem with its line, then
// how much of the current release the file translates.
func printReport(report *core.FileReport) {
	name := report.Name
	if name == "" {
		name = "(no name)"
	}
	fmt.Printf("Language file : %s\n", report.Path)
	fmt.Printf("Language      : %s %s\n", name, report.Language)
	errs := report.Errors()
	warnings := len(report.Issues) - len(errs)
	for _, issue := range report.Issues {
		label := "error"
		if issue.Severity == core.SeverityWarning {
			label = "warning"
		}
		fmt.Printf("  %-7s %s\n", label, issue.Describe())
	}
	printProgress(report.Progress)
	if report.MissingKeys > 0 {
		fmt.Printf("  %d strings of this Antigravity release are not in the file; run update-template to add them.\n",
			report.MissingKeys)
	}
	switch {
	case len(errs) > 0:
		fmt.Printf("Result        : %d error(s), %d warning(s); fix the errors before applying.\n", len(errs), warnings)
	case warnings > 0:
		fmt.Printf("Result        : ready to apply, %d warning(s).\n", warnings)
	default:
		fmt.Println("Result        : ready to apply.")
	}
}

func printProgress(p core.Progress) {
	fmt.Printf("Progress      : %d%% (%d of %d)\n", p.Percent, p.Done, p.Total)
	for _, s := range p.Sections {
		pct := 0
		if s.Total > 0 {
			pct = s.Done * 100 / s.Total
		}
		fmt.Printf("  %-10s %5d / %-5d %3d%%\n", s.Section, s.Done, s.Total, pct)
	}
}

func cliUpdateTemplate(svc *core.Service, path, out string) int {
	summary, err := svc.UpdateTemplate(path, out)
	if err != nil {
		return fail(err.Error())
	}
	fmt.Printf("Updated %s: %d new entries added", summary.Path, summary.AddedTotal)
	if summary.AddedTotal > 0 {
		fmt.Print(` (listed under "newEntries", their notes start with [NEW])`)
	}
	fmt.Println()
	if summary.BackupPath != "" {
		fmt.Printf("  Previous version kept at: %s\n", summary.BackupPath)
	}
	sections := make([]string, 0, len(summary.Obsolete))
	for s := range summary.Obsolete {
		sections = append(sections, s)
	}
	sort.Strings(sections)
	for _, s := range sections {
		fmt.Printf("  %d %s entries are no longer shown by Antigravity (listed under \"obsoleteEntries\")\n",
			summary.Obsolete[s], s)
	}
	printProgress(summary.Progress)
	return 0
}
