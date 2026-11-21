package main

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"

	"antigravity-i18n/internal/core"
)

const usage = `antigravity-i18n-pro - localize the Antigravity desktop interface

Usage:
  antigravity-i18n-pro [command] [options]

Commands:
  apply            Install a language pack or a language file into Antigravity
  restore          Restore the official English version
  reapply          Apply the last language again (after an Antigravity update)
  status           Report the current localization state
  locales          List the bundled language packs
  check            Check a language file and show its translation progress
  export-template  Write a translation template with every English string
  update-template  Add new English strings to an existing language file
  gui              Open the graphical interface (default when no command is given)

Shorthands:
  tw                     Same as: apply --locale zh-TW
  zh, cn, chinese        Same as: apply --locale zh-CN
  en, english, official  Same as: restore

Options:
  --app-dir <path>      Antigravity installation directory
  --locale <code>       Language pack to install (default: zh-TW)
  --locale-file <path>  External language file (apply, check, update-template)
  --out <path>          Output file (export-template; update-template writes in place by default)
  --from <code>         Prefill an exported template from a bundled pack
  --if-needed           reapply: do nothing unless an update removed the language
  --no-restart          Do not relaunch Antigravity afterwards
  --force               Skip the graceful shutdown and force Antigravity to close
  --timeout <ms>        Positive milliseconds to wait for a graceful shutdown (default: 30000)
  --yes                 Assume yes for the shutdown confirmation
  -h, --help            Show this help
  -v, --version         Show the tool version
`

// commandAliases fold the language-named shorthands the Node CLI shipped onto
// the two generic verbs, so documented one-liners like "antigravity-i18n zh"
// keep working after the rewrite. applyAliases name a locale of their own;
// restoreAliases all mean the same thing and need no locale.
var applyAliases = map[string]string{
	"tw":      "zh-TW",
	"zh":      "zh-CN",
	"cn":      "zh-CN",
	"chinese": "zh-CN",
}

var restoreAliases = map[string]bool{
	"en":       true,
	"english":  true,
	"official": true,
}

// localeFlagValue returns the value of --locale or --locale=... in args.
func localeFlagValue(args []string) (string, bool) {
	for i := 0; i < len(args); i++ {
		switch {
		case args[i] == "--locale" && i+1 < len(args):
			return args[i+1], true
		case strings.HasPrefix(args[i], "--locale="):
			return strings.TrimPrefix(args[i], "--locale="), true
		}
	}
	return "", false
}

// sameLocale compares locale spellings the way the store resolves them, so
// "zh", "ZH" and "zh-CN" are not treated as a conflict. It delegates to the
// core so the parser and the loader cannot drift apart.
func sameLocale(a, b string) bool {
	return core.CanonicalLocale(a) == core.CanonicalLocale(b)
}

// parsedArgs is one command line after parsing.
type parsedArgs struct {
	cmd      string
	opts     core.Options
	confirm  bool
	out      string
	from     string
	ifNeeded bool
}

// parseArgs turns raw arguments into a command and its options.
//
// It is separate from runCLI so the shorthand and conflict rules can be tested
// without starting Antigravity, closing a running instance, or touching a real
// installation.
func parseArgs(args []string) (*parsedArgs, error) {
	cmd := strings.ToLower(args[0])
	rest := args[1:]

	// -v and -h are recognized before any command name so that
	// "antigravity-i18n -v" works without a subcommand; otherwise the flag is
	// mistaken for a command and reported as unknown.
	switch cmd {
	case "-v", "--version":
		return &parsedArgs{cmd: "version"}, nil
	case "-h", "--help":
		return &parsedArgs{cmd: "help"}, nil
	}

	out := &parsedArgs{opts: core.Options{Restart: true}}

	// A shorthand names its own locale. Combining one with a conflicting
	// --locale would leave the user guessing which of the two wins, so it is
	// refused rather than silently resolved.
	aliasLocale, isApplyAlias := applyAliases[cmd]
	if isApplyAlias {
		if requested, ok := localeFlagValue(rest); ok && !sameLocale(requested, aliasLocale) {
			return nil, fmt.Errorf("command %q already means --locale %s; drop one of them", cmd, aliasLocale)
		}
		out.opts.Locale = aliasLocale
		cmd = "apply"
	} else if restoreAliases[cmd] {
		if requested, ok := localeFlagValue(rest); ok && !sameLocale(requested, core.EnglishLocale) {
			return nil, fmt.Errorf("command %q already means restore; drop --locale or use apply", cmd)
		}
		cmd = "restore"
	}

	for i := 0; i < len(rest); i++ {
		arg := rest[i]
		switch {
		case arg == "-h" || arg == "--help":
			return &parsedArgs{cmd: "help"}, nil
		case arg == "-v" || arg == "--version":
			return &parsedArgs{cmd: "version"}, nil
		case arg == "--app-dir":
			if i+1 >= len(rest) {
				return nil, errors.New("--app-dir needs a path")
			}
			i++
			out.opts.AppDir = rest[i]
		case arg == "--locale":
			if i+1 >= len(rest) {
				return nil, errors.New("--locale needs a language code")
			}
			i++
			out.opts.Locale = rest[i]
		case arg == "--locale-file":
			if i+1 >= len(rest) {
				return nil, errors.New("--locale-file needs a path")
			}
			i++
			out.opts.LocaleFile = rest[i]
		case arg == "--out":
			if i+1 >= len(rest) {
				return nil, errors.New("--out needs a path")
			}
			i++
			out.out = rest[i]
		case arg == "--from":
			if i+1 >= len(rest) {
				return nil, errors.New("--from needs a language code")
			}
			i++
			out.from = rest[i]
		case arg == "--if-needed":
			out.ifNeeded = true
		case strings.HasPrefix(arg, "--locale-file="):
			out.opts.LocaleFile = strings.TrimPrefix(arg, "--locale-file=")
		case strings.HasPrefix(arg, "--out="):
			out.out = strings.TrimPrefix(arg, "--out=")
		case strings.HasPrefix(arg, "--from="):
			out.from = strings.TrimPrefix(arg, "--from=")
		case arg == "--no-restart":
			out.opts.Restart = false
		case arg == "--force":
			out.opts.Force = true
		case arg == "--yes" || arg == "-y":
			out.confirm = true
		case arg == "--timeout":
			if i+1 >= len(rest) {
				return nil, errors.New("--timeout needs a number of milliseconds")
			}
			i++
			ms, err := strconv.Atoi(rest[i])
			if err != nil || ms <= 0 {
				return nil, errors.New("--timeout needs a positive integer number of milliseconds within the supported integer range")
			}
			out.opts.TimeoutMs = ms
		case strings.HasPrefix(arg, "--app-dir="):
			out.opts.AppDir = strings.TrimPrefix(arg, "--app-dir=")
		case strings.HasPrefix(arg, "--locale="):
			out.opts.Locale = strings.TrimPrefix(arg, "--locale=")
		case strings.HasPrefix(arg, "--timeout="):
			ms, err := strconv.Atoi(strings.TrimPrefix(arg, "--timeout="))
			if err != nil || ms <= 0 {
				return nil, errors.New("--timeout needs a positive integer number of milliseconds within the supported integer range")
			}
			out.opts.TimeoutMs = ms
		case strings.HasPrefix(arg, "-"):
			return nil, fmt.Errorf("unknown option %q", arg)
		default:
			return nil, fmt.Errorf("unexpected argument %q", arg)
		}
	}

	switch cmd {
	case "apply", "restore", "status", "locales", "gui", "reapply", "export-template":
	case "check", "update-template":
		if out.opts.LocaleFile == "" {
			return nil, fmt.Errorf("%s needs --locale-file <path>", cmd)
		}
	default:
		return nil, fmt.Errorf("unknown command %q", cmd)
	}
	if cmd == "export-template" && out.out == "" {
		return nil, errors.New("export-template needs --out <path>")
	}
	if cmd == "apply" && out.opts.LocaleFile != "" && out.opts.Locale != "" {
		return nil, errors.New("use either --locale or --locale-file, not both")
	}
	out.cmd = cmd
	return out, nil
}

// runCLI returns the process exit code.
func runCLI(svc *core.Service, args []string) int {
	parsed, err := parseArgs(args)
	if err != nil {
		return fail(err.Error() + "\n\n" + usage)
	}
	cmd, opts, confirm := parsed.cmd, parsed.opts, parsed.confirm

	switch cmd {
	case "version":
		fmt.Println("antigravity-i18n-pro " + core.Version)
		return 0
	case "help":
		fmt.Print(usage)
		return 0
	}

	// One progress sink drives both the console and the window: the CLI prints
	// stages, the GUI emits them as events. Wiring it into the service rather
	// than Options is what makes the GUI advance instead of sitting on a
	// hardcoded sentence while a 4 MB archive is rewritten.
	svc.Progress = func(stage, detail string) {
		if detail != "" {
			fmt.Printf("  %s: %s\n", stage, detail)
			return
		}
		fmt.Printf("  %s\n", stage)
	}

	switch cmd {
	case "apply":
		// English is not a language pack; it is the untranslated build that
		// restore reinstalls. The GUI routes a pick of English to restore, so
		// the CLI does the same instead of failing on an unknown locale.
		if opts.LocaleFile == "" && opts.Locale != "" && sameLocale(opts.Locale, core.EnglishLocale) {
			return cliRestore(svc, opts, confirm)
		}
		if opts.LocaleFile != "" {
			// A broken file is reported before anyone is asked to close
			// Antigravity for it.
			report, err := svc.CheckLocaleFile(opts.LocaleFile)
			if err != nil {
				return fail(err.Error())
			}
			printReport(report)
			if !report.OK {
				return 1
			}
		}
		return cliApply(svc, opts, confirm)
	case "reapply":
		return cliReapply(svc, opts, confirm, parsed.ifNeeded)
	case "check":
		report, err := svc.CheckLocaleFile(opts.LocaleFile)
		if err != nil {
			return fail(err.Error())
		}
		printReport(report)
		if !report.OK {
			return 1
		}
		return 0
	case "export-template":
		summary, err := svc.ExportTemplate(parsed.out, parsed.from)
		if err != nil {
			return fail(err.Error())
		}
		fmt.Printf("Wrote a translation template with %d entries to %s\n", summary.Entries, summary.Path)
		return 0
	case "update-template":
		return cliUpdateTemplate(svc, opts.LocaleFile, parsed.out)
	case "restore":
		return cliRestore(svc, opts, confirm)
	case "status":
		return cliStatus(svc, opts)
	case "locales":
		return cliLocales(svc)
	case "gui":
		runWails(svc)
		return 0
	default:
		return fail(fmt.Sprintf("unknown command %q\n\n%s", cmd, usage))
	}
}

func cliApply(svc *core.Service, opts core.Options, confirmed bool) int {
	if !confirmed {
		if !confirmShutdown("Applying a language pack rewrites app.asar and Antigravity must not be running.") {
			return 1
		}
	}
	result, err := svc.ApplyLocale(opts)
	for _, note := range svc.Notes() {
		fmt.Println("  note:", note)
	}
	if err != nil {
		return fail(err.Error())
	}
	fmt.Printf("Successfully switched to %s (%s)\n", result.LocaleName, result.Locale)
	fmt.Printf("  Backup saved at: %s\n", result.BackupPath)
	if opts.Restart {
		if result.Relaunched {
			fmt.Println("  Antigravity has been relaunched.")
		} else {
			fmt.Println("  Could not relaunch Antigravity. Open it manually.")
		}
	}
	return 0
}

func cliReapply(svc *core.Service, opts core.Options, confirmed, ifNeeded bool) int {
	hint, err := svc.GetReapplyHint(opts.AppDir)
	if err != nil {
		return fail(err.Error())
	}
	if hint.Locale == "" || sameLocale(hint.Locale, core.EnglishLocale) {
		if ifNeeded {
			fmt.Println("Nothing to reapply: no translation has been applied with this tool.")
			return 0
		}
		return fail(core.ErrNothingRemembered.Error())
	}
	if ifNeeded && !hint.Needed {
		fmt.Printf("Antigravity still shows %s; nothing to do.\n", hint.Locale)
		return 0
	}
	if hint.FileMissing {
		return fail("the remembered language file is missing: " + hint.LocaleFile)
	}
	if !confirmed {
		if !confirmShutdown(fmt.Sprintf("Reapplying %s rewrites app.asar and Antigravity must not be running.", hint.Locale)) {
			return 1
		}
	}
	result, err := svc.Reapply(opts)
	for _, note := range svc.Notes() {
		fmt.Println("  note:", note)
	}
	if err != nil {
		return fail(err.Error())
	}
	fmt.Printf("Successfully reapplied %s (%s)\n", result.LocaleName, result.Locale)
	return 0
}

func cliRestore(svc *core.Service, opts core.Options, confirmed bool) int {
	if !confirmed {
		if !confirmShutdown("Restoring the English version rewrites app.asar and Antigravity must not be running.") {
			return 1
		}
	}
	result, err := svc.RestoreOfficial(opts)
	for _, note := range svc.Notes() {
		fmt.Println("  note:", note)
	}
	if err != nil {
		return fail(err.Error())
	}
	if result.AlreadyEnglish {
		fmt.Println("Antigravity is already using the official English archive.")
		return 0
	}
	fmt.Println("Successfully switched back to the official English version.")
	if result.BackupPath != "" {
		fmt.Printf("  A copy of the localized build was saved at: %s\n", result.BackupPath)
	}
	if opts.Restart {
		if result.Relaunched {
			fmt.Println("  Antigravity has been relaunched.")
		} else {
			fmt.Println("  Could not relaunch Antigravity. Open it manually.")
		}
	}
	return 0
}

func cliStatus(svc *core.Service, opts core.Options) int {
	status, err := svc.GetStatus(opts.AppDir)
	if err != nil {
		return fail(err.Error())
	}
	fmt.Printf("App directory : %s\n", status.AppDir)
	fmt.Printf("Archive       : %s\n", status.AsarPath)
	fmt.Printf("Language      : %s", status.CurrentLanguage)
	if status.LocaleName != "" {
		fmt.Printf(" (%s)", status.LocaleName)
	}
	fmt.Println()
	fmt.Printf("Clean backup  : %s (%s)\n", status.CleanBackupStatus, status.CleanBackupPath)
	if status.LastPatchedAt != nil {
		fmt.Printf("Last patched  : %s\n", *status.LastPatchedAt)
	}
	if status.StateIsStale {
		fmt.Println("Note          : the recorded state marker is stale; the archive itself was read directly.")
	}
	for _, locale := range displayLocales(svc) {
		marker := "  "
		if locale.Code == status.CurrentLanguage {
			marker = "->"
		}
		fmt.Printf("  %s %-8s %-24s %d translations, %d%% coverage\n",
			marker, locale.Code, locale.Name, locale.Translations, locale.Coverage)
	}
	return 0
}

func cliLocales(svc *core.Service) int {
	for _, locale := range displayLocales(svc) {
		fmt.Printf("%-8s %-24s %-24s %5d translations  %3d%% coverage\n",
			locale.Code, locale.Name, locale.EnglishName, locale.Translations, locale.Coverage)
	}
	return 0
}

// displayLocales lists the locale packs with coverage, for the CLI.
func displayLocales(svc *core.Service) []core.LocaleInfo {
	locales, err := svc.DescribeLocales()
	if err != nil {
		return nil
	}
	return locales
}

func fail(msg string) int {
	fmt.Fprintln(os.Stderr, "error:", msg)
	return 1
}

// confirmShutdown asks before the tool closes a running application. Patching
// app.asar requires the app to be closed, and doing that without asking would
// discard unsaved work.
func confirmShutdown(what string) bool {
	fmt.Println(what)
	fmt.Print("Antigravity may need to be closed. Continue? [y/N] ")
	reader := bufio.NewReader(os.Stdin)
	line, err := reader.ReadString('\n')
	if err != nil && line == "" {
		return false
	}
	answer := strings.ToLower(strings.TrimSpace(line))
	return answer == "y" || answer == "yes"
}

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
