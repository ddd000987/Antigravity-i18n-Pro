package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"

	"antigravity-i18n/internal/core"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// shutdownWarning is returned when an operation that closes Antigravity is
// called without the user's confirmation. The window always asks first, in its
// own language, so this only surfaces if a caller skips that step.
const shutdownWarning = "Antigravity has to be closed first: it is asked to quit and is " +
	"force-closed after 30 seconds, so unsaved editor content, a running session or undo " +
	"history may be lost. Confirm before continuing."

// App binds the Go core to the Wails frontend. The GUI only reaches the core
// through this type, so a window click and a CLI command perform the same work.
type App struct {
	ctx      context.Context
	svc      *core.Service
	appDir   string
	mu       sync.Mutex
	logs     []string
	progress func(stage, detail string)
}

// NewApp builds the GUI application around the shared locale store.
func NewApp(svc *core.Service, initialDir string) *App {
	return &App{svc: svc, appDir: initialDir}
}

// startup captures the context the runtime needs to emit events.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.progress = func(stage, detail string) {
		wailsRuntime.EventsEmit(ctx, "progress", map[string]string{
			"stage":  stage,
			"detail": detail,
		})
	}
	// The sink is installed once here rather than at each call site, so an
	// action taken before startup has already been set cannot go silent.
	a.svc.Progress = a.progress
	a.svc.Progress("Ready", "Detecting Antigravity")
}

func (a *App) appendLog(msg string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.logs = append(a.logs, msg)
	if len(a.logs) > 400 {
		a.logs = a.logs[len(a.logs)-400:]
	}
}

func (a *App) currentDir() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.appDir
}

// GetVersion reports the tool version shown in the window chrome.
func (a *App) GetVersion() string { return core.Version }

// GetStatus reports the localization state of the selected installation.
func (a *App) GetStatus() (*core.Status, error) {
	st, err := a.svc.GetStatus(a.currentDir())
	if err != nil {
		return nil, err
	}
	if st != nil && st.AppDir != "" {
		a.mu.Lock()
		a.appDir = st.AppDir
		a.mu.Unlock()
	}
	return st, nil
}

// GetLocales lists every bundled language pack.
func (a *App) GetLocales() ([]core.LocaleInfo, error) {
	return a.svc.DescribeLocales()
}

// SelectAppDir opens a native folder picker. The title comes from the window
// so it is shown in the interface language.
func (a *App) SelectAppDir(title string) (string, error) {
	if a.ctx == nil {
		return "", errors.New("app context not initialized")
	}
	if title == "" {
		title = "Select the Antigravity installation folder (the one holding Antigravity.exe)"
	}
	selected, err := wailsRuntime.OpenDirectoryDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: title,
	})
	if err != nil {
		return "", err
	}
	return selected, nil
}

// SetAppDir targets another installation and returns the refreshed status.
func (a *App) SetAppDir(path string) (*core.Status, error) {
	if path == "" {
		return nil, errors.New("no directory selected")
	}
	st, err := a.svc.GetStatus(filepath.Clean(path))
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	a.appDir = st.AppDir
	a.mu.Unlock()
	return st, nil
}

// ApplyLocale installs a language pack, replacing whatever patch is present.
//
// confirmed must be true only after the user accepted shutdownWarning. The
// window used to close Antigravity with no prompt at all, which is how unsaved
// work got discarded, so the refusal is enforced here rather than in the UI.
func (a *App) ApplyLocale(locale string, confirmed bool) (*core.ApplyResult, error) {
	if !confirmed {
		return nil, errors.New(shutdownWarning)
	}
	result, err := a.svc.ApplyLocale(core.Options{
		AppDir:    a.currentDir(),
		Locale:    locale,
		Restart:   true,
		TimeoutMs: 30000,
	})
	for _, note := range a.svc.Notes() {
		a.appendLog("note: " + note)
	}
	if err != nil {
		a.appendLog("error: " + err.Error())
		return nil, err
	}
	a.appendLog(fmt.Sprintf("applied %s (%s)", result.LocaleName, result.Locale))
	return result, nil
}

// ApplyLocaleFile installs an external language file. It demands the same
// confirmation as ApplyLocale, and the file is checked again here rather than
// trusting an earlier CheckLocaleFile: it may have been edited since.
func (a *App) ApplyLocaleFile(path string, confirmed bool) (*core.ApplyResult, error) {
	if !confirmed {
		return nil, errors.New(shutdownWarning)
	}
	return a.applyWith(core.Options{LocaleFile: path})
}

// Reapply installs the remembered language again, typically after an
// Antigravity update replaced app.asar.
func (a *App) Reapply(confirmed bool) (*core.ApplyResult, error) {
	if !confirmed {
		return nil, errors.New(shutdownWarning)
	}
	settings := a.svc.LoadSettings()
	return a.applyWith(core.Options{Locale: settings.LastLocale, LocaleFile: settings.LastLocaleFile})
}

func (a *App) applyWith(opts core.Options) (*core.ApplyResult, error) {
	opts.AppDir = a.currentDir()
	opts.Restart = true
	opts.TimeoutMs = 30000
	if opts.Locale == "" && opts.LocaleFile == "" {
		return nil, core.ErrNothingRemembered
	}
	result, err := a.svc.ApplyLocale(opts)
	for _, note := range a.svc.Notes() {
		a.appendLog("note: " + note)
	}
	if err != nil {
		a.appendLog("error: " + err.Error())
		return nil, err
	}
	a.appendLog(fmt.Sprintf("applied %s (%s)", result.LocaleName, result.Locale))
	return result, nil
}

// GetReapplyHint reports whether an update put Antigravity back on English
// while the last choice was a translation.
func (a *App) GetReapplyHint() (*core.ReapplyHint, error) {
	return a.svc.GetReapplyHint(a.currentDir())
}

// ChooseLocaleFile opens a native picker for a language file.
func (a *App) ChooseLocaleFile(title string) (string, error) {
	if a.ctx == nil {
		return "", errors.New("app context not initialized")
	}
	return wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title:   title,
		Filters: []wailsRuntime.FileFilter{{DisplayName: "JSON (*.json)", Pattern: "*.json"}},
	})
}

// CheckLocaleFile validates a language file and reports its progress without
// changing anything.
func (a *App) CheckLocaleFile(path string) (*core.FileReport, error) {
	return a.svc.CheckLocaleFile(path)
}

// ExportTemplate asks where to save a translation template and writes it,
// blank or prefilled from a bundled pack. A cancelled dialog returns nil.
func (a *App) ExportTemplate(from, title string) (*core.TemplateSummary, error) {
	if a.ctx == nil {
		return nil, errors.New("app context not initialized")
	}
	// Same names as the release files, so a prefilled export reads as that
	// language's file.
	name := "language-template.json"
	if from != "" {
		name = "language-" + from + ".json"
	}
	path, err := wailsRuntime.SaveFileDialog(a.ctx, wailsRuntime.SaveDialogOptions{
		Title:           title,
		DefaultFilename: name,
		Filters:         []wailsRuntime.FileFilter{{DisplayName: "JSON (*.json)", Pattern: "*.json"}},
	})
	if err != nil || path == "" {
		return nil, err
	}
	if filepath.Ext(path) == "" {
		path += ".json"
	}
	summary, err := a.svc.ExportTemplate(path, from)
	if err != nil {
		a.appendLog("error: " + err.Error())
		return nil, err
	}
	a.appendLog("exported a translation template to " + path)
	return summary, nil
}

// UpdateTemplate asks for a language file and merges the current strings into
// it in place, keeping a backup copy. A cancelled dialog returns nil.
func (a *App) UpdateTemplate(title string) (*core.UpdateSummary, error) {
	path, err := a.ChooseLocaleFile(title)
	if err != nil || path == "" {
		return nil, err
	}
	summary, err := a.svc.UpdateTemplate(path, "")
	if err != nil {
		a.appendLog("error: " + err.Error())
		return nil, err
	}
	a.appendLog(fmt.Sprintf("updated %s: %d new entries", path, summary.AddedTotal))
	return summary, nil
}

// UIInfo carries the window's own translations and the saved choice.
type UIInfo struct {
	Saved    string                       `json:"saved"`
	Messages map[string]map[string]string `json:"messages"`
}

// GetUIInfo returns every interface language file under frontend/dist/i18n.
// Adding a language to the window is adding one JSON file there.
func (a *App) GetUIInfo() (*UIInfo, error) {
	messages, err := loadUIMessages()
	if err != nil {
		return nil, err
	}
	return &UIInfo{Saved: a.svc.LoadSettings().UILanguage, Messages: messages}, nil
}

// SetUILanguage remembers the window language; empty follows the system.
func (a *App) SetUILanguage(code string) error {
	settings := a.svc.LoadSettings()
	settings.UILanguage = code
	return a.svc.SaveSettings(settings)
}

// RestoreLocale puts the official English build back. Restore stops the process
// exactly like apply does, so it demands the same confirmation.
func (a *App) RestoreLocale(confirmed bool) (*core.RestoreResult, error) {
	if !confirmed {
		return nil, errors.New(shutdownWarning)
	}
	result, err := a.svc.RestoreOfficial(core.Options{
		AppDir:    a.currentDir(),
		Restart:   true,
		TimeoutMs: 30000,
	})
	for _, note := range a.svc.Notes() {
		a.appendLog("note: " + note)
	}
	if err != nil {
		a.appendLog("error: " + err.Error())
		return nil, err
	}
	a.appendLog("restored the official English build")
	return result, nil
}

// LaunchAntigravity starts the application after a successful patch.
func (a *App) LaunchAntigravity() error {
	dir := a.currentDir()
	if dir == "" {
		return errors.New("no Antigravity installation selected")
	}
	exe := filepath.Join(dir, "Antigravity.exe")
	if _, err := os.Stat(exe); err != nil {
		return fmt.Errorf("Antigravity.exe was not found in %s", dir)
	}
	cmd := exec.Command(exe)
	if err := cmd.Start(); err != nil {
		return err
	}
	_ = cmd.Process.Release()
	return nil
}

// GetLogs returns the diagnostics collected in this session.
func (a *App) GetLogs() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]string, len(a.logs))
	copy(out, a.logs)
	return out
}
