// Package urlx canonicalizes submitted URLs so the same article posted with
// different tracking parameters, schemes or hosts is recognised as a duplicate.
package urlx

import (
	"crypto/sha256"
	"errors"
	"net"
	"net/url"
	"path"
	"sort"
	"strings"
)

var ErrUnsupported = errors.New("only public http and https URLs are allowed")

var trackingParams = map[string]bool{
	"fbclid": true, "gclid": true, "yclid": true, "dclid": true, "msclkid": true, "igshid": true,
	"ref": true, "ref_src": true, "ref_url": true, "source": true, "si": true, "feature": true,
	"mc_cid": true, "mc_eid": true, "_hsenc": true, "_hsmi": true, "spm": true,
}

// hostAliases maps mobile and short hosts to the canonical one.
var hostAliases = map[string]string{
	"m.youtube.com":        "youtube.com",
	"mobile.twitter.com":   "x.com",
	"twitter.com":          "x.com",
	"mobile.x.com":         "x.com",
	"m.facebook.com":       "facebook.com",
	"en.m.wikipedia.org":   "en.wikipedia.org",
	"uz.m.wikipedia.org":   "uz.wikipedia.org",
	"ru.m.wikipedia.org":   "ru.wikipedia.org",
	"old.reddit.com":       "reddit.com",
	"np.reddit.com":        "reddit.com",
	"news.ycombinator.com": "news.ycombinator.com",
}

// Canonical is a URL ready to store and compare.
type Canonical struct {
	URL    string // normalized form, used for display and links
	Key    string // scheme-less comparison key
	Hash   []byte // sha256(Key), indexed for duplicate detection
	Domain string // what readers see next to the title, e.g. "github.com/golang"
}

// Canonicalize validates raw and returns its canonical form.
func Canonicalize(raw string) (Canonical, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return Canonical{}, ErrUnsupported
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return Canonical{}, ErrUnsupported
	}
	if u.User != nil {
		return Canonical{}, ErrUnsupported
	}

	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if ip := net.ParseIP(host); ip != nil {
		return Canonical{}, ErrUnsupported // bare IPs are almost always spam or internal
	}
	if !strings.Contains(host, ".") || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") ||
		host == "localhost" {
		return Canonical{}, ErrUnsupported
	}
	host = strings.TrimPrefix(host, "www.")
	if alias, ok := hostAliases[host]; ok {
		host = alias
	}
	if (scheme == "http" && port == "80") || (scheme == "https" && port == "443") {
		port = ""
	}

	p := u.EscapedPath()
	q := u.Query()

	// youtu.be/ID → youtube.com/watch?v=ID
	if host == "youtu.be" && len(p) > 1 {
		q.Set("v", strings.Trim(p, "/"))
		host, p = "youtube.com", "/watch"
	}

	for k := range q {
		lk := strings.ToLower(k)
		if strings.HasPrefix(lk, "utm_") || trackingParams[lk] {
			q.Del(k)
		}
	}
	if p == "" {
		p = "/"
	}
	if p != "/" {
		p = strings.TrimSuffix(path.Clean(p), "/")
		if strings.HasSuffix(p, "/index.html") || strings.HasSuffix(p, "/index.php") {
			p = path.Dir(p)
		}
	}

	hostport := host
	if port != "" {
		hostport = net.JoinHostPort(host, port)
	}
	query := encodeSorted(q)
	key := hostport + p
	if query != "" {
		key += "?" + query
	}
	sum := sha256.Sum256([]byte(key))

	return Canonical{
		URL:    "https://" + key,
		Key:    key,
		Hash:   sum[:],
		Domain: displayDomain(host, p),
	}, nil
}

// Scheme is kept out of Key so http and https dedupe, but the stored URL keeps
// http when that is all the site serves.
func KeepScheme(c Canonical, raw string) string {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(raw)), "http://") {
		return "http://" + c.Key
	}
	return c.URL
}

func encodeSorted(q url.Values) string {
	keys := make([]string, 0, len(q))
	for k := range q {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, k := range keys {
		vs := q[k]
		sort.Strings(vs)
		for _, v := range vs {
			if b.Len() > 0 {
				b.WriteByte('&')
			}
			b.WriteString(url.QueryEscape(k))
			b.WriteByte('=')
			b.WriteString(url.QueryEscape(v))
		}
	}
	return b.String()
}

// Hosts where the first path segment names the author, so "github.com/golang"
// says more than "github.com".
var userHosts = map[string]bool{
	"github.com": true, "gitlab.com": true, "medium.com": true, "t.me": true, "x.com": true,
	"dev.to": true, "habr.com": false, "codeberg.org": true, "sr.ht": true, "youtube.com": false,
}

func displayDomain(host, p string) string {
	if userHosts[host] {
		seg := strings.SplitN(strings.Trim(p, "/"), "/", 2)[0]
		if seg != "" && !strings.ContainsAny(seg, "?#") {
			return host + "/" + strings.ToLower(seg)
		}
	}
	return host
}
