package slug

import "testing"

func TestMake(t *testing.T) {
	cases := map[string]string{
		"Go'da xatolarni qayta ishlash":   "goda-xatolarni-qayta-ishlash",
		"Тошкентда Go митапи":             "toshkentda-go-mitapi",
		"Show: buildwith.uz — v0.1!":      "show-buildwith-uz-v0-1",
		"   ":                             "",
		"Oʻzbek tili uchun NLP":           "ozbek-tili-uchun-nlp",
	}
	for in, want := range cases {
		if got := Make(in, 60); got != want {
			t.Errorf("Make(%q) = %q, want %q", in, got, want)
		}
	}
	if got := Make("a very long title that keeps going and going", 12); got != "a-very-long" {
		t.Errorf("truncation: got %q", got)
	}
}
