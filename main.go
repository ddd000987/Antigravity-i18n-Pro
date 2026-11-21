package main

import (
	"fmt"
	"io/fs"
	"os"

	"antigravity-i18n/internal/core"
)

// One binary is both the windowed app and the command line tool. The locale
// store is built once and shared, so a window click and a console command can
// never disagree about which language packs exist.
func main() {
	svc, err := newService()
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	if len(os.Args) > 1 {
		os.Exit(runCLI(svc, os.Args[1:]))
	}

	// The GUI is the default entry point; the CLI lives in the same binary.
	runWails(svc)
}

// newService builds the service from the embedded assets, with the
// screen-location notes used in templates and the user's settings file.
func newService() (*core.Service, error) {
	assets := assetFS("assets")
	store, err := core.NewLocaleStore(assets, assets, "locales", "patches")
	if err != nil {
		return nil, err
	}
	if notes, err := fs.ReadFile(assets, "catalog/notes.json"); err == nil {
		if err := store.SetNotes(notes); err != nil {
			return nil, err
		}
	}
	svc := core.NewService(store)
	svc.SettingsPath = core.DefaultSettingsPath()
	return svc, nil
}
