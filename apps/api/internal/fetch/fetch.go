// Package fetch is the only way the server talks to the outside web. Every
// connection is checked at dial time, after DNS, so a hostname that resolves to
// a private address (or rebinds to one) is refused.
package fetch

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"syscall"
	"time"

	"golang.org/x/net/html"
)

const UserAgent = "buildwith.uz-bot/1.0 (+https://buildwith.uz/about)"

var ErrBlockedAddress = errors.New("fetch: destination address is not public")

type Client struct {
	http     *http.Client
	maxBytes int64
}

type Options struct {
	Timeout  time.Duration
	MaxBytes int64
	// allowPrivate exists only so tests can talk to httptest servers on loopback.
	allowPrivate bool
}

func New(opt Options) *Client {
	if opt.Timeout == 0 {
		opt.Timeout = 8 * time.Second
	}
	if opt.MaxBytes == 0 {
		opt.MaxBytes = 2 << 20
	}
	dialer := &net.Dialer{
		Timeout: 5 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			if opt.allowPrivate {
				return nil
			}
			ap, err := netip.ParseAddrPort(address)
			if err != nil || !IsPublic(ap.Addr()) {
				return ErrBlockedAddress
			}
			return nil
		},
	}
	transport := &http.Transport{
		Proxy:                 nil, // never route through an environment proxy
		DialContext:           dialer.DialContext,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 6 * time.Second,
		MaxIdleConns:          20,
		IdleConnTimeout:       30 * time.Second,
	}
	return &Client{
		maxBytes: opt.MaxBytes,
		http: &http.Client{
			Timeout:   opt.Timeout,
			Transport: transport,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 5 {
					return errors.New("fetch: too many redirects")
				}
				if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
					return errors.New("fetch: redirect to a non-http scheme")
				}
				return nil
			},
		},
	}
}

// IsPublic reports whether addr is a globally routable unicast address.
func IsPublic(addr netip.Addr) bool {
	addr = addr.Unmap()
	if !addr.IsValid() || addr.IsLoopback() || addr.IsPrivate() || addr.IsLinkLocalUnicast() ||
		addr.IsLinkLocalMulticast() || addr.IsMulticast() || addr.IsUnspecified() || addr.IsInterfaceLocalMulticast() {
		return false
	}
	for _, p := range blockedPrefixes {
		if p.Contains(addr) {
			return false
		}
	}
	return true
}

var blockedPrefixes = []netip.Prefix{
	netip.MustParsePrefix("100.64.0.0/10"),   // carrier-grade NAT
	netip.MustParsePrefix("192.0.0.0/24"),    // IETF protocol assignments
	netip.MustParsePrefix("192.0.2.0/24"),    // documentation
	netip.MustParsePrefix("198.18.0.0/15"),   // benchmarking
	netip.MustParsePrefix("198.51.100.0/24"), // documentation
	netip.MustParsePrefix("203.0.113.0/24"),  // documentation
	netip.MustParsePrefix("240.0.0.0/4"),     // reserved
	netip.MustParsePrefix("64:ff9b::/96"),    // NAT64 can reach IPv4 private space
	netip.MustParsePrefix("2001:db8::/32"),   // documentation
}

// Get fetches url and returns at most MaxBytes of the body.
func (c *Client) Get(ctx context.Context, rawURL, accept string) (*http.Response, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, nil, err
	}
	if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
		return nil, nil, errors.New("fetch: only http and https")
	}
	req.Header.Set("User-Agent", UserAgent)
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, c.maxBytes))
	if err != nil {
		return nil, nil, err
	}
	if res.StatusCode >= 400 {
		return res, nil, fmt.Errorf("fetch: %s returned %d", rawURL, res.StatusCode)
	}
	return res, body, nil
}

// Page is what we read from a page's <head>.
type Page struct {
	Title       string
	Description string
	Image       string
	SiteName    string
}

// Preview fetches an HTML page and reads its title and Open Graph tags.
func (c *Client) Preview(ctx context.Context, rawURL string) (Page, error) {
	res, body, err := c.Get(ctx, rawURL, "text/html,application/xhtml+xml")
	if err != nil {
		return Page{}, err
	}
	if ct := res.Header.Get("Content-Type"); ct != "" && !strings.Contains(ct, "html") {
		return Page{}, fmt.Errorf("fetch: %s is %s, not HTML", rawURL, ct)
	}
	p := ParseHead(string(body))
	if p.Image != "" {
		if u, err := res.Request.URL.Parse(p.Image); err == nil {
			p.Image = u.String()
		}
	}
	return p, nil
}

// ParseHead extracts title and Open Graph metadata, preferring og: values.
func ParseHead(doc string) Page {
	var p Page
	var title string
	z := html.NewTokenizer(strings.NewReader(doc))
	inTitle := false
	for {
		switch z.Next() {
		case html.ErrorToken:
			if p.Title == "" {
				p.Title = title
			}
			p.Title = clean(p.Title, 200)
			p.Description = clean(p.Description, 400)
			p.SiteName = clean(p.SiteName, 80)
			return p
		case html.StartTagToken, html.SelfClosingTagToken:
			t := z.Token()
			switch t.Data {
			case "title":
				inTitle = true
			case "meta":
				var key, content string
				for _, a := range t.Attr {
					switch a.Key {
					case "property", "name":
						key = strings.ToLower(a.Val)
					case "content":
						content = a.Val
					}
				}
				switch key {
				case "og:title", "twitter:title":
					if p.Title == "" {
						p.Title = content
					}
				case "og:description", "description", "twitter:description":
					if p.Description == "" {
						p.Description = content
					}
				case "og:image", "twitter:image":
					if p.Image == "" {
						p.Image = content
					}
				case "og:site_name":
					p.SiteName = content
				}
			case "body":
				// Everything we need is in <head>; stop reading.
				if p.Title == "" {
					p.Title = title
				}
				p.Title = clean(p.Title, 200)
				p.Description = clean(p.Description, 400)
				p.SiteName = clean(p.SiteName, 80)
				return p
			}
		case html.EndTagToken:
			if z.Token().Data == "title" {
				inTitle = false
			}
		case html.TextToken:
			if inTitle && title == "" {
				title = string(z.Text())
			}
		}
	}
}

func clean(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	r := []rune(s)
	if len(r) > n {
		return string(r[:n-1]) + "…"
	}
	return s
}
