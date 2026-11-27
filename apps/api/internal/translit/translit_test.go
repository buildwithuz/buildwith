package translit

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

const testdata = "../../../../packages/translit/testdata"

type vector struct {
	In   string `json:"in"`
	Out  string `json:"out"`
	Note string `json:"note"`
}

func loadVectors(t *testing.T) map[string][]vector {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(testdata, "vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var all map[string]json.RawMessage
	if err := json.Unmarshal(raw, &all); err != nil {
		t.Fatal(err)
	}
	out := map[string][]vector{}
	for k, v := range all {
		if k == "_readme" {
			continue
		}
		var vs []vector
		if err := json.Unmarshal(v, &vs); err != nil {
			t.Fatalf("%s: %v", k, err)
		}
		out[k] = vs
	}
	return out
}

func TestVectors(t *testing.T) {
	funcs := map[string]func(string) string{
		"normalize":  Normalize,
		"toCyrillic": ToCyrillic,
		"toLatin":    ToLatin,
		"forSearch":  ForSearch,
	}
	vectors := loadVectors(t)
	for name, f := range funcs {
		cases, ok := vectors[name]
		if !ok || len(cases) == 0 {
			t.Fatalf("no %s vectors", name)
		}
		for _, c := range cases {
			t.Run(name+"/"+c.In, func(t *testing.T) {
				if got := f(c.In); got != c.Out {
					t.Errorf("%s(%q) = %q, want %q (%s)", name, c.In, got, c.Out, c.Note)
				}
			})
		}
	}
}

func TestLoanwordsMatchShared(t *testing.T) {
	shared, err := os.ReadFile(filepath.Join(testdata, "loanwords.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(shared, loanwordsJSON) {
		t.Fatal("internal/translit/loanwords.json differs from packages/translit/testdata/loanwords.json; copy it over")
	}
}

func TestRoundTrip(t *testing.T) {
	for _, s := range []string{"oʻzbek tili", "Toshkent shahri", "maʼno", "gʻisht", "chiroq yoqildi"} {
		if got := ToLatin(ToCyrillic(s)); got != s {
			t.Errorf("round trip %q -> %q -> %q", s, ToCyrillic(s), got)
		}
	}
}
