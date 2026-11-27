package urlx

import "testing"

func TestCanonicalize(t *testing.T) {
	cases := []struct{ in, url, domain string }{
		{"https://www.Example.com/a/b/?utm_source=tg&b=2&a=1#frag", "https://example.com/a/b?a=1&b=2", "example.com"},
		{"http://example.com:80/", "https://example.com/", "example.com"},
		{"https://youtu.be/dQw4w9WgXcQ?si=abc", "https://youtube.com/watch?v=dQw4w9WgXcQ", "youtube.com"},
		{"https://m.youtube.com/watch?v=x&feature=share", "https://youtube.com/watch?v=x", "youtube.com"},
		{"https://github.com/golang/go/issues/1", "https://github.com/golang/go/issues/1", "github.com/golang"},
		{"https://twitter.com/abdurahmon/status/1", "https://x.com/abdurahmon/status/1", "x.com/abdurahmon"},
		{"https://blog.uz/post/index.html", "https://blog.uz/post", "blog.uz"},
		{"https://kun.uz/news/2026/11/27/x?fbclid=1", "https://kun.uz/news/2026/11/27/x", "kun.uz"},
	}
	for _, c := range cases {
		got, err := Canonicalize(c.in)
		if err != nil {
			t.Errorf("%s: %v", c.in, err)
			continue
		}
		if got.URL != c.url || got.Domain != c.domain {
			t.Errorf("%s:\n got  %s (%s)\n want %s (%s)", c.in, got.URL, got.Domain, c.url, c.domain)
		}
	}
}

func TestSameKeyAcrossSchemes(t *testing.T) {
	a, _ := Canonicalize("http://www.example.com/x")
	b, _ := Canonicalize("https://example.com/x/?utm_campaign=y")
	if string(a.Hash) != string(b.Hash) {
		t.Fatalf("want equal hashes for %s and %s", a.Key, b.Key)
	}
}

func TestRejects(t *testing.T) {
	for _, in := range []string{
		"javascript:alert(1)", "ftp://example.com/x", "https://127.0.0.1/", "http://localhost:8080/",
		"https://user:pass@example.com/", "not a url", "https://intranet/", "https://printer.local/",
		"https://[::1]/",
	} {
		if _, err := Canonicalize(in); err == nil {
			t.Errorf("%q: want error", in)
		}
	}
}
