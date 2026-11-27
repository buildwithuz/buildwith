// Package markdown renders user Markdown to sanitized HTML. Nothing a user
// writes reaches a reader without passing through Render.
package markdown

import (
	"bytes"
	"fmt"
	"html"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/alecthomas/chroma/v2"
	chtml "github.com/alecthomas/chroma/v2/formatters/html"
	"github.com/alecthomas/chroma/v2/lexers"
	"github.com/alecthomas/chroma/v2/styles"
	"github.com/microcosm-cc/bluemonday"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	gmhtml "github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// Profile chooses how much Markdown a surface allows.
type Profile int

const (
	// Comment: inline formatting, links, lists, quotes, code. No headings, no images.
	Comment Profile = iota
	// Note: Comment plus @mentions and #tags turned into links.
	Note
	// Article: everything, including headings with anchors, images, tables,
	// footnotes, callouts and embed cards.
	Article
)

type Options struct {
	Profile Profile
	// NoFollow adds rel="nofollow ugc" to links; new and low-karma authors get it.
	NoFollow bool
}

type TocEntry struct {
	Level int    `json:"level"`
	Text  string `json:"text"`
	ID    string `json:"id"`
}

type Result struct {
	HTML  string
	TOC   []TocEntry
	Words int
}

// ReadingMinutes estimates reading time at 200 words a minute, at least one.
func (r Result) ReadingMinutes() int { return max(1, (r.Words+199)/200) }

func Render(src string, opt Options) Result {
	md := engine(opt.Profile)
	reader := text.NewReader([]byte(src))
	doc := md.Parser().Parse(reader)

	var toc []TocEntry
	words := 0
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch n := n.(type) {
		case *ast.Heading:
			if opt.Profile == Article && n.Level >= 2 && n.Level <= 4 {
				id, _ := n.AttributeString("id")
				idb, _ := id.([]byte)
				toc = append(toc, TocEntry{Level: n.Level, Text: plainText(n, reader.Source()), ID: string(idb)})
			}
		case *ast.Text:
			words += len(strings.Fields(string(n.Segment.Value(reader.Source()))))
		case *ast.FencedCodeBlock, *ast.CodeBlock:
			return ast.WalkSkipChildren, nil
		}
		return ast.WalkContinue, nil
	})

	var buf bytes.Buffer
	if err := md.Renderer().Render(&buf, reader.Source(), doc); err != nil {
		// The renderer only fails on writer errors, which a bytes.Buffer never returns.
		return Result{HTML: "<p>" + html.EscapeString(src) + "</p>"}
	}

	out := buf.String()
	if opt.Profile == Article {
		out = callouts(out)
		out = embedCards(out)
	}
	if opt.Profile == Note {
		out = linkMentions(out)
	}
	out = policy(opt).Sanitize(out)
	if opt.NoFollow {
		out = strings.ReplaceAll(out, `rel="nofollow"`, `rel="nofollow ugc"`)
	}
	return Result{HTML: out, TOC: toc, Words: words}
}

func plainText(n ast.Node, src []byte) string {
	var b strings.Builder
	_ = ast.Walk(n, func(c ast.Node, entering bool) (ast.WalkStatus, error) {
		if entering {
			if t, ok := c.(*ast.Text); ok {
				b.Write(t.Segment.Value(src))
			} else if t, ok := c.(*ast.String); ok {
				b.Write(t.Value)
			}
		}
		return ast.WalkContinue, nil
	})
	return b.String()
}

var engines = map[Profile]goldmark.Markdown{
	Comment: newEngine(Comment),
	Note:    newEngine(Note),
	Article: newEngine(Article),
}

func engine(p Profile) goldmark.Markdown { return engines[p] }

func newEngine(p Profile) goldmark.Markdown {
	exts := []goldmark.Extender{extension.Strikethrough, extension.Linkify}
	popts := []parser.Option{}
	if p == Article {
		exts = append(exts, extension.Table, extension.TaskList, extension.Footnote)
		popts = append(popts, parser.WithAutoHeadingID())
	}
	return goldmark.New(
		goldmark.WithExtensions(exts...),
		goldmark.WithParserOptions(popts...),
		goldmark.WithRendererOptions(
			// Raw HTML in Markdown is escaped, never passed through.
			gmhtml.WithHardWraps(),
			renderer.WithNodeRenderers(util.Prioritized(&codeRenderer{}, 100)),
		),
	)
}

// codeRenderer highlights fenced code on the server with CSS classes, so readers
// get colour without any JavaScript and the theme comes from our tokens.
type codeRenderer struct{}

func (r *codeRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(ast.KindFencedCodeBlock, r.render)
	reg.Register(ast.KindCodeBlock, r.render)
}

func (r *codeRenderer) render(w util.BufWriter, src []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	var code bytes.Buffer
	lines := n.Lines()
	for i := range lines.Len() {
		seg := lines.At(i)
		code.Write(seg.Value(src))
	}
	lang := ""
	if f, ok := n.(*ast.FencedCodeBlock); ok {
		lang = string(f.Language(src))
	}
	_, _ = w.WriteString(Highlight(code.String(), lang))
	return ast.WalkSkipChildren, nil
}

var formatter = chtml.New(chtml.WithClasses(true), chtml.PreventSurroundingPre(true))

// Highlight returns a <pre><code> block with Chroma token classes. Unknown
// languages are escaped plain text.
func Highlight(code, lang string) string {
	lexer := lexers.Get(lang)
	var b strings.Builder
	langAttr := ""
	if lang != "" {
		langAttr = fmt.Sprintf(` data-lang="%s"`, html.EscapeString(lang))
	}
	fmt.Fprintf(&b, `<pre class="code"%s><code>`, langAttr)
	if lexer == nil {
		b.WriteString(html.EscapeString(code))
	} else {
		it, err := chroma.Coalesce(lexer).Tokenise(nil, code)
		if err != nil || formatter.Format(&b, styles.Fallback, it) != nil {
			b.Reset()
			fmt.Fprintf(&b, `<pre class="code"%s><code>%s`, langAttr, html.EscapeString(code))
		}
	}
	b.WriteString("</code></pre>\n")
	return b.String()
}

var calloutRe = regexp.MustCompile(`(?s)<blockquote>\s*<p>\[!(NOTE|TIP|WARNING|CAUTION)\]\s*(?:<br\s*/?>)?\s*(.*?)</blockquote>`)

// callouts turns GitHub-style "> [!NOTE]" quotes into <aside> boxes.
func callouts(s string) string {
	return calloutRe.ReplaceAllStringFunc(s, func(m string) string {
		sub := calloutRe.FindStringSubmatch(m)
		return fmt.Sprintf(`<aside class="callout callout-%s"><p>%s</aside>`, strings.ToLower(sub[1]), sub[2])
	})
}

var bareLinkLine = regexp.MustCompile(`<p><a href="([^"]+)"[^>]*>([^<]+)</a></p>`)

// embedCards replaces a paragraph that is only a link to YouTube, a gist or a
// Telegram post with a card. We never load third-party scripts or iframes.
func embedCards(s string) string {
	return bareLinkLine.ReplaceAllStringFunc(s, func(m string) string {
		sub := bareLinkLine.FindStringSubmatch(m)
		href := html.UnescapeString(sub[1])
		kind := EmbedKind(href)
		if kind == "" {
			return m
		}
		u, _ := url.Parse(href)
		return fmt.Sprintf(
			`<p class="embed embed-%s"><a href="%s" rel="noopener"><span class="embed-kind">%s</span><span class="embed-url">%s</span></a></p>`,
			kind, html.EscapeString(href), kind, html.EscapeString(u.Host+u.Path))
	})
}

// EmbedKind names the service a URL points at, or "" if it is not one we card.
func EmbedKind(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return ""
	}
	host := strings.TrimPrefix(strings.ToLower(u.Host), "www.")
	switch {
	case host == "youtube.com" && u.Path == "/watch" && u.Query().Get("v") != "",
		host == "youtu.be" && len(u.Path) > 1:
		return "youtube"
	case host == "gist.github.com" && strings.Count(strings.Trim(u.Path, "/"), "/") == 1:
		return "gist"
	case host == "t.me" && strings.Count(strings.Trim(u.Path, "/"), "/") == 1:
		return "telegram"
	}
	return ""
}

var mentionRe = regexp.MustCompile(`(^|[\s(])([@#])([A-Za-z0-9][A-Za-z0-9_-]{1,29})\b`)

// linkMentions turns @username and #tag in note text into links, outside code
// and existing links.
func linkMentions(s string) string {
	return mapText(s, func(t string) string {
		return mentionRe.ReplaceAllStringFunc(t, func(m string) string {
			sub := mentionRe.FindStringSubmatch(m)
			name := sub[3]
			if sub[2] == "@" {
				return fmt.Sprintf(`%s<a href="/@%s" class="mention">@%s</a>`, sub[1], name, name)
			}
			return fmt.Sprintf(`%s<a href="/t/%s" class="hashtag">#%s</a>`, sub[1], strings.ToLower(name), name)
		})
	})
}

var tagRe = regexp.MustCompile(`<(/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>`)

// mapText applies f to text outside <a>, <code> and <pre>.
func mapText(s string, f func(string) string) string {
	var b strings.Builder
	depth := 0
	last := 0
	for _, m := range tagRe.FindAllStringSubmatchIndex(s, -1) {
		seg := s[last:m[0]]
		if depth == 0 {
			seg = f(seg)
		}
		b.WriteString(seg)
		b.WriteString(s[m[0]:m[1]])
		last = m[1]
		switch strings.ToLower(s[m[4]:m[5]]) {
		case "a", "code", "pre":
			if m[3] > m[2] { // closing tag
				depth = max(0, depth-1)
			} else {
				depth++
			}
		}
	}
	tail := s[last:]
	if depth == 0 {
		tail = f(tail)
	}
	b.WriteString(tail)
	return b.String()
}

var (
	classRe  = regexp.MustCompile(`^[a-z0-9 -]{1,80}$`)
	idRe     = regexp.MustCompile(`^[a-zA-Z0-9_:-]{1,120}$`)
	langRe   = regexp.MustCompile(`^[a-zA-Z0-9+#_.-]{1,20}$`)
	policyMu sync.Mutex
	policies = map[Options]*bluemonday.Policy{}
)

func policy(opt Options) *bluemonday.Policy {
	policyMu.Lock()
	defer policyMu.Unlock()
	if p, ok := policies[opt]; ok {
		return p
	}
	p := bluemonday.NewPolicy()
	p.AllowElements("p", "br", "em", "strong", "del", "code", "pre", "blockquote", "ul", "ol", "li", "span", "hr")
	p.AllowAttrs("class").Matching(classRe).OnElements("span", "pre", "code", "a", "p", "aside")
	p.AllowAttrs("data-lang").Matching(langRe).OnElements("pre")
	p.AllowStandardURLs()
	p.AllowURLSchemes("http", "https", "mailto")
	p.AllowAttrs("href").OnElements("a")
	p.RequireParseableURLs(true)
	p.AddTargetBlankToFullyQualifiedLinks(false)
	// AllowStandardURLs turns nofollow on for every link; we only want it on
	// external links from authors who have not earned trust yet.
	p.RequireNoFollowOnLinks(false)
	p.RequireNoFollowOnFullyQualifiedLinks(opt.NoFollow)
	if opt.Profile == Article {
		p.AllowElements("h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tr", "th", "td",
			"sup", "sub", "section", "aside", "figure", "figcaption", "input", "img", "details", "summary")
		p.AllowAttrs("id").Matching(idRe).OnElements("h1", "h2", "h3", "h4", "h5", "h6", "li", "sup", "section")
		p.AllowAttrs("align").Matching(regexp.MustCompile(`^(left|right|center)$`)).OnElements("th", "td")
		p.AllowAttrs("src").OnElements("img")
		p.AllowAttrs("alt", "title").OnElements("img")
		p.AllowAttrs("type").Matching(regexp.MustCompile(`^checkbox$`)).OnElements("input")
		p.AllowAttrs("checked", "disabled").OnElements("input")
		p.AllowAttrs("role").Matching(regexp.MustCompile(`^doc-[a-z]+$`)).OnElements("a", "section", "sup")
		// Headings in user content start at h2; the page title owns h1.
		p.AllowElements("h1")
	}
	policies[opt] = p
	return p
}

// Excerpt returns up to n runes of plain text from Markdown, for previews and OG tags.
func Excerpt(src string, n int) string {
	plain := regexp.MustCompile(`[#*_>\x60\[\]()!~|-]+`).ReplaceAllString(src, " ")
	plain = strings.Join(strings.Fields(plain), " ")
	if utf8.RuneCountInString(plain) <= n {
		return plain
	}
	r := []rune(plain)
	cut := string(r[:n])
	if i := strings.LastIndex(cut, " "); i > n/2 {
		cut = cut[:i]
	}
	return cut + "…"
}
