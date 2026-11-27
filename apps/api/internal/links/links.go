// Package links owns the Hacker News-style surface: link, text, Savol (ask) and
// Koʻrsat (show) posts, and the ranked lists built from them.
package links

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/buildwithuz/buildwith/apps/api/internal/api"
	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/cursor"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/httpx"
	"github.com/buildwithuz/buildwith/apps/api/internal/markdown"
	"github.com/buildwithuz/buildwith/apps/api/internal/notify"
	"github.com/buildwithuz/buildwith/apps/api/internal/present"
	"github.com/buildwithuz/buildwith/apps/api/internal/rank"
	"github.com/buildwithuz/buildwith/apps/api/internal/ratelimit"
	"github.com/buildwithuz/buildwith/apps/api/internal/slug"
	"github.com/buildwithuz/buildwith/apps/api/internal/social"
	"github.com/buildwithuz/buildwith/apps/api/internal/translit"
	"github.com/buildwithuz/buildwith/apps/api/internal/urlx"
)

type Links struct{ A *app.App }

const (
	DedupeDays = 30
	EditWindow = 2 * time.Hour
)

// Limit enforces a per-day rule, tighter for new accounts.
func Limit(ctx context.Context, a *app.App, u *dbgen.User, normal, newAccount ratelimit.Rule) error {
	rule := ratelimit.For(u.CreatedAt, a.Clock.Now(), normal, newAccount)
	ok, retry, err := a.Limiter.Allow(ctx, rule, itoa(u.ID))
	if err != nil {
		return err
	}
	if !ok {
		if rule == newAccount {
			e := httpx.Coded(http.StatusTooManyRequests, api.ErrorCodeNewAccountLimit, "new accounts have a lower daily limit")
			e.RetryAfter = retry
			return e
		}
		return httpx.RateLimited(retry)
	}
	return nil
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

func (h *Links) CreateLink(ctx context.Context, req api.CreateLinkRequestObject) (api.CreateLinkResponseObject, error) {
	v, err := httpx.RequireActive(ctx)
	if err != nil {
		return nil, err
	}
	b := req.Body
	title := strings.Join(strings.Fields(translit.Normalize(b.Title)), " ")
	if n := utf8.RuneCountInString(title); n < 3 || n > 100 {
		return nil, httpx.Invalid("title", "3-100 characters")
	}
	body := ""
	if b.BodyMd != nil {
		body = strings.TrimSpace(translit.Normalize(*b.BodyMd))
	}
	if utf8.RuneCountInString(body) > 20000 {
		return nil, httpx.Invalid("body_md", "at most 20000 characters")
	}
	var tags []string
	if b.Tags != nil {
		tags = *b.Tags
	}

	arg := dbgen.CreateLinkParams{AuthorID: v.ID, Kind: string(b.Kind), Title: title, Slug: slug.Make(title, 60)}
	rawURL := ""
	if b.Url != nil {
		rawURL = strings.TrimSpace(*b.Url)
	}
	switch b.Kind {
	case api.LinkKindLink:
		if rawURL == "" {
			return nil, httpx.Invalid("url", "a link post needs a URL")
		}
	case api.LinkKindText, api.LinkKindAsk:
		if rawURL != "" {
			return nil, httpx.Invalid("url", "this kind of post has no URL; choose Link or Koʻrsat")
		}
	case api.LinkKindShow:
		if rawURL == "" && body == "" {
			return nil, httpx.Invalid("body_md", "show us something: a URL or a description")
		}
	default:
		return nil, httpx.Invalid("kind", "unknown kind")
	}

	if rawURL != "" {
		c, err := urlx.Canonicalize(rawURL)
		if err != nil {
			return nil, httpx.Invalid("url", err.Error())
		}
		if rule, err := h.A.Q.GetDomainRule(ctx, c.Domain); err == nil && rule.Banned {
			return nil, httpx.Invalid("url", "links to this site are not accepted")
		}
		if dup, err := h.A.Q.FindRecentDuplicate(ctx, dbgen.FindRecentDuplicateParams{UrlHash: c.Hash, WithinDays: DedupeDays}); err == nil {
			existing, err := h.present(ctx, dup.ID)
			if err != nil {
				return nil, err
			}
			return api.CreateLink409JSONResponse{
				Error:    api.Error{Code: api.ErrorCodeDuplicateUrl, Message: "this link was shared recently"},
				Existing: existing,
			}, nil
		} else if !httpx.IsNoRows(err) {
			return nil, err
		}
		u := urlx.KeepScheme(c, rawURL)
		arg.Url, arg.UrlCanonical, arg.UrlHash, arg.Domain = &u, &c.Key, c.Hash, c.Domain
	}
	if err := Limit(ctx, h.A, v, ratelimit.Links, ratelimit.LinksNew); err != nil {
		return nil, err
	}

	if body != "" {
		arg.BodyMd = body
		arg.BodyHtml = markdown.Render(body, markdown.Options{
			Profile: markdown.Comment, NoFollow: int(v.Karma) < rank.KarmaForFollowLinks,
		}).HTML
	}

	var l dbgen.Link
	err = h.A.Tx(ctx, func(q *dbgen.Queries) error {
		ids, err := social.UpsertTags(ctx, q, tags, 3)
		if err != nil {
			return err
		}
		if l, err = q.CreateLink(ctx, arg); err != nil {
			return err
		}
		for _, id := range ids {
			if err := q.AddLinkTag(ctx, dbgen.AddLinkTagParams{LinkID: l.ID, TagID: id}); err != nil {
				return err
			}
		}
		// New account + a domain nobody else has posted: a moderator looks first.
		isNew := h.A.Clock.Now().Sub(v.CreatedAt) < ratelimit.NewAccountAge
		if isNew && l.Domain != "" {
			seen, err := q.DomainSeenBefore(ctx, dbgen.DomainSeenBeforeParams{Domain: l.Domain, AuthorID: v.ID})
			if err != nil {
				return err
			}
			if !seen {
				return q.HoldForReview(ctx, dbgen.HoldForReviewParams{SubjectType: "link", SubjectID: l.ID,
					Reason: "new account, unseen domain " + l.Domain})
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	notify.SendMentions(ctx, h.A.Q, body, v.ID, "link", l.ID)
	out, err := h.present(ctx, l.ID)
	return api.CreateLink201JSONResponse(out), err
}

func (h *Links) present(ctx context.Context, id int64) (api.Link, error) {
	row, err := h.A.Q.GetLink(ctx, id)
	if err != nil {
		return api.Link{}, httpx.NotFoundIfNoRows(err, "link")
	}
	out, err := present.New(h.A.Q, httpx.Viewer(ctx)).Links(ctx, []present.LinkRow{{Link: row.Link, User: row.User}})
	if err != nil {
		return api.Link{}, err
	}
	return out[0], nil
}

func (h *Links) GetLink(ctx context.Context, req api.GetLinkRequestObject) (api.GetLinkResponseObject, error) {
	row, err := h.A.Q.GetLink(ctx, req.Id)
	if err != nil {
		return nil, httpx.NotFoundIfNoRows(err, "link")
	}
	if err := h.visible(ctx, "link", row.Link.ID, row.Link.AuthorID); err != nil {
		return nil, err
	}
	out, err := present.New(h.A.Q, httpx.Viewer(ctx)).Links(ctx, []present.LinkRow{{Link: row.Link, User: row.User}})
	if err != nil {
		return nil, err
	}
	l := out[0]
	if row.Link.KilledAt != nil && !isMod(ctx) && !isSelf(ctx, row.Link.AuthorID) {
		l.BodyHtml, l.BodyMd, l.Url = present.Ptr(""), nil, nil
	}
	return api.GetLink200JSONResponse(l), nil
}

// visible hides an item held for review from everyone but its author and the
// moderators, and anything from someone in a block with the viewer.
func (h *Links) visible(ctx context.Context, kind string, id, author int64) error {
	return Visible(ctx, h.A.Q, kind, id, author)
}

func Visible(ctx context.Context, q *dbgen.Queries, kind string, id, author int64) error {
	if isMod(ctx) || isSelf(ctx, author) {
		return nil
	}
	held, err := q.IsHeld(ctx, dbgen.IsHeldParams{SubjectType: kind, SubjectID: id})
	if err != nil {
		return err
	}
	if held {
		return httpx.NotFound(kind)
	}
	if v := httpx.Viewer(ctx); v != nil {
		blocked, err := q.IsBlocked(ctx, dbgen.IsBlockedParams{A: v.ID, B: author})
		if err != nil {
			return err
		}
		if blocked {
			return httpx.NotFound(kind)
		}
	}
	return nil
}

func isMod(ctx context.Context) bool {
	v := httpx.Viewer(ctx)
	return v != nil && (v.IsModerator || v.IsAdmin)
}

func isSelf(ctx context.Context, id int64) bool {
	v := httpx.Viewer(ctx)
	return v != nil && v.ID == id
}

func (h *Links) UpdateLink(ctx context.Context, req api.UpdateLinkRequestObject) (api.UpdateLinkResponseObject, error) {
	v, err := httpx.RequireActive(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.A.Q.GetLink(ctx, req.Id)
	if err != nil {
		return nil, httpx.NotFoundIfNoRows(err, "link")
	}
	l := row.Link
	mod := v.IsModerator || v.IsAdmin
	if l.AuthorID != v.ID && !mod {
		return nil, httpx.Forbidden("not your post")
	}
	if !mod && h.A.Clock.Now().Sub(l.CreatedAt) > EditWindow {
		return nil, httpx.Coded(http.StatusForbidden, api.ErrorCodeEditWindowClosed, "the edit window has closed")
	}
	if req.Body.Title != nil {
		title := strings.Join(strings.Fields(translit.Normalize(*req.Body.Title)), " ")
		if n := utf8.RuneCountInString(title); n < 3 || n > 100 {
			return nil, httpx.Invalid("title", "3-100 characters")
		}
		if err := h.A.Q.UpdateLinkTitle(ctx, dbgen.UpdateLinkTitleParams{ID: l.ID, Title: title, Slug: slug.Make(title, 60)}); err != nil {
			return nil, err
		}
		if mod && l.AuthorID != v.ID && title != l.Title {
			_, _ = h.A.Q.LogModAction(ctx, dbgen.LogModActionParams{ActorID: v.ID, Action: "rename",
				SubjectType: "link", SubjectID: &l.ID, SubjectText: l.Title, Reason: "title: " + title})
		}
	}
	if req.Body.BodyMd != nil {
		body := strings.TrimSpace(translit.Normalize(*req.Body.BodyMd))
		if utf8.RuneCountInString(body) > 20000 {
			return nil, httpx.Invalid("body_md", "at most 20000 characters")
		}
		html := markdown.Render(body, markdown.Options{Profile: markdown.Comment,
			NoFollow: int(row.User.Karma) < rank.KarmaForFollowLinks}).HTML
		if _, err := h.A.Q.UpdateLinkBody(ctx, dbgen.UpdateLinkBodyParams{ID: l.ID, BodyMd: body, BodyHtml: html}); err != nil {
			return nil, err
		}
	}
	out, err := h.present(ctx, l.ID)
	return api.UpdateLink200JSONResponse(out), err
}

func (h *Links) DeleteLink(ctx context.Context, req api.DeleteLinkRequestObject) (api.DeleteLinkResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.A.Q.GetLink(ctx, req.Id)
	if err != nil {
		return nil, httpx.NotFoundIfNoRows(err, "link")
	}
	if row.Link.AuthorID != v.ID {
		return nil, httpx.Forbidden("not your post")
	}
	_, err = h.A.Q.SoftDeleteLink(ctx, row.Link.ID)
	return api.DeleteLink204Response{}, err
}

func (h *Links) ListLinks(ctx context.Context, req api.ListLinksRequestObject) (api.ListLinksResponseObject, error) {
	p := req.Params
	pos, err := cursor.Decode(p.Cursor)
	if err != nil {
		return nil, httpx.Invalid("cursor", err.Error())
	}
	limit := cursor.Limit(p.Limit, 30)
	empty := api.ListLinks200JSONResponse{Items: []api.Link{}}

	var kind, domain *string
	var authorID, tagID *int64
	if p.Kind != nil {
		kind = present.Ptr(string(*p.Kind))
	}
	if p.Domain != nil && *p.Domain != "" {
		domain = present.Ptr(strings.ToLower(*p.Domain))
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
	if p.Tag != nil && *p.Tag != "" {
		t, err := h.A.Q.GetTagBySlug(ctx, social.NormalizeTag(*p.Tag))
		if httpx.IsNoRows(err) {
			return empty, nil
		} else if err != nil {
			return nil, err
		}
		tagID = &t.ID
	}
	viewer := httpx.ViewerID(ctx)
	sort := api.LinkSortTop
	if p.Sort != nil {
		sort = *p.Sort
	}

	var rows []present.LinkRow
	var next *string
	switch sort {
	case api.LinkSortNew:
		arg := dbgen.ListLinksByCreatedParams{Kind: kind, Domain: domain, AuthorID: authorID, TagID: tagID, ViewerID: viewer, PageLimit: limit}
		if pos != nil {
			arg.CursorCreated, arg.CursorID = pos.T, &pos.ID
		}
		res, err := h.A.Q.ListLinksByCreated(ctx, arg)
		if err != nil {
			return nil, err
		}
		for _, r := range res {
			rows = append(rows, present.LinkRow{Link: r.Link, User: r.User})
		}
		next = cursor.Next(res, limit, func(r dbgen.ListLinksByCreatedRow) *string { return cursor.ByTime(r.Link.CreatedAt, r.Link.ID) })
	case api.LinkSortBest:
		arg := dbgen.ListLinksByPointsParams{Kind: kind, Domain: domain, AuthorID: authorID, TagID: tagID, ViewerID: viewer, PageLimit: limit}
		if pos != nil && pos.N != nil {
			pts := int32(*pos.N)
			arg.CursorPoints, arg.CursorID = &pts, &pos.ID
		}
		res, err := h.A.Q.ListLinksByPoints(ctx, arg)
		if err != nil {
			return nil, err
		}
		for _, r := range res {
			rows = append(rows, present.LinkRow{Link: r.Link, User: r.User})
		}
		next = cursor.Next(res, limit, func(r dbgen.ListLinksByPointsRow) *string { return cursor.ByInt(int64(r.Link.Points), r.Link.ID) })
	default:
		arg := dbgen.ListLinksByScoreParams{Kind: kind, Domain: domain, AuthorID: authorID, TagID: tagID, ViewerID: viewer, PageLimit: limit}
		if pos != nil {
			arg.CursorScore, arg.CursorID = pos.F, &pos.ID
		}
		res, err := h.A.Q.ListLinksByScore(ctx, arg)
		if err != nil {
			return nil, err
		}
		for _, r := range res {
			rows = append(rows, present.LinkRow{Link: r.Link, User: r.User})
		}
		next = cursor.Next(res, limit, func(r dbgen.ListLinksByScoreRow) *string { return cursor.ByFloat(r.Link.Score, r.Link.ID) })
	}
	items, err := present.New(h.A.Q, httpx.Viewer(ctx)).Links(ctx, rows)
	if err != nil {
		return nil, err
	}
	return api.ListLinks200JSONResponse{Items: items, NextCursor: next}, nil
}

func (h *Links) PromoteNote(ctx context.Context, req api.PromoteNoteRequestObject) (api.PromoteNoteResponseObject, error) {
	v, err := httpx.RequireActive(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.A.Q.GetNote(ctx, req.Id)
	if err != nil {
		return nil, httpx.NotFoundIfNoRows(err, "note")
	}
	n := row.Note
	if n.AuthorID != v.ID {
		return nil, httpx.Forbidden("not your note")
	}
	if n.PromotedLinkID != nil {
		return nil, httpx.Conflict("this note is already a link post")
	}
	newLink := api.LinkNew{Title: req.Body.Title, Kind: api.LinkKindText, BodyMd: present.Ptr(n.BodyMd), Tags: req.Body.Tags}
	if n.PreviewUrl != nil {
		newLink.Kind, newLink.Url = api.LinkKindLink, n.PreviewUrl
	}
	res, err := h.CreateLink(ctx, api.CreateLinkRequestObject{Body: &newLink})
	if err != nil {
		return nil, err
	}
	created, ok := res.(api.CreateLink201JSONResponse)
	if !ok {
		return nil, httpx.Conflict("that link was shared recently")
	}
	if err := h.A.Q.PromoteNoteToLink(ctx, dbgen.PromoteNoteToLinkParams{ID: n.ID, PromotedLinkID: &created.Id}); err != nil {
		return nil, err
	}
	return api.PromoteNote201JSONResponse(created), nil
}
