package markdown

import (
	"strings"
	"testing"
)

func TestRenderSanitizes(t *testing.T) {
	cases := []struct {
		name, in      string
		profile       Profile
		want, wantNot []string
	}{
		{name: "raw html is escaped", in: "<script>alert(1)</script>", profile: Article,
			want: []string{"&lt;script&gt;alert(1)&lt;/script&gt;"}, wantNot: []string{"<script"}},
		{name: "raw html block keeps the words around it", in: "<div>salom</div> **dunyo**", profile: Comment,
			want: []string{"&lt;div&gt;salom&lt;/div&gt;"}, wantNot: []string{"<div>"}},
		{name: "inline tags in prose are shown literally", in: "Use the <Button> component", profile: Comment,
			want: []string{"Use the &lt;Button&gt; component"}},
		{name: "javascript links are dropped", in: "[x](javascript:alert(1))", profile: Comment,
			wantNot: []string{"javascript:"}},
		{name: "inline formatting", in: "**bold** _it_ `code` ~~del~~", profile: Comment,
			want: []string{"<strong>bold</strong>", "<em>it</em>", "<code>code</code>", "<del>del</del>"}},
		{name: "comments have no headings", in: "# Title", profile: Comment,
			wantNot: []string{"<h1"}},
		{name: "comments have no images", in: "![a](https://x.uz/a.png)", profile: Comment,
			wantNot: []string{"<img"}},
		{name: "articles keep images", in: "![alt text](https://buildwith.uz/media/a.webp)", profile: Article,
			want: []string{`<img src="https://buildwith.uz/media/a.webp" alt="alt text"`}},
		{name: "articles get heading anchors", in: "## Getting started", profile: Article,
			want: []string{`<h2 id="getting-started">`}},
		{name: "code is highlighted with classes", in: "```go\nfunc main() {}\n```", profile: Comment,
			want: []string{`<pre class="code" data-lang="go">`, `<span class="kd">func</span>`}},
		{name: "unknown languages are escaped", in: "```nope\n<b>x</b>\n```", profile: Comment,
			want: []string{"&lt;b&gt;x&lt;/b&gt;"}},
		{name: "note mentions and tags", in: "salom @aziz, see #golang", profile: Note,
			want: []string{`<a href="/@aziz" class="mention">@aziz</a>`, `<a href="/t/golang" class="hashtag">#golang</a>`}},
		{name: "mentions are not linked inside code", in: "`@aziz`", profile: Note,
			want: []string{"<code>@aziz</code>"}, wantNot: []string{"/@aziz"}},
		{name: "callouts", in: "> [!NOTE]\n> Remember this.", profile: Article,
			want: []string{`<aside class="callout callout-note">`, "Remember this."}},
		{name: "youtube becomes a card, not an iframe", in: "https://www.youtube.com/watch?v=abc123", profile: Article,
			want: []string{`class="embed embed-youtube"`}, wantNot: []string{"<iframe"}},
		{name: "tables in articles", in: "| a | b |\n|---|---|\n| 1 | 2 |", profile: Article,
			want: []string{"<table>", "<td>1</td>"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Render(c.in, Options{Profile: c.profile}).HTML
			for _, w := range c.want {
				if !strings.Contains(got, w) {
					t.Errorf("want %q in\n%s", w, got)
				}
			}
			for _, w := range c.wantNot {
				if strings.Contains(got, w) {
					t.Errorf("did not want %q in\n%s", w, got)
				}
			}
		})
	}
}

func TestNoFollow(t *testing.T) {
	got := Render("[site](https://example.com)", Options{Profile: Comment, NoFollow: true}).HTML
	if !strings.Contains(got, `rel="nofollow ugc"`) {
		t.Fatalf("want nofollow, got %s", got)
	}
	got = Render("[site](https://example.com)", Options{Profile: Comment}).HTML
	if strings.Contains(got, "nofollow") {
		t.Fatalf("trusted author should not get nofollow, got %s", got)
	}
}

func TestTOCAndReadingTime(t *testing.T) {
	src := "## One\n\ntext\n\n### Two\n\n" + strings.Repeat("word ", 450)
	r := Render(src, Options{Profile: Article})
	if len(r.TOC) != 2 || r.TOC[0].ID != "one" || r.TOC[1].Level != 3 {
		t.Fatalf("toc = %+v", r.TOC)
	}
	if got := r.ReadingMinutes(); got != 3 {
		t.Fatalf("reading minutes = %d, want 3", got)
	}
}

func TestExcerpt(t *testing.T) {
	if got := Excerpt("## Hello **world**", 100); got != "Hello world" {
		t.Fatalf("got %q", got)
	}
	if got := Excerpt("one two three four five", 12); got != "one two…" {
		t.Fatalf("got %q", got)
	}
}

func TestNoFollowSkipsInternalLinks(t *testing.T) {
	got := Render("hi @aziz", Options{Profile: Note, NoFollow: true}).HTML
	if strings.Contains(got, "nofollow") {
		t.Fatalf("internal mention links must stay followed, got %s", got)
	}
}
