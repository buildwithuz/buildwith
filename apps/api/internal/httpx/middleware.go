package httpx

import (
	"crypto/subtle"
	"log/slog"
	"net/http"
	"net/url"
	"runtime/debug"
	"strings"
	"time"
)

const (
	SessionCookie = "bw_session"
	CSRFCookie    = "bw_csrf"
	CSRFHeader    = "X-CSRF-Token"
)

// Recover turns a panic into a 500 instead of a dropped connection.
func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				slog.ErrorContext(r.Context(), "panic", "value", v, "stack", string(debug.Stack()))
				WriteError(w, r, nil)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusWriter) WriteHeader(code int) { s.status = code; s.ResponseWriter.WriteHeader(code) }

// Flush keeps server-sent events working through the wrapper.
func (s *statusWriter) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (s *statusWriter) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// Log writes one line per request. It never logs bodies, cookies or query
// strings, which can carry personal data.
func Log(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		slog.InfoContext(r.Context(), "http",
			"method", r.Method, "path", r.URL.Path, "status", sw.status,
			"ms", time.Since(start).Milliseconds())
	})
}

// SecurityHeaders sets conservative defaults for an API that only returns JSON.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// SessionLoader finds the session for the request's cookie.
type SessionLoader func(r *http.Request, token string) (*Session, error)

// Sessions attaches the session (if any) and the response writer to the context.
func Sessions(load SessionLoader) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := withRequest(withWriter(r.Context(), w), r)
			if c, err := r.Cookie(SessionCookie); err == nil && c.Value != "" {
				s, err := load(r, c.Value)
				if err != nil {
					WriteError(w, r, err)
					return
				}
				if s != nil {
					ctx = WithSession(ctx, s)
				}
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// CSRF rejects state-changing requests whose X-CSRF-Token does not match the
// session's token (or, before sign-in, the bw_csrf double-submit cookie), and
// browser requests from a foreign Origin.
func CSRF(publicOrigin string) func(http.Handler) http.Handler {
	allowed, _ := url.Parse(publicOrigin)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
				return
			}
			if o := r.Header.Get("Origin"); o != "" && allowed != nil {
				if u, err := url.Parse(o); err != nil || !strings.EqualFold(u.Host, allowed.Host) {
					WriteError(w, r, Forbidden("cross-origin request"))
					return
				}
			}
			want := ""
			if s := SessionFrom(r.Context()); s != nil {
				want = s.CSRF
			} else if c, err := r.Cookie(CSRFCookie); err == nil {
				want = c.Value
			}
			got := r.Header.Get(CSRFHeader)
			if want == "" || subtle.ConstantTimeCompare([]byte(want), []byte(got)) != 1 {
				WriteError(w, r, Forbidden("missing or wrong CSRF token"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Chain applies middleware so the first one listed runs first.
func Chain(h http.Handler, mw ...func(http.Handler) http.Handler) http.Handler {
	for i := len(mw) - 1; i >= 0; i-- {
		h = mw[i](h)
	}
	return h
}
