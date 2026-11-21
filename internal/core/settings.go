package core

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// Antigravity's own updater replaces app.asar, which removes the patch and
// with it any record kept inside the install. The last choice is therefore
// kept in the user's profile, where an update cannot reach it, so the window
// can offer to put the same language back afterwards.

// Settings is what the tool remembers between runs.
type Settings struct {
	// LastLocale is the code of the last language applied, or "en" after a
	// restore. With LastLocaleFile set it is that file's language code.
	LastLocale string `json:"lastLocale,omitempty"`
	// LastLocaleFile is the external language file last applied, if any.
	LastLocaleFile string `json:"lastLocaleFile,omitempty"`
	// UILanguage is the tool window's own language; empty follows the system.
	UILanguage string `json:"uiLanguage,omitempty"`
}

// DefaultSettingsPath is %APPDATA%\Antigravity-i18n-Pro\settings.json.
func DefaultSettingsPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "Antigravity-i18n-Pro", "settings.json")
}

// LoadSettings reads the settings file. A missing or unreadable file is the
// same as no settings: remembering is a convenience, never a reason to fail.
func (s *Service) LoadSettings() Settings {
	var out Settings
	if s.SettingsPath == "" {
		return out
	}
	data, err := os.ReadFile(s.SettingsPath)
	if err != nil {
		return out
	}
	_ = json.Unmarshal(data, &out)
	return out
}

// SaveSettings writes the settings file.
func (s *Service) SaveSettings(settings Settings) error {
	if s.SettingsPath == "" {
		return nil
	}
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(s.SettingsPath, append(data, '\n'))
}

// remember records a successful apply or restore.
func (s *Service) remember(locale, file string) {
	settings := s.LoadSettings()
	settings.LastLocale = locale
	settings.LastLocaleFile = ""
	if file != "" {
		if abs, err := filepath.Abs(file); err == nil {
			file = abs
		}
		settings.LastLocaleFile = file
	}
	if err := s.SaveSettings(settings); err != nil {
		s.notes = append(s.notes, "Could not remember this choice: "+err.Error())
	}
}

// ReapplyHint tells the window whether an update removed the remembered
// language.
type ReapplyHint struct {
	Needed      bool   `json:"needed"`
	Locale      string `json:"locale"`
	LocaleFile  string `json:"localeFile"`
	Name        string `json:"name"`
	FileMissing bool   `json:"fileMissing"`
	AppVersion  string `json:"appVersion"`
}

// GetReapplyHint reports whether the installation is back on English while
// the last choice was a translation, which is what an Antigravity update
// leaves behind.
func (s *Service) GetReapplyHint(appDir string) (*ReapplyHint, error) {
	settings := s.LoadSettings()
	hint := &ReapplyHint{Locale: settings.LastLocale, LocaleFile: settings.LastLocaleFile}
	if settings.LastLocale == "" || CanonicalLocale(settings.LastLocale) == EnglishLocale {
		return hint, nil
	}
	status, err := s.GetStatus(appDir)
	if err != nil {
		return nil, err
	}
	hint.AppVersion = status.AppVersion
	if status.CurrentLanguage != EnglishLocale {
		return hint, nil
	}
	hint.Needed = true
	if settings.LastLocaleFile != "" {
		hint.Name = filepath.Base(settings.LastLocaleFile)
		raw, err := os.ReadFile(settings.LastLocaleFile)
		if err != nil {
			hint.FileMissing = true
			return hint, nil
		}
		var head struct {
			Name string `json:"name"`
		}
		if json.Unmarshal(trimBOM(raw), &head) == nil && strings.TrimSpace(head.Name) != "" {
			hint.Name = head.Name
		}
		return hint, nil
	}
	if loc, err := s.store.LoadLocale(settings.LastLocale); err == nil {
		hint.Name = loc.Name
	}
	return hint, nil
}

func trimBOM(b []byte) []byte {
	if len(b) >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF {
		return b[3:]
	}
	return b
}

// ErrNothingRemembered means reapply has no previous choice to repeat.
var ErrNothingRemembered = errors.New("no language has been applied with this tool yet")

// Reapply applies the remembered choice again.
func (s *Service) Reapply(opts Options) (*ApplyResult, error) {
	settings := s.LoadSettings()
	if settings.LastLocale == "" || CanonicalLocale(settings.LastLocale) == EnglishLocale {
		return nil, ErrNothingRemembered
	}
	opts.Locale = settings.LastLocale
	opts.LocaleFile = settings.LastLocaleFile
	return s.ApplyLocale(opts)
}
