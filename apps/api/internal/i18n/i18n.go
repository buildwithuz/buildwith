// Package i18n serves the shared strings in packages/i18n to Go code (the bot
// and the worker). locales/ is a generated copy; edit packages/i18n instead.
package i18n

import (
	"embed"
	"encoding/json"
	"strings"
)

//go:generate sh -c "cp ../../../../packages/i18n/locales/*.json locales/"

//go:embed locales/*.json
var files embed.FS

var catalogs = map[string]map[string]string{}

func init() {
	for _, lang := range []string{"uz", "ru", "en"} {
		raw, err := files.ReadFile("locales/" + lang + ".json")
		if err != nil {
			panic("i18n: " + err.Error())
		}
		var tree map[string]any
		if err := json.Unmarshal(raw, &tree); err != nil {
			panic("i18n: " + lang + ": " + err.Error())
		}
		flat := map[string]string{}
		flatten("", tree, flat)
		catalogs[lang] = flat
	}
}

func flatten(prefix string, node map[string]any, out map[string]string) {
	for k, v := range node {
		key := k
		if prefix != "" {
			key = prefix + "." + k
		}
		switch v := v.(type) {
		case string:
			out[key] = v
		case map[string]any:
			flatten(key, v, out)
		}
	}
}

// T returns the message for key in lang, falling back to Uzbek, then the key.
// Variables are substituted for {name} placeholders.
func T(lang, key string, vars map[string]string) string {
	msg, ok := catalogs[lang][key]
	if !ok {
		if msg, ok = catalogs["uz"][key]; !ok {
			return key
		}
	}
	for k, v := range vars {
		msg = strings.ReplaceAll(msg, "{"+k+"}", v)
	}
	return msg
}
