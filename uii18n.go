package main

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"path"
	"strings"
)

// uiMessagesDir holds one JSON file per interface language, named by its code
// (en.json, zh-TW.json). Each file maps message ids to text, so adding a
// language to the window is adding one file there.
const uiMessagesDir = "frontend/dist/i18n"

// loadUIMessages reads every interface language file embedded in the binary.
func loadUIMessages() (map[string]map[string]string, error) {
	entries, err := fs.ReadDir(frontendFS, uiMessagesDir)
	if err != nil {
		return nil, fmt.Errorf("the interface translations are missing: %w", err)
	}
	out := map[string]map[string]string{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		data, err := fs.ReadFile(frontendFS, path.Join(uiMessagesDir, e.Name()))
		if err != nil {
			return nil, err
		}
		var messages map[string]string
		if err := json.Unmarshal(data, &messages); err != nil {
			return nil, fmt.Errorf("interface translation %s is not valid JSON: %w", e.Name(), err)
		}
		out[strings.TrimSuffix(e.Name(), ".json")] = messages
	}
	if _, ok := out["en"]; !ok {
		return nil, fmt.Errorf("the English interface translation (en.json) is missing")
	}
	return out, nil
}
