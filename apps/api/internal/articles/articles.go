// Package articles owns long-form writing: drafts, autosave, versions,
// scheduling, series and the reading page.
package articles

import (
	"context"
	"encoding/json"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/buildwithuz/buildwith/apps/api/internal/api"
	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/auth"
	"github.com/buildwithuz/buildwith/apps/api/internal/cursor"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/httpx"
	"github.com/buildwithuz/buildwith/apps/api/internal/links"
	"github.com/buildwithuz/buildwith/apps/api/internal/markdown"
	"github.com/buildwithuz/buildwith/apps/api/internal/present"
	"github.com/buildwithuz/buildwith/apps/api/internal/rank"
	"github.com/buildwithuz/buildwith/apps/api/internal/ratelimit"
	"github.com/buildwithuz/buildwith/apps/api/internal/slug"
	"github.com/buildwithuz/buildwith/apps/api/internal/social"
	"github.com/buildwithuz/buildwith/apps/api/internal/translit"
)

type Articles struct{ A *app.App }

const keepVersions = 20

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,119}$`)

func (h *Articles) present(ctx context.Context, a dbgen.Article, u dbgen.User, withBody bool) (api.Article, error) {
	out, err := present.New(h.A.Q, httpx.Viewer(ctx)).Articles(ctx, []present.ArticleRow{{Article: a, User: u}}, withBody)
	if err != nil {
		return api.Article{}, err
	}
	return out[0], nil
}

// own loads an article the viewer wrote.
func (h *Articles) own(ctx context.Context, id int64) (*dbgen.User, dbgen.GetArticleRow, error) {
	v, err := httpx.RequireActive(ctx)
	if err != nil {
		return nil, dbgen.GetArticleRow{}, err
	}
	row, err := h.A.Q.GetArticle(ctx, id)
	if err != nil {
		return nil, row, httpx.NotFoundIfNoRows(err, "article")
	}
	if row.Article.AuthorID != v.ID {
		return nil, row, httpx.Forbidden("not your article")
	}
	return v, row, nil
}

func (h *Articles) CreateArticle(ctx context.Context, req api.CreateArticleRequestObject) (api.CreateArticleResponseObject, error) {
	v, err := httpx.RequireActive(ctx)
	if err != nil {
		return nil, err
	}
	if err := links.Limit(ctx, h.A, v, ratelimit.Articles, ratelimit.ArticlesNew); err != nil {
		return nil, err
	}
	title := "Untitled"
	if req.Body != nil && req.Body.Title != nil && utf8.RuneCountInString(strings.TrimSpace(*req.Body.Title)) >= 3 {
		title = strings.TrimSpace(translit.Normalize(*req.Body.Title))
	}
	s := slug.Make(title, 80)
	if s == "" {
		s = "draft"
	}
	a, err := h.A.Q.CreateArticle(ctx, dbgen.CreateArticleParams{AuthorID: v.ID, Title: title,
		Slug: s + "-" + strings.ToLower(strings.NewReplacer("_", "0", "-", "1").Replace(auth.Token(4)))})
	if err != nil {
		return nil, err
	}
	out, err := h.present(ctx, a, *v, true)
	return api.CreateArticle201JSONResponse(out), err
}

func (h *Articles) SaveArticle(ctx context.Context, req api.SaveArticleRequestObject) (api.SaveArticleResponseObject, error) {
	v, row, err := h.own(ctx, req.Id)
	if err != nil {
		return nil, err
	}
	a := row.Article
	b := req.Body
	title := strings.Join(strings.Fields(translit.Normalize(b.Title)), " ")
	if n := utf8.RuneCountInString(title); n < 3 || n > 140 {
		return nil, httpx.Invalid("title", "3-140 characters")
	}
	body := translit.Normalize(b.BodyMd)
	if utf8.RuneCountInString(body) > 200000 {
		return nil, httpx.Invalid("body_md", "the article is too long")
	}
	arg := dbgen.SaveArticleDraftParams{
		ID: a.ID, Title: title, BodyMd: body, Lang: a.Lang, Slug: a.Slug,
		SeriesSort: a.SeriesSort, CoverMedia: a.CoverMedia, SeriesID: a.SeriesID, CanonicalUrl: a.CanonicalUrl,
	}
	if b.Subtitle != nil {
		arg.Subtitle = strings.TrimSpace(translit.Normalize(*b.Subtitle))
		if utf8.RuneCountInString(arg.Subtitle) > 200 {
			return nil, httpx.Invalid("subtitle", "at most 200 characters")
		}
	}
	if b.Lang != nil {
		arg.Lang = string(*b.Lang)
	}
	if b.CanonicalUrl != nil {
		cu := strings.TrimSpace(*b.CanonicalUrl)
		if cu == "" {
			arg.CanonicalUrl = nil
		} else if u, err := url.Parse(cu); err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
			return nil, httpx.Invalid("canonical_url", "must be an http(s) URL")
		} else {
			arg.CanonicalUrl = &cu
		}
	}
	if b.CoverMediaId != nil {
		m, err := h.A.Q.GetMedia(ctx, *b.CoverMediaId)
		if err != nil {
			return nil, httpx.NotFoundIfNoRows(err, "media")
		}
		if m.OwnerID == nil || *m.OwnerID != v.ID || m.Kind != "cover" {
			return nil, httpx.Forbidden("that image is not yours or is not a cover")
		}
		arg.CoverMedia = &m.ID
	}
	if b.SeriesId != nil {
		s, err := h.A.Q.GetSeries(ctx, *b.SeriesId)
		if err != nil || s.AuthorID != v.ID {
			return nil, httpx.Invalid("series_id", "not one of your series")
		}
		arg.SeriesID = &s.ID
	}
	if b.SeriesSort != nil {
		arg.SeriesSort = int16(min(999, max(0, *b.SeriesSort)))
	}
	if b.Slug != nil && *b.Slug != a.Slug {
		s := strings.ToLower(strings.TrimSpace(*b.Slug))
		if !slugRe.MatchString(s) {
			return nil, httpx.Invalid("slug", "lowercase letters, digits and dashes")
		}
		taken, err := h.A.Q.SlugTakenByAuthor(ctx, dbgen.SlugTakenByAuthorParams{AuthorID: v.ID, Slug: s, ExceptID: a.ID})
		if err != nil {
			return nil, err
		}
		if taken {
			return nil, httpx.Coded(409, api.ErrorCodeSlugTaken, "you already have an article at that address")
		}
		arg.Slug = s
	}

	r := markdown.Render(body, markdown.Options{Profile: markdown.Article, NoFollow: int(v.Karma) < rank.KarmaForFollowLinks})
	arg.BodyHtml = r.HTML
	arg.ReadingMinutes = int16(min(r.ReadingMinutes(), 999))
	if arg.Toc, err = json.Marshal(orEmpty(r.TOC)); err != nil {
		return nil, err
	}

	var saved dbgen.Article
	err = h.A.Tx(ctx, func(q *dbgen.Queries) error {
		var err error
		if saved, err = q.SaveArticleDraft(ctx, arg); err != nil {
			return err
		}
		if b.Tags != nil {
			ids, err := social.UpsertTags(ctx, q, *b.Tags, 5)
			if err != nil {
				return err
			}
			if err := q.ClearArticleTags(ctx, a.ID); err != nil {
				return err
			}
			for _, id := range ids {
				if err := q.AddArticleTag(ctx, dbgen.AddArticleTagParams{ArticleID: a.ID, TagID: id}); err != nil {
					return err
				}
			}
		}
		if body != a.BodyMd || title != a.Title {
			if err := q.SaveArticleVersion(ctx, dbgen.SaveArticleVersionParams{ArticleID: a.ID, Title: title, BodyMd: body}); err != nil {
				return err
			}
			if _, err := q.TrimArticleVersions(ctx, dbgen.TrimArticleVersionsParams{ArticleID: a.ID, Keep: keepVersions}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	out, err := h.present(ctx, saved, row.User, true)
	return api.SaveArticle200JSONResponse(out), err
}

func orEmpty[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

func (h *Articles) PublishArticle(ctx context.Context, req api.PublishArticleRequestObject) (api.PublishArticleResponseObject, error) {
	v, row, err := h.own(ctx, req.Id)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(row.Article.BodyMd) == "" || row.Article.Title == "Untitled" {
		return nil, httpx.Invalid("body_md", "give the article a title and some words first")
	}
	var a dbgen.Article
	if req.Body != nil && req.Body.At != nil && req.Body.At.After(h.A.Clock.Now().Add(time.Minute)) {
		if req.Body.At.After(h.A.Clock.Now().Add(90 * 24 * time.Hour)) {
			return nil, httpx.Invalid("at", "schedule at most 90 days ahead")
		}
		a, err = h.A.Q.ScheduleArticle(ctx, dbgen.ScheduleArticleParams{ID: req.Id, ScheduledAt: req.Body.At})
	} else {
		a, err = h.A.Q.PublishArticle(ctx, req.Id)
		if err == nil {
			_ = h.A.Q.GrantBadge(ctx, dbgen.GrantBadgeParams{UserID: v.ID, Kind: "author"})
		}
	}
	if err != nil {
		return nil, err
	}
	out, err := h.present(ctx, a, row.User, true)
	return api.PublishArticle200JSONResponse(out), err
}

func (h *Articles) UnpublishArticle(ctx context.Context, req api.UnpublishArticleRequestObject) (api.UnpublishArticleResponseObject, error) {
	_, row, err := h.own(ctx, req.Id)
	if err != nil {
		return nil, err
	}
	a, err := h.A.Q.UnpublishArticle(ctx, req.Id)
	if err != nil {
		return nil, err
	}
	out, err := h.present(ctx, a, row.User, true)
	return api.UnpublishArticle200JSONResponse(out), err
}

func (h *Articles) DeleteArticle(ctx context.Context, req api.DeleteArticleRequestObject) (api.DeleteArticleResponseObject, error) {
	if _, _, err := h.own(ctx, req.Id); err != nil {
		return nil, err
	}
	_, err := h.A.Q.SoftDeleteArticle(ctx, req.Id)
	return api.DeleteArticle204Response{}, err
}

func (h *Articles) readable(ctx context.Context, a dbgen.Article) error {
	v := httpx.Viewer(ctx)
	if v != nil && v.ID == a.AuthorID {
		return nil
	}
	if a.Status != "published" {
		return httpx.NotFound("article")
	}
	return links.Visible(ctx, h.A.Q, "article", a.ID, a.AuthorID)
}

func (h *Articles) GetArticle(ctx context.Context, req api.GetArticleRequestObject) (api.GetArticleResponseObject, error) {
	row, err := h.A.Q.GetArticle(ctx, req.Id)
	if err != nil {
		return nil, httpx.NotFoundIfNoRows(err, "article")
	}
	if err := h.readable(ctx, row.Article); err != nil {
		return nil, err
	}
	out, err := h.present(ctx, row.Article, row.User, true)
	return api.GetArticle200JSONResponse(out), err
}

func (h *Articles) GetArticleBySlug(ctx context.Context, req api.GetArticleBySlugRequestObject) (api.GetArticleBySlugResponseObject, error) {
	row, err := h.A.Q.GetArticleBySlug(ctx, dbgen.GetArticleBySlugParams{
		Username: strings.TrimPrefix(req.Params.Author, "@"), Slug: req.Params.Slug,
	})
	if err != nil {
		return nil, httpx.NotFoundIfNoRows(err, "article")
	}
	if err := h.readable(ctx, row.Article); err != nil {
		return nil, err
	}
	out, err := h.present(ctx, row.Article, row.User, true)
	if err != nil {
		return nil, err
	}
	v := httpx.Viewer(ctx)
	if row.Article.KilledAt != nil && (v == nil || (!v.IsModerator && v.ID != row.Article.AuthorID)) {
		out.BodyHtml = present.Ptr("")
	}
	return api.GetArticleBySlug200JSONResponse(out), nil
}

func (h *Articles) ListMyArticles(ctx context.Context, req api.ListMyArticlesRequestObject) (api.ListMyArticlesResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	arg := dbgen.ListArticlesByAuthorAllParams{AuthorID: v.ID, PageLimit: cursor.Limit(req.Params.Limit, 50)}
	if req.Params.Status != nil {
		arg.Status = present.Ptr(string(*req.Params.Status))
	}
	rows, err := h.A.Q.ListArticlesByAuthorAll(ctx, arg)
	if err != nil {
		return nil, err
	}
	ar := make([]present.ArticleRow, len(rows))
	for i, r := range rows {
		ar[i] = present.ArticleRow{Article: r.Article, User: r.User}
	}
	items, err := present.New(h.A.Q, v).Articles(ctx, ar, false)
	return api.ListMyArticles200JSONResponse{Items: items}, err
}

func (h *Articles) ListArticles(ctx context.Context, req api.ListArticlesRequestObject) (api.ListArticlesResponseObject, error) {
	p := req.Params
	pos, err := cursor.Decode(p.Cursor)
	if err != nil {
		return nil, httpx.Invalid("cursor", err.Error())
	}
	limit := cursor.Limit(p.Limit, 20)
	empty := api.ListArticles200JSONResponse{Items: []api.Article{}}
	viewer := httpx.ViewerID(ctx)

	var tagID, authorID *int64
	if p.Tag != nil && *p.Tag != "" {
		t, err := h.A.Q.GetTagBySlug(ctx, social.NormalizeTag(*p.Tag))
		if httpx.IsNoRows(err) {
			return empty, nil
		} else if err != nil {
			return nil, err
		}
		tagID = &t.ID
	}
	if p.Author != nil && *p.Author != "" {
		u, err := h.A.Q.GetUserByUsername(ctx, strings.TrimPrefix(*p.Author, "@"))
		if httpx.IsNoRows(err) {
			return empty, nil
		} else if err != nil {
			return nil, err
		}
		authorID = &u.ID
	}

	var rows []present.ArticleRow
	var next *string
	if p.Sort != nil && *p.Sort == api.ArticleSortPopular {
		since := h.A.Clock.Now().Add(-7 * 24 * time.Hour)
		arg := dbgen.ListArticlesByScoreParams{TagID: tagID, Since: &since, ViewerID: viewer, PageLimit: limit}
		if pos != nil {
			arg.CursorScore, arg.CursorID = pos.F, &pos.ID
		}
		res, err := h.A.Q.ListArticlesByScore(ctx, arg)
		if err != nil {
			return nil, err
		}
		for _, r := range res {
			rows = append(rows, present.ArticleRow{Article: r.Article, User: r.User})
		}
		next = cursor.Next(res, limit, func(r dbgen.ListArticlesByScoreRow) *string { return cursor.ByFloat(r.Article.Score, r.Article.ID) })
	} else {
		arg := dbgen.ListArticlesByPublishedParams{AuthorID: authorID, SeriesID: p.SeriesId, TagID: tagID,
			ViewerID: viewer, PageLimit: limit}
		if p.Sort != nil && *p.Sort == api.ArticleSortFeatured {
			arg.Featured = present.Ptr(true)
		}
		if pos != nil {
			arg.CursorPublished, arg.CursorID = pos.T, &pos.ID
		}
		res, err := h.A.Q.ListArticlesByPublished(ctx, arg)
		if err != nil {
			return nil, err
		}
		for _, r := range res {
			rows = append(rows, present.ArticleRow{Article: r.Article, User: r.User})
		}
		next = cursor.Next(res, limit, func(r dbgen.ListArticlesByPublishedRow) *string {
			return cursor.ByTime(*r.Article.PublishedAt, r.Article.ID)
		})
	}
	items, err := present.New(h.A.Q, httpx.Viewer(ctx)).Articles(ctx, rows, false)
	if err != nil {
		return nil, err
	}
	return api.ListArticles200JSONResponse{Items: items, NextCursor: next}, nil
}

func (h *Articles) ListArticleVersions(ctx context.Context, req api.ListArticleVersionsRequestObject) (api.ListArticleVersionsResponseObject, error) {
	if _, _, err := h.own(ctx, req.Id); err != nil {
		return nil, err
	}
	rows, err := h.A.Q.ListArticleVersions(ctx, req.Id)
	if err != nil {
		return nil, err
	}
	out := api.ListArticleVersions200JSONResponse{Items: make([]api.ArticleVersion, 0, len(rows))}
	for _, r := range rows {
		out.Items = append(out.Items, api.ArticleVersion{N: int(r.N), Title: r.Title, CreatedAt: r.CreatedAt})
	}
	return out, nil
}

func (h *Articles) GetArticleVersion(ctx context.Context, req api.GetArticleVersionRequestObject) (api.GetArticleVersionResponseObject, error) {
	if _, _, err := h.own(ctx, req.Id); err != nil {
		return nil, err
	}
	r, err := h.A.Q.GetArticleVersion(ctx, dbgen.GetArticleVersionParams{ArticleID: req.Id, N: int32(req.N)})
	if err != nil {
		return nil, httpx.NotFoundIfNoRows(err, "version")
	}
	return api.GetArticleVersion200JSONResponse{N: int(r.N), Title: r.Title, BodyMd: r.BodyMd, CreatedAt: r.CreatedAt}, nil
}

func (h *Articles) ListSeries(ctx context.Context, req api.ListSeriesRequestObject) (api.ListSeriesResponseObject, error) {
	u, err := h.A.Q.GetUserByUsername(ctx, strings.TrimPrefix(req.Params.Author, "@"))
	if err != nil {
		return nil, httpx.NotFoundIfNoRows(err, "user")
	}
	rows, err := h.A.Q.ListSeriesByAuthor(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	out := api.ListSeries200JSONResponse{Items: make([]api.Series, 0, len(rows))}
	for _, s := range rows {
		out.Items = append(out.Items, present.SeriesOf(s))
	}
	return out, nil
}

func (h *Articles) CreateSeries(ctx context.Context, req api.CreateSeriesRequestObject) (api.CreateSeriesResponseObject, error) {
	v, err := httpx.RequireActive(ctx)
	if err != nil {
		return nil, err
	}
	title := strings.TrimSpace(translit.Normalize(req.Body.Title))
	if n := utf8.RuneCountInString(title); n < 3 || n > 120 {
		return nil, httpx.Invalid("title", "3-120 characters")
	}
	desc := ""
	if req.Body.Description != nil {
		desc = strings.TrimSpace(*req.Body.Description)
	}
	s := slug.Make(title, 80)
	if s == "" {
		s = "series"
	}
	row, err := h.A.Q.CreateSeries(ctx, dbgen.CreateSeriesParams{AuthorID: v.ID, Slug: s, Title: title, Description: desc})
	if err != nil {
		return nil, err
	}
	return api.CreateSeries201JSONResponse(present.SeriesOf(row)), nil
}
