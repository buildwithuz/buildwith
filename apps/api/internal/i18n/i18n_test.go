package i18n

import (
	"bytes"
	"os"
	"testing"
)

func TestLocalesMatchShared(t *testing.T) {
	for _, lang := range []string{"uz", "ru", "en"} {
		shared, err := os.ReadFile("../../../../packages/i18n/locales/" + lang + ".json")
		if err != nil {
			t.Fatal(err)
		}
		local, _ := files.ReadFile("locales/" + lang + ".json")
		if !bytes.Equal(shared, local) {
			t.Fatalf("%s.json is stale; run go generate ./internal/i18n", lang)
		}
	}
}

func TestT(t *testing.T) {
	if got := T("en", "notify.follow", map[string]string{"actor": "@aziz"}); got != "@aziz followed you" {
		t.Fatalf("got %q", got)
	}
	if got := T("xx", "notify.open", nil); got != "Ochish" {
		t.Fatalf("fallback: %q", got)
	}
	if got := T("uz", "nope.nope", nil); got != "nope.nope" {
		t.Fatalf("missing key: %q", got)
	}
}
