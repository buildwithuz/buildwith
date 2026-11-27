// Package users owns profiles: reading, editing, README, avatars, pinned
// GitHub repositories, activity, export and account deletion.
package users

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/buildwithuz/buildwith/apps/api/internal/api"
	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/httpx"
	"github.com/buildwithuz/buildwith/apps/api/internal/markdown"
	"github.com/buildwithuz/buildwith/apps/api/internal/present"
	"github.com/buildwithuz/buildwith/apps/api/internal/rank"
)

type Users struct{ A *app.App }

func (h *Users) GetProfile(ctx context.Context, req api.GetProfileRequestObject) (api.GetProfileResponseObject, error) {
	u, err := h.A.Q.GetUserByUsername(ctx, strings.TrimPrefix(req.Username, "@"))
	if err != nil {
		return nil, httpx.NotFoundIfNoRows(err, "user")
	}
	v := httpx.Viewer(ctx)
	p := present.New(h.A.Q, v)
	pu, err := p.User(ctx, u)
	if err != nil {
		return nil, err
	}
	links, err := h.A.Q.ListUserLinks(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	stack, err := h.A.Q.ListUserStack(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	repos, err := h.A.Q.ListUserRepos(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	counts, err := h.A.Q.CountUserContent(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	out := api.Profile{
		User:       pu,
		ReadmeHtml: u.ReadmeHtml,
		Links:      make([]api.ProfileLink, 0, len(links)),
		Stack:      make([]string, 0, len(stack)),
		Repos:      make([]api.Repo, 0, len(repos)),
	}
	for _, l := range links {
		out.Links = append(out.Links, api.ProfileLink{Kind: api.ProfileLinkKind(l.Kind), Url: l.Url})
	}
	for _, s := range stack {
		out.Stack = append(out.Stack, s.Name)
	}
	for _, r := range repos {
		out.Repos = append(out.Repos, api.Repo{
			FullName: r.FullName, Url: r.Url, Description: nonEmpty(r.Description),
			Language: nonEmpty(r.Language), Stars: present.Ptr(int(r.Stars)),
		})
	}
	out.Counts.Links, out.Counts.Notes = int(counts.Links), int(counts.Notes)
	out.Counts.Articles, out.Counts.Comments = int(counts.Articles), int(counts.Comments)
	out.Counts.Followers, out.Counts.Following = int(counts.Followers), int(counts.Following)
	if v != nil {
		if v.ID == u.ID {
			out.ReadmeMd = present.Ptr(u.ReadmeMd)
		} else {
			rel, err := h.A.Q.RelationTo(ctx, dbgen.RelationToParams{ViewerID: v.ID, OtherID: u.ID})
			if err != nil {
				return nil, err
			}
			out.Relation = &api.Relation{Following: rel.Following, FollowedBy: rel.FollowedBy,
				Blocking: rel.Blocking, Muting: rel.Muting}
		}
	}
	return api.GetProfile200JSONResponse(out), nil
}

func nonEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func pick(p *string, cur string, field string, max int) (string, error) {
	if p == nil {
		return cur, nil
	}
	s := strings.TrimSpace(*p)
	if utf8.RuneCountInString(s) > max {
		return "", httpx.Invalid(field, fmt.Sprintf("at most %d characters", max))
	}
	return s, nil
}

func (h *Users) UpdateMe(ctx context.Context, req api.UpdateMeRequestObject) (api.UpdateMeResponseObject, error) {
	v, err := httpx.RequireActive(ctx)
	if err != nil {
		return nil, err
	}
	b := req.Body
	arg := dbgen.UpdateProfileParams{ID: v.ID, OpenToWork: v.OpenToWork, Accent: v.Accent}
	for _, f := range []struct {
		in    *string
		cur   string
		out   *string
		name  string
		limit int
	}{
		{b.DisplayName, v.DisplayName, &arg.DisplayName, "display_name", 60},
		{b.Pronouns, v.Pronouns, &arg.Pronouns, "pronouns", 24},
		{b.Bio, v.Bio, &arg.Bio, "bio", 160},
		{b.RoleTitle, v.RoleTitle, &arg.RoleTitle, "role_title", 60},
		{b.Company, v.Company, &arg.Company, "company", 60},
		{b.Location, v.Location, &arg.Location, "location", 60},
	} {
		if *f.out, err = pick(f.in, f.cur, f.name, f.limit); err != nil {
			return nil, err
		}
	}
	if b.OpenToWork != nil {
		arg.OpenToWork = *b.OpenToWork
	}
	if b.Accent != nil {
		arg.Accent = string(*b.Accent)
	}
	if b.Links != nil {
		for i, l := range *b.Links {
			if err := validProfileLink(l); err != nil {
				return nil, httpx.Invalid(fmt.Sprintf("links[%d]", i), err.Error())
			}
		}
	}
	var updated dbgen.User
	err = h.A.Tx(ctx, func(q *dbgen.Queries) error {
		var err error
		if updated, err = q.UpdateProfile(ctx, arg); err != nil {
			return err
		}
		if b.Links != nil {
			if err := q.ReplaceUserLinks(ctx, v.ID); err != nil {
				return err
			}
			for i, l := range *b.Links {
				if err := q.AddUserLink(ctx, dbgen.AddUserLinkParams{UserID: v.ID, Kind: string(l.Kind),
					Url: strings.TrimSpace(l.Url), Sort: int16(i)}); err != nil {
					return err
				}
			}
		}
		if b.Stack != nil {
			if err := q.ReplaceUserStack(ctx, v.ID); err != nil {
				return err
			}
			for i, name := range *b.Stack {
				name = strings.TrimSpace(name)
				if name == "" || utf8.RuneCountInString(name) > 30 {
					continue
				}
				if err := q.AddUserStack(ctx, dbgen.AddUserStackParams{UserID: v.ID, Name: name, Sort: int16(i)}); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	pu, err := present.New(h.A.Q, &updated).User(ctx, updated)
	return api.UpdateMe200JSONResponse(pu), err
}

func validProfileLink(l api.ProfileLink) error {
	raw := strings.TrimSpace(l.Url)
	if l.Kind == api.ProfileLinkKindEmail {
		if !strings.Contains(raw, "@") || strings.ContainsAny(raw, " <>\"") {
			return fmt.Errorf("not an email address")
		}
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return fmt.Errorf("must be an http(s) URL")
	}
	return nil
}

func (h *Users) UpdatePreferences(ctx context.Context, req api.UpdatePreferencesRequestObject) (api.UpdatePreferencesResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	arg := dbgen.UpdatePreferencesParams{ID: v.ID, Lang: v.Lang, Script: v.Script, Theme: v.Theme}
	if req.Body.Lang != nil {
		arg.Lang = string(*req.Body.Lang)
	}
	if req.Body.Script != nil {
		arg.Script = string(*req.Body.Script)
	}
	if req.Body.Theme != nil {
		arg.Theme = string(*req.Body.Theme)
	}
	u, err := h.A.Q.UpdatePreferences(ctx, arg)
	if err != nil {
		return nil, err
	}
	pu, err := present.New(h.A.Q, &u).User(ctx, u)
	return api.UpdatePreferences200JSONResponse(pu), err
}

func (h *Users) UpdateReadme(ctx context.Context, req api.UpdateReadmeRequestObject) (api.UpdateReadmeResponseObject, error) {
	v, err := httpx.RequireActive(ctx)
	if err != nil {
		return nil, err
	}
	if utf8.RuneCountInString(req.Body.BodyMd) > 20000 {
		return nil, httpx.Invalid("body_md", "at most 20000 characters")
	}
	r := markdown.Render(req.Body.BodyMd, markdown.Options{
		Profile: markdown.Article, NoFollow: int(v.Karma) < rank.KarmaForFollowLinks,
	})
	if err := h.A.Q.UpdateReadme(ctx, dbgen.UpdateReadmeParams{ID: v.ID, ReadmeMd: req.Body.BodyMd, ReadmeHtml: r.HTML}); err != nil {
		return nil, err
	}
	return api.UpdateReadme200JSONResponse{BodyHtml: r.HTML}, nil
}

func (h *Users) ownMedia(ctx context.Context, v *dbgen.User, id *int64, kind string) (*int64, error) {
	if id == nil {
		return nil, nil
	}
	m, err := h.A.Q.GetMedia(ctx, *id)
	if err != nil {
		return nil, httpx.NotFoundIfNoRows(err, "media")
	}
	if m.OwnerID == nil || *m.OwnerID != v.ID || m.Kind != kind {
		return nil, httpx.Forbidden("that image is not yours or is the wrong kind")
	}
	return &m.ID, nil
}

func (h *Users) SetAvatar(ctx context.Context, req api.SetAvatarRequestObject) (api.SetAvatarResponseObject, error) {
	v, err := httpx.RequireActive(ctx)
	if err != nil {
		return nil, err
	}
	id, err := h.ownMedia(ctx, v, req.Body.MediaId, "avatar")
	if err != nil {
		return nil, err
	}
	return api.SetAvatar204Response{}, h.A.Q.UpdateAvatar(ctx, dbgen.UpdateAvatarParams{ID: v.ID, AvatarMedia: id})
}

func (h *Users) SetBanner(ctx context.Context, req api.SetBannerRequestObject) (api.SetBannerResponseObject, error) {
	v, err := httpx.RequireActive(ctx)
	if err != nil {
		return nil, err
	}
	id, err := h.ownMedia(ctx, v, req.Body.MediaId, "banner")
	if err != nil {
		return nil, err
	}
	return api.SetBanner204Response{}, h.A.Q.UpdateBanner(ctx, dbgen.UpdateBannerParams{ID: v.ID, BannerMedia: id})
}

type ghRepo struct {
	FullName    string `json:"full_name"`
	Description string `json:"description"`
	Language    string `json:"language"`
	Stars       int    `json:"stargazers_count"`
	URL         string `json:"html_url"`
	Fork        bool   `json:"fork"`
	Archived    bool   `json:"archived"`
}

func (h *Users) RefreshRepos(ctx context.Context, _ api.RefreshReposRequestObject) (api.RefreshReposResponseObject, error) {
	v, err := httpx.RequireActive(ctx)
	if err != nil {
		return nil, err
	}
	ident, err := h.A.Q.GetIdentity(ctx, dbgen.GetIdentityParams{UserID: v.ID, Provider: "github"})
	if err != nil {
		if httpx.IsNoRows(err) {
			return nil, httpx.Conflict("link your GitHub account first")
		}
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_, body, err := h.A.Fetch.Get(ctx,
		"https://api.github.com/users/"+url.PathEscape(ident.Handle)+"/repos?per_page=100&sort=pushed",
		"application/vnd.github+json")
	if err != nil {
		return nil, httpx.Coded(502, api.ErrorCodeInternal, "GitHub did not answer")
	}
	var repos []ghRepo
	if err := json.Unmarshal(body, &repos); err != nil {
		return nil, httpx.Coded(502, api.ErrorCodeInternal, "GitHub sent something unexpected")
	}
	repos = slicesFilter(repos, func(r ghRepo) bool { return !r.Fork && !r.Archived })
	sort.SliceStable(repos, func(i, j int) bool { return repos[i].Stars > repos[j].Stars })
	if len(repos) > 6 {
		repos = repos[:6]
	}
	out := make([]api.Repo, 0, len(repos))
	err = h.A.Tx(ctx, func(q *dbgen.Queries) error {
		if err := q.ReplaceUserRepos(ctx, v.ID); err != nil {
			return err
		}
		for i, r := range repos {
			desc := r.Description
			if utf8.RuneCountInString(desc) > 300 {
				desc = string([]rune(desc)[:299]) + "…"
			}
			if err := q.AddUserRepo(ctx, dbgen.AddUserRepoParams{UserID: v.ID, FullName: r.FullName,
				Description: desc, Language: r.Language, Stars: int32(r.Stars), Url: r.URL, Sort: int16(i)}); err != nil {
				return err
			}
			out = append(out, api.Repo{FullName: r.FullName, Url: r.URL, Description: nonEmpty(desc),
				Language: nonEmpty(r.Language), Stars: present.Ptr(r.Stars)})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return api.RefreshRepos200JSONResponse{Items: out}, nil
}

func slicesFilter[T any](in []T, keep func(T) bool) []T {
	out := in[:0]
	for _, v := range in {
		if keep(v) {
			out = append(out, v)
		}
	}
	return out
}

func (h *Users) GetHeatmap(ctx context.Context, req api.GetHeatmapRequestObject) (api.GetHeatmapResponseObject, error) {
	u, err := h.A.Q.GetUserByUsername(ctx, strings.TrimPrefix(req.Username, "@"))
	if err != nil {
		return nil, httpx.NotFoundIfNoRows(err, "user")
	}
	rows, err := h.A.Q.ActivityHeatmap(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	out := make([]api.HeatmapDay, 0, len(rows))
	for _, r := range rows {
		out = append(out, api.HeatmapDay{Day: dateOf(r.Day), Count: int(r.Count)})
	}
	return api.GetHeatmap200JSONResponse{Items: out}, nil
}

func (h *Users) ListOpenToWork(ctx context.Context, req api.ListOpenToWorkRequestObject) (api.ListOpenToWorkResponseObject, error) {
	limit := int32(30)
	if req.Params.Limit != nil {
		limit = int32(min(100, max(1, *req.Params.Limit)))
	}
	rows, err := h.A.Q.ListOpenToWork(ctx, limit)
	if err != nil {
		return nil, err
	}
	items, err := present.New(h.A.Q, httpx.Viewer(ctx)).UserList(ctx, rows)
	return api.ListOpenToWork200JSONResponse{UserPageJSONResponse: api.UserPageJSONResponse{Items: items}}, err
}

func (h *Users) DeleteMe(ctx context.Context, _ api.DeleteMeRequestObject) (api.DeleteMeResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	err = h.A.Tx(ctx, func(q *dbgen.Queries) error {
		if err := q.DeletePersonalData(ctx, v.ID); err != nil {
			return err
		}
		return q.AnonymizeUser(ctx, v.ID)
	})
	if err != nil {
		return nil, err
	}
	return api.DeleteMe204Response{}, nil
}

func (h *Users) ExportMe(ctx context.Context, _ api.ExportMeRequestObject) (api.ExportMeResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	links, err := h.A.Q.ExportLinks(ctx, v.ID)
	if err != nil {
		return nil, err
	}
	notes, err := h.A.Q.ExportNotes(ctx, v.ID)
	if err != nil {
		return nil, err
	}
	articles, err := h.A.Q.ExportArticles(ctx, v.ID)
	if err != nil {
		return nil, err
	}
	comments, err := h.A.Q.ExportComments(ctx, v.ID)
	if err != nil {
		return nil, err
	}
	profile, err := h.GetProfile(ctx, api.GetProfileRequestObject{Username: v.Username})
	if err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	put := func(name string, v any) error {
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		if s, ok := v.(string); ok {
			_, err = w.Write([]byte(s))
			return err
		}
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		return enc.Encode(v)
	}
	files := map[string]any{
		"profile.json": profile, "links.json": links, "notes.json": notes,
		"articles.json": articles, "comments.json": comments,
		"README.md": "# buildwith.uz export\n\nEverything you wrote on buildwith.uz as JSON, plus each article as Markdown in articles/.\n",
	}
	names := make([]string, 0, len(files))
	for n := range files {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		if err := put(n, files[n]); err != nil {
			return nil, err
		}
	}
	for _, a := range articles {
		md := fmt.Sprintf("---\ntitle: %q\nstatus: %s\n---\n\n%s\n", a.Title, a.Status, a.BodyMd)
		if err := put("articles/"+a.Slug+".md", md); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return exportResponse{data: buf.Bytes(), username: v.Username}, nil
}
