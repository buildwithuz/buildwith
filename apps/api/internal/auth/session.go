// Package auth owns sign-in: sessions, Dev login, GitHub and Google OAuth,
// and the Telegram login widget.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/httpx"
)

// Token returns n random bytes, base64url encoded.
func Token(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// hashToken is what we store: a leaked database never yields usable cookies.
func hashToken(t string) []byte {
	h := sha256.Sum256([]byte(t))
	return h[:]
}

// LoadSession is the middleware hook that resolves a cookie to a session.
func LoadSession(a *app.App) httpx.SessionLoader {
	return func(r *http.Request, token string) (*httpx.Session, error) {
		row, err := a.Q.GetSession(r.Context(), hashToken(token))
		if httpx.IsNoRows(err) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		// Touch at most once an hour to keep writes off the hot path.
		_ = a.Q.TouchSession(r.Context(), row.TokenHash)
		return &httpx.Session{TokenHash: row.TokenHash, CSRF: row.CsrfToken, User: row.User}, nil
	}
}

// startSession creates a session for u and sets its cookie on the response.
func startSession(ctx context.Context, a *app.App, u dbgen.User) (string, error) {
	token := Token(32)
	csrf := Token(24)
	ua := ""
	if r := httpx.Request(ctx); r != nil {
		ua = r.UserAgent()
		if len(ua) > 200 {
			ua = ua[:200]
		}
	}
	if _, err := a.Q.CreateSession(ctx, dbgen.CreateSessionParams{
		TokenHash: hashToken(token),
		UserID:    u.ID,
		CsrfToken: csrf,
		UserAgent: ua,
		ExpiresAt: a.Clock.Now().Add(a.Cfg.SessionTTL),
	}); err != nil {
		return "", err
	}
	httpx.SetCookie(ctx, sessionCookie(a, token, int(a.Cfg.SessionTTL.Seconds())))
	return csrf, nil
}

func sessionCookie(a *app.App, value string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     httpx.SessionCookie,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   strings.HasPrefix(a.Cfg.PublicOrigin, "https://"),
		SameSite: http.SameSiteLaxMode,
	}
}

// anonCSRF returns the double-submit token for a signed-out browser, issuing
// one if the request did not carry it.
func anonCSRF(ctx context.Context, a *app.App) string {
	if r := httpx.Request(ctx); r != nil {
		if c, err := r.Cookie(httpx.CSRFCookie); err == nil && len(c.Value) >= 16 {
			return c.Value
		}
	}
	t := Token(24)
	httpx.SetCookie(ctx, &http.Cookie{
		Name: httpx.CSRFCookie, Value: t, Path: "/", MaxAge: int((24 * time.Hour).Seconds()),
		HttpOnly: true, Secure: strings.HasPrefix(a.Cfg.PublicOrigin, "https://"), SameSite: http.SameSiteLaxMode,
	})
	return t
}

var usernameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{1,29}$`)

// Paths on the site that a username must never shadow.
var reserved = map[string]bool{}

func init() {
	for _, w := range strings.Fields(`about admin administrator api app articles assets best bookmarks buildwith
		deleted feeds following guidelines help ishlar korsat l login logout me media mod moderator moderators
		modlog n new notes notifications privacy root rss savol search settings static support system t terms
		top user users welcome write www null undefined`) {
		reserved[w] = true
	}
}

// ValidUsername reports why a username cannot be claimed, or "" if it can.
func ValidUsername(name string) string {
	switch {
	case !usernameRe.MatchString(name):
		return "2-30 letters, digits, - or _, starting with a letter or digit"
	case reserved[strings.ToLower(name)]:
		return "that name is reserved"
	case strings.HasPrefix(strings.ToLower(name), "new_"), strings.HasPrefix(strings.ToLower(name), "deleted_"):
		return "that prefix is reserved"
	}
	return ""
}

// provisionalPrefix marks a username we made up because the provider's handle
// was unusable; the user is asked to pick a real one.
const provisionalPrefix = "new_"

func needsUsername(u dbgen.User) bool { return strings.HasPrefix(u.Username, provisionalPrefix) }

var unsafeChars = regexp.MustCompile(`[^A-Za-z0-9_-]+`)

// suggestUsername derives a free username from a provider handle.
func suggestUsername(ctx context.Context, q *dbgen.Queries, handle string) (string, error) {
	base := strings.Trim(unsafeChars.ReplaceAllString(handle, ""), "-_")
	if len(base) > 26 {
		base = base[:26]
	}
	if ValidUsername(base) == "" {
		taken, err := q.UsernameTaken(ctx, base)
		if err != nil {
			return "", err
		}
		if !taken {
			return base, nil
		}
	}
	for range 10 {
		cand := provisionalPrefix + strings.ToLower(Token(6))
		cand = unsafeChars.ReplaceAllString(cand, "x")
		taken, err := q.UsernameTaken(ctx, cand)
		if err != nil {
			return "", err
		}
		if !taken {
			return cand, nil
		}
	}
	return "", httpx.Conflict("could not find a free username")
}

// safeRedirect keeps post-login redirects on our own site.
func safeRedirect(to string) string {
	if to == "" || !strings.HasPrefix(to, "/") || strings.HasPrefix(to, "//") || strings.HasPrefix(to, "/\\") {
		return "/"
	}
	return to
}
