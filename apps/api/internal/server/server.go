// Package server assembles the domain handlers into one HTTP handler.
package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"

	"github.com/buildwithuz/buildwith/apps/api/internal/api"
	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/articles"
	"github.com/buildwithuz/buildwith/apps/api/internal/auth"
	"github.com/buildwithuz/buildwith/apps/api/internal/comments"
	"github.com/buildwithuz/buildwith/apps/api/internal/httpx"
	"github.com/buildwithuz/buildwith/apps/api/internal/links"
	"github.com/buildwithuz/buildwith/apps/api/internal/mediahttp"
	"github.com/buildwithuz/buildwith/apps/api/internal/mod"
	"github.com/buildwithuz/buildwith/apps/api/internal/notes"
	"github.com/buildwithuz/buildwith/apps/api/internal/notify"
	"github.com/buildwithuz/buildwith/apps/api/internal/search"
	"github.com/buildwithuz/buildwith/apps/api/internal/social"
	"github.com/buildwithuz/buildwith/apps/api/internal/system"
	"github.com/buildwithuz/buildwith/apps/api/internal/timeline"
	"github.com/buildwithuz/buildwith/apps/api/internal/users"
	"github.com/buildwithuz/buildwith/apps/api/internal/votes"
)

// Server implements every operation in the OpenAPI contract by embedding one
// handler per domain. A missing operation is a compile error.
type Server struct {
	*system.System
	*auth.Auth
	*users.Users
	*social.Social
	*mediahttp.Media
	*links.Links
	*comments.Comments
	*votes.Votes
	*notes.Notes
	*articles.Articles
	*timeline.Timeline
	*notify.Notify
	*search.Finder
	*mod.Mod
}

var _ api.StrictServerInterface = (*Server)(nil)

func New(a *app.App) *Server {
	return &Server{
		System: &system.System{A: a}, Auth: &auth.Auth{A: a}, Users: &users.Users{A: a},
		Social: &social.Social{A: a}, Media: &mediahttp.Media{A: a}, Links: &links.Links{A: a},
		Comments: &comments.Comments{A: a}, Votes: &votes.Votes{A: a}, Notes: &notes.Notes{A: a},
		Articles: &articles.Articles{A: a}, Timeline: &timeline.Timeline{A: a}, Notify: &notify.Notify{A: a},
		Finder: &search.Finder{A: a}, Mod: &mod.Mod{A: a},
	}
}

// Handler returns the full HTTP handler: /v1/* for the API and, in
// development, /media/* (production serves media straight from Caddy).
func Handler(a *app.App) http.Handler {
	strict := api.NewStrictHandlerWithOptions(New(a), nil, api.StrictHTTPServerOptions{
		RequestErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			httpx.WriteError(w, r, httpx.BadRequest(err.Error()))
		},
		ResponseErrorHandlerFunc: httpx.WriteError,
	})

	apiMux := http.NewServeMux()
	v1 := api.HandlerWithOptions(strict, api.StdHTTPServerOptions{
		BaseURL:    "/v1",
		BaseRouter: apiMux,
		ErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			httpx.WriteError(w, r, httpx.BadRequest(err.Error()))
		},
	})

	root := http.NewServeMux()
	root.Handle("/v1/", httpx.Chain(v1,
		httpx.SecurityHeaders,
		httpx.Sessions(auth.LoadSession(a)),
		httpx.CSRF(a.Cfg.PublicOrigin),
		maxBody(12<<20),
	))
	if a.Cfg.Development() {
		fs := http.FileServer(http.Dir(filepath.Clean(a.Cfg.MediaDir)))
		root.Handle("/media/", http.StripPrefix("/media/", fs))
	}
	root.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(api.Error{Code: api.ErrorCodeNotFound, Message: "no such endpoint"})
	})
	return httpx.Chain(root, httpx.Recover, httpx.Log)
}

func maxBody(n int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, n)
			next.ServeHTTP(w, r)
		})
	}
}

// Logger configures slog for the process: JSON in production, text locally.
func Logger(production bool) *slog.Logger {
	if production {
		return slog.New(slog.NewJSONHandler(os.Stdout, nil))
	}
	return slog.New(slog.NewTextHandler(os.Stdout, nil))
}
