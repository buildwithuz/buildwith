package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/buildwithuz/buildwith/apps/api/internal/api"
	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/httpx"
	"github.com/buildwithuz/buildwith/apps/api/internal/media"
	"github.com/buildwithuz/buildwith/apps/api/internal/present"
	"github.com/buildwithuz/buildwith/apps/api/internal/ratelimit"
)

type Auth struct{ A *app.App }

func (h *Auth) sessionInfo(ctx context.Context, u *dbgen.User, csrf string) (api.SessionInfo, error) {
	info := api.SessionInfo{CsrfToken: csrf, DevLoginEnabled: h.A.Cfg.Development()}
	if u != nil {
		pu, err := present.New(h.A.Q, u).User(ctx, *u)
		if err != nil {
			return info, err
		}
		info.User = &pu
		info.NeedsUsername = needsUsername(*u)
	}
	return info, nil
}

func (h *Auth) GetSession(ctx context.Context, _ api.GetSessionRequestObject) (api.GetSessionResponseObject, error) {
	if s := httpx.SessionFrom(ctx); s != nil {
		info, err := h.sessionInfo(ctx, &s.User, s.CSRF)
		return api.GetSession200JSONResponse(info), err
	}
	info, err := h.sessionInfo(ctx, nil, anonCSRF(ctx, h.A))
	return api.GetSession200JSONResponse(info), err
}

func (h *Auth) limitSignIn(ctx context.Context) error {
	ip := "unknown"
	if r := httpx.Request(ctx); r != nil {
		ip = clientIP(r)
	}
	ok, retry, err := h.A.Limiter.Allow(ctx, ratelimit.SignIn, ip)
	if err != nil {
		return err
	}
	if !ok {
		return httpx.RateLimited(retry)
	}
	return nil
}

func (h *Auth) DevLogin(ctx context.Context, req api.DevLoginRequestObject) (api.DevLoginResponseObject, error) {
	if !h.A.Cfg.Development() {
		return nil, httpx.Forbidden("dev login is only available in development")
	}
	u, err := h.A.Q.GetUserByUsername(ctx, strings.TrimPrefix(req.Body.Username, "@"))
	if err != nil {
		return nil, httpx.NotFoundIfNoRows(err, "user")
	}
	csrf, err := startSession(ctx, h.A, u)
	if err != nil {
		return nil, err
	}
	info, err := h.sessionInfo(ctx, &u, csrf)
	return api.DevLogin200JSONResponse(info), err
}

func (h *Auth) Logout(ctx context.Context, _ api.LogoutRequestObject) (api.LogoutResponseObject, error) {
	if s := httpx.SessionFrom(ctx); s != nil {
		if err := h.A.Q.DeleteSession(ctx, s.TokenHash); err != nil {
			return nil, err
		}
	}
	httpx.SetCookie(ctx, sessionCookie(h.A, "", -1))
	return api.Logout204Response{}, nil
}

func (h *Auth) ChooseUsername(ctx context.Context, req api.ChooseUsernameRequestObject) (api.ChooseUsernameResponseObject, error) {
	u, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(req.Body.Username)
	if msg := ValidUsername(name); msg != "" {
		return nil, httpx.Invalid("username", msg)
	}
	if !strings.EqualFold(name, u.Username) {
		taken, err := h.A.Q.UsernameTaken(ctx, name)
		if err != nil {
			return nil, err
		}
		if taken {
			return nil, httpx.Coded(http.StatusConflict, api.ErrorCodeUsernameTaken, "username is taken")
		}
	}
	updated, err := h.A.Q.SetUsername(ctx, dbgen.SetUsernameParams{ID: u.ID, Username: name})
	if err != nil {
		return nil, err
	}
	pu, err := present.New(h.A.Q, &updated).User(ctx, updated)
	return api.ChooseUsername200JSONResponse(pu), err
}

// ---- OAuth -----------------------------------------------------------------

type provider struct {
	authURL, tokenURL, scope string
	creds                    func(*app.App) (string, string)
}

var providers = map[api.OAuthProvider]provider{
	api.OAuthProviderGithub: {
		authURL:  "https://github.com/login/oauth/authorize",
		tokenURL: "https://github.com/login/oauth/access_token",
		scope:    "read:user",
		creds:    func(a *app.App) (string, string) { return a.Cfg.GitHub.ClientID, a.Cfg.GitHub.ClientSecret },
	},
	api.OAuthProviderGoogle: {
		authURL:  "https://accounts.google.com/o/oauth2/v2/auth",
		tokenURL: "https://oauth2.googleapis.com/token",
		scope:    "openid profile",
		creds:    func(a *app.App) (string, string) { return a.Cfg.Google.ClientID, a.Cfg.Google.ClientSecret },
	},
}

func (h *Auth) callbackURL(p api.OAuthProvider) string {
	return fmt.Sprintf("%s/v1/auth/%s/callback", h.A.Cfg.PublicOrigin, p)
}

func (h *Auth) StartOAuth(ctx context.Context, req api.StartOAuthRequestObject) (api.StartOAuthResponseObject, error) {
	p, ok := providers[req.Provider]
	if !ok {
		return nil, httpx.NotFound("provider")
	}
	id, _ := p.creds(h.A)
	if id == "" {
		return nil, httpx.NotConfigured(string(req.Provider) + " sign-in")
	}
	state, verifier := Token(24), Token(48)
	redirect := "/"
	if req.Params.RedirectTo != nil {
		redirect = safeRedirect(*req.Params.RedirectTo)
	}
	if err := h.A.Q.CreateOAuthState(ctx, dbgen.CreateOAuthStateParams{
		State: state, Provider: string(req.Provider), CodeVerifier: verifier, RedirectTo: redirect,
	}); err != nil {
		return nil, err
	}
	challenge := sha256.Sum256([]byte(verifier))
	q := url.Values{
		"client_id":             {id},
		"redirect_uri":          {h.callbackURL(req.Provider)},
		"response_type":         {"code"},
		"scope":                 {p.scope},
		"state":                 {state},
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(challenge[:])},
		"code_challenge_method": {"S256"},
	}
	loc := p.authURL + "?" + q.Encode()
	return api.StartOAuth303Response{Headers: api.StartOAuth303ResponseHeaders{Location: &loc}}, nil
}

type identity struct {
	subject, handle, name, avatar string
}

func (h *Auth) FinishOAuth(ctx context.Context, req api.FinishOAuthRequestObject) (api.FinishOAuthResponseObject, error) {
	if err := h.limitSignIn(ctx); err != nil {
		return nil, err
	}
	p, ok := providers[req.Provider]
	if !ok {
		return nil, httpx.NotFound("provider")
	}
	st, err := h.A.Q.TakeOAuthState(ctx, req.Params.State)
	if err != nil || st.Provider != string(req.Provider) {
		return nil, httpx.BadRequest("sign-in link expired, please try again")
	}
	token, err := h.exchange(ctx, p, req.Provider, req.Params.Code, st.CodeVerifier)
	if err != nil {
		slog.WarnContext(ctx, "oauth exchange failed", "provider", req.Provider, "err", err)
		return nil, httpx.BadRequest("could not finish signing in")
	}
	id, err := h.profile(ctx, req.Provider, token)
	if err != nil {
		slog.WarnContext(ctx, "oauth profile failed", "provider", req.Provider, "err", err)
		return nil, httpx.BadRequest("could not read your profile")
	}
	u, err := h.signInIdentity(ctx, string(req.Provider), id)
	if err != nil {
		return nil, err
	}
	if _, err := startSession(ctx, h.A, u); err != nil {
		return nil, err
	}
	loc := st.RedirectTo
	if needsUsername(u) {
		loc = "/welcome?next=" + url.QueryEscape(st.RedirectTo)
	}
	return api.FinishOAuth303Response{Headers: api.FinishOAuth303ResponseHeaders{Location: &loc}}, nil
}

func (h *Auth) exchange(ctx context.Context, p provider, name api.OAuthProvider, code, verifier string) (string, error) {
	id, secret := p.creds(h.A)
	form := url.Values{
		"client_id": {id}, "client_secret": {secret}, "code": {code},
		"redirect_uri": {h.callbackURL(name)}, "grant_type": {"authorization_code"}, "code_verifier": {verifier},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	res, body, err := h.A.Fetch.Do(req)
	if err != nil {
		return "", err
	}
	var tok struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := json.Unmarshal(body, &tok); err != nil || tok.AccessToken == "" {
		return "", fmt.Errorf("token endpoint %d: %s", res.StatusCode, tok.Error)
	}
	return tok.AccessToken, nil
}

func (h *Auth) profile(ctx context.Context, p api.OAuthProvider, token string) (identity, error) {
	endpoint := "https://api.github.com/user"
	if p == api.OAuthProviderGoogle {
		endpoint = "https://openidconnect.googleapis.com/v1/userinfo"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return identity{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	res, body, err := h.A.Fetch.Do(req)
	if err != nil {
		return identity{}, err
	}
	if res.StatusCode != http.StatusOK {
		return identity{}, fmt.Errorf("profile endpoint returned %d", res.StatusCode)
	}
	if p == api.OAuthProviderGithub {
		var gh struct {
			ID     int64  `json:"id"`
			Login  string `json:"login"`
			Name   string `json:"name"`
			Avatar string `json:"avatar_url"`
		}
		if err := json.Unmarshal(body, &gh); err != nil || gh.ID == 0 {
			return identity{}, fmt.Errorf("github profile: %w", err)
		}
		return identity{subject: strconv.FormatInt(gh.ID, 10), handle: gh.Login, name: gh.Name, avatar: gh.Avatar}, nil
	}
	var g struct {
		Sub     string `json:"sub"`
		Name    string `json:"name"`
		Picture string `json:"picture"`
	}
	if err := json.Unmarshal(body, &g); err != nil || g.Sub == "" {
		return identity{}, fmt.Errorf("google profile: %w", err)
	}
	// Google has no handle; the first name is a reasonable starting point.
	handle := strings.Fields(g.Name + " user")[0]
	return identity{subject: g.Sub, handle: handle, name: g.Name, avatar: g.Picture}, nil
}

// signInIdentity finds the user behind an external identity, links it to the
// signed-in user, or creates a new account.
func (h *Auth) signInIdentity(ctx context.Context, providerName string, id identity) (dbgen.User, error) {
	existing, err := h.A.Q.GetUserByIdentity(ctx, dbgen.GetUserByIdentityParams{Provider: providerName, Subject: id.subject})
	if err == nil {
		return existing, nil
	}
	if !httpx.IsNoRows(err) {
		return dbgen.User{}, err
	}

	// Signed in already: this links another way to sign in to the same account.
	if v := httpx.Viewer(ctx); v != nil {
		if _, err := h.A.Q.CreateIdentity(ctx, dbgen.CreateIdentityParams{
			UserID: v.ID, Provider: providerName, Subject: id.subject, Handle: id.handle,
		}); err != nil {
			return dbgen.User{}, err
		}
		if providerName == "github" {
			_ = h.A.Q.GrantBadge(ctx, dbgen.GrantBadgeParams{UserID: v.ID, Kind: "github", Detail: id.handle})
		}
		return *v, nil
	}

	name, err := suggestUsername(ctx, h.A.Q, id.handle)
	if err != nil {
		return dbgen.User{}, err
	}
	avatar := h.importAvatar(ctx, id.avatar)
	display := id.name
	if r := []rune(display); len(r) > 60 {
		display = string(r[:60])
	}

	var u dbgen.User
	err = h.A.Tx(ctx, func(q *dbgen.Queries) error {
		var err error
		u, err = q.CreateUser(ctx, dbgen.CreateUserParams{
			Username: name, DisplayName: display, Lang: "uz", AvatarMedia: avatar,
		})
		if err != nil {
			return err
		}
		if _, err := q.CreateIdentity(ctx, dbgen.CreateIdentityParams{
			UserID: u.ID, Provider: providerName, Subject: id.subject, Handle: id.handle,
		}); err != nil {
			return err
		}
		if providerName == "github" {
			if err := q.GrantBadge(ctx, dbgen.GrantBadgeParams{UserID: u.ID, Kind: "github", Detail: id.handle}); err != nil {
				return err
			}
		}
		return nil
	})
	return u, err
}

// importAvatar copies a provider avatar into our media store, best effort: a
// failure just means no avatar.
func (h *Auth) importAvatar(ctx context.Context, src string) *int64 {
	if src == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	_, body, err := h.A.Fetch.Get(ctx, src, "image/*")
	if err != nil {
		return nil
	}
	img, err := media.Process(strings.NewReader(string(body)), media.Avatar)
	if err != nil {
		return nil
	}
	if err := h.A.Media.Put(ctx, img.Name(), img.Data); err != nil {
		return nil
	}
	m, err := h.A.Q.CreateMedia(ctx, dbgen.CreateMediaParams{
		Sha256: img.SHA256, Kind: string(media.Avatar), Mime: img.Mime,
		Width: int32(img.Width), Height: int32(img.Height), Bytes: int32(len(img.Data)),
	})
	if err != nil {
		return nil
	}
	return &m.ID
}

// ---- Telegram ----------------------------------------------------------------

func (h *Auth) TelegramLogin(ctx context.Context, req api.TelegramLoginRequestObject) (api.TelegramLoginResponseObject, error) {
	if !h.A.Cfg.Telegram.Configured() {
		return nil, httpx.NotConfigured("Telegram sign-in")
	}
	if err := h.limitSignIn(ctx); err != nil {
		return nil, err
	}
	b := req.Body
	if err := VerifyTelegram(*b, h.A.Cfg.Telegram.BotToken, h.A.Clock.Now()); err != nil {
		return nil, httpx.BadRequest(err.Error())
	}
	handle, name := "", ""
	if b.Username != nil {
		handle = *b.Username
	}
	if b.FirstName != nil {
		name = *b.FirstName
	}
	if b.LastName != nil {
		name = strings.TrimSpace(name + " " + *b.LastName)
	}
	if handle == "" {
		handle = name
	}
	avatar := ""
	if b.PhotoUrl != nil && strings.HasPrefix(*b.PhotoUrl, "https://t.me/") {
		avatar = *b.PhotoUrl
	}
	u, err := h.signInIdentity(ctx, "telegram", identity{
		subject: strconv.FormatInt(b.Id, 10), handle: handle, name: name, avatar: avatar,
	})
	if err != nil {
		return nil, err
	}
	csrf, err := startSession(ctx, h.A, u)
	if err != nil {
		return nil, err
	}
	info, err := h.sessionInfo(ctx, &u, csrf)
	return api.TelegramLogin200JSONResponse(info), err
}

// VerifyTelegram checks a login widget payload as Telegram specifies: an
// HMAC-SHA256 over the sorted fields, keyed by SHA256(bot token), at most a day old.
func VerifyTelegram(b api.TelegramAuth, botToken string, now time.Time) error {
	fields := map[string]string{
		"id":        strconv.FormatInt(b.Id, 10),
		"auth_date": strconv.FormatInt(b.AuthDate, 10),
	}
	for k, v := range map[string]*string{
		"first_name": b.FirstName, "last_name": b.LastName, "username": b.Username, "photo_url": b.PhotoUrl,
	} {
		if v != nil {
			fields[k] = *v
		}
	}
	keys := make([]string, 0, len(fields))
	for k := range fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	lines := make([]string, len(keys))
	for i, k := range keys {
		lines[i] = k + "=" + fields[k]
	}
	secret := sha256.Sum256([]byte(botToken))
	mac := hmac.New(sha256.New, secret[:])
	mac.Write([]byte(strings.Join(lines, "\n")))
	want := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(want), []byte(strings.ToLower(b.Hash))) {
		return fmt.Errorf("telegram signature does not match")
	}
	age := now.Sub(time.Unix(b.AuthDate, 0))
	if age > 24*time.Hour || age < -5*time.Minute {
		return fmt.Errorf("telegram sign-in expired")
	}
	return nil
}

// clientIP trusts X-Forwarded-For only from the reverse proxy in front of us,
// which in every supported deployment is on loopback or the compose network.
func clientIP(r *http.Request) string {
	host := r.RemoteAddr
	if i := strings.LastIndexByte(host, ':'); i > 0 {
		host = host[:i]
	}
	host = strings.Trim(host, "[]")
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" && isTrustedProxy(host) {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[len(parts)-1])
	}
	return host
}

func isTrustedProxy(ip string) bool {
	return ip == "127.0.0.1" || ip == "::1" || strings.HasPrefix(ip, "172.") || strings.HasPrefix(ip, "10.")
}
