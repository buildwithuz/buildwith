package httpx

import (
	"context"
	"net/http"

	"github.com/buildwithuz/buildwith/apps/api/internal/api"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
)

type ctxKey int

const (
	viewerKey ctxKey = iota
	sessionKey
	writerKey
	requestKey
)

// Session is what the session middleware found for this request.
type Session struct {
	TokenHash []byte
	CSRF      string
	User      dbgen.User
}

func WithSession(ctx context.Context, s *Session) context.Context {
	return context.WithValue(ctx, sessionKey, s)
}

// SessionFrom returns the request's session, or nil when nobody is signed in.
func SessionFrom(ctx context.Context) *Session {
	s, _ := ctx.Value(sessionKey).(*Session)
	return s
}

// Viewer returns the signed-in user, or nil.
func Viewer(ctx context.Context) *dbgen.User {
	if s := SessionFrom(ctx); s != nil {
		return &s.User
	}
	return nil
}

// ViewerID returns the signed-in user's id for SQL visibility filters, or nil.
func ViewerID(ctx context.Context) *int64 {
	if u := Viewer(ctx); u != nil {
		return &u.ID
	}
	return nil
}

// RequireViewer returns the signed-in user or a 401.
func RequireViewer(ctx context.Context) (*dbgen.User, error) {
	u := Viewer(ctx)
	if u == nil {
		return nil, Unauthorized()
	}
	return u, nil
}

// RequireActive is RequireViewer for actions a banned account may not take.
func RequireActive(ctx context.Context) (*dbgen.User, error) {
	u, err := RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	if u.BannedAt != nil {
		return nil, Coded(http.StatusForbidden, api.ErrorCodeBanned, "this account is banned")
	}
	return u, nil
}

// RequireModerator returns the signed-in moderator or a 401/403.
func RequireModerator(ctx context.Context) (*dbgen.User, error) {
	u, err := RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	if !u.IsModerator && !u.IsAdmin {
		return nil, Forbidden("moderators only")
	}
	return u, nil
}

// The generated strict handlers never see the ResponseWriter, but signing in and
// out has to set cookies; the middleware stashes it here for exactly that.
func withWriter(ctx context.Context, w http.ResponseWriter) context.Context {
	return context.WithValue(ctx, writerKey, w)
}

func withRequest(ctx context.Context, r *http.Request) context.Context {
	return context.WithValue(ctx, requestKey, r)
}

// SetCookie sets a cookie on the response being built for ctx.
func SetCookie(ctx context.Context, c *http.Cookie) {
	if w, ok := ctx.Value(writerKey).(http.ResponseWriter); ok {
		http.SetCookie(w, c)
	}
}

// Request returns the incoming request, for the few handlers that need headers.
func Request(ctx context.Context) *http.Request {
	r, _ := ctx.Value(requestKey).(*http.Request)
	return r
}
