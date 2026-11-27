package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/clock"
	"github.com/buildwithuz/buildwith/apps/api/internal/config"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/testdb"
)

// env is one running API on a clean database.
type env struct {
	t   *testing.T
	a   *app.App
	srv *httptest.Server
}

func newEnv(t *testing.T) *env {
	t.Helper()
	pool := testdb.Pool(t)
	cfg := config.Config{
		Env: "development", PublicOrigin: "http://localhost:5173", MediaDir: t.TempDir(),
		SessionTTL: 24 * time.Hour,
	}
	a := app.New(cfg, pool, clock.System())
	srv := httptest.NewServer(Handler(a))
	t.Cleanup(srv.Close)
	return &env{t: t, a: a, srv: srv}
}

// user creates an account directly. Accounts are a month old unless fresh is
// set, so new-account limits only apply where a test wants them.
func (e *env) user(name string, karma int, fresh bool) dbgen.User {
	e.t.Helper()
	ctx := context.Background()
	u, err := e.a.Q.CreateUser(ctx, dbgen.CreateUserParams{Username: name, DisplayName: name, Lang: "uz"})
	if err != nil {
		e.t.Fatal(err)
	}
	created := time.Now().Add(-30 * 24 * time.Hour)
	if fresh {
		created = time.Now()
	}
	if _, err := e.a.Pool.Exec(ctx, "update users set karma = $2, created_at = $3 where id = $1", u.ID, karma, created); err != nil {
		e.t.Fatal(err)
	}
	return u
}

func (e *env) mod(name string) dbgen.User {
	u := e.user(name, 500, false)
	if err := e.a.Q.SetModerator(context.Background(), dbgen.SetModeratorParams{ID: u.ID, IsModerator: true}); err != nil {
		e.t.Fatal(err)
	}
	return u
}

// client is a browser: a cookie jar and the CSRF token it was given.
type client struct {
	e    *env
	http *http.Client
	csrf string
}

func (e *env) anon() *client {
	jar, _ := cookiejar.New(nil)
	c := &client{e: e, http: &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}}
	var me struct {
		CsrfToken string `json:"csrf_token"`
	}
	c.do("GET", "/v1/auth/me", nil, &me, 200)
	c.csrf = me.CsrfToken
	return c
}

func (e *env) as(username string) *client {
	c := e.anon()
	var s struct {
		CsrfToken string `json:"csrf_token"`
	}
	c.do("POST", "/v1/auth/dev-login", map[string]string{"username": username}, &s, 200)
	c.csrf = s.CsrfToken
	return c
}

// do sends a request and fails the test unless the status matches.
func (c *client) do(method, path string, body, out any, want int) map[string]any {
	c.e.t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, c.e.srv.URL+path, r)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.csrf != "" {
		req.Header.Set("X-CSRF-Token", c.csrf)
	}
	res, err := c.http.Do(req)
	if err != nil {
		c.e.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode != want {
		c.e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, res.StatusCode, want, raw)
	}
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			c.e.t.Fatalf("%s %s: %v: %s", method, path, err, raw)
		}
	}
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	return m
}

func (c *client) code(method, path string, body any, want int) string {
	c.e.t.Helper()
	m := c.do(method, path, body, nil, want)
	s, _ := m["code"].(string)
	return s
}

type idOnly struct {
	ID int64 `json:"id"`
}

type page[T any] struct {
	Items      []T     `json:"items"`
	NextCursor *string `json:"nextCursor"`
}

type author struct {
	Username string `json:"username"`
}

type noteItem struct {
	ID       int64  `json:"id"`
	Author   author `json:"author"`
	BodyHTML string `json:"body_html"`
}

type linkItem struct {
	ID     int64  `json:"id"`
	Title  string `json:"title"`
	Author author `json:"author"`
}

type commentItem struct {
	ID       int64  `json:"id"`
	Depth    int    `json:"depth"`
	Points   int    `json:"points"`
	BodyHTML string `json:"body_html"`
	Author   author `json:"author"`
}

func authors[T interface{ getAuthor() string }](items []T) map[string]int {
	out := map[string]int{}
	for _, it := range items {
		out[it.getAuthor()]++
	}
	return out
}

func (n noteItem) getAuthor() string    { return n.Author.Username }
func (l linkItem) getAuthor() string    { return l.Author.Username }
func (c commentItem) getAuthor() string { return c.Author.Username }
