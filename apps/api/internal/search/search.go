// Package search runs full-text search over everything. Queries are folded with
// translit.ForSearch so Latin, Cyrillic and every apostrophe spelling match.
package search

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/buildwithuz/buildwith/apps/api/internal/api"
	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/httpx"
	"github.com/buildwithuz/buildwith/apps/api/internal/present"
	"github.com/buildwithuz/buildwith/apps/api/internal/timeline"
	"github.com/buildwithuz/buildwith/apps/api/internal/translit"
)

type Finder struct{ A *app.App }

func (h *Finder) Search(ctx context.Context, req api.SearchRequestObject) (api.SearchResponseObject, error) {
	raw := strings.TrimSpace(req.Params.Q)
	if n := utf8.RuneCountInString(raw); n < 2 || n > 120 {
		return nil, httpx.Invalid("q", "2-120 characters")
	}
	// Stored text is Latin; a Cyrillic query is converted so it matches too.
	q := translit.ToLatin(translit.Normalize(raw))
	limit := int32(20)
	if req.Params.Limit != nil {
		limit = int32(min(50, max(1, *req.Params.Limit)))
	}
	offset := int32(0)
	if req.Params.Offset != nil {
		offset = int32(min(1000, max(0, *req.Params.Offset)))
	}
	v := httpx.Viewer(ctx)
	out := api.SearchResults{Links: []api.Link{}, Notes: []api.Note{}, Articles: []api.Article{},
		Comments: []api.Comment{}, Users: []api.User{}}

	kind := req.Params.Kind
	if kind == nil || *kind == api.SearchKindUser {
		users, err := h.A.Q.SearchUsers(ctx, dbgen.SearchUsersParams{
			Q: strings.ToLower(strings.TrimPrefix(raw, "@")), PageLimit: 10})
		if err != nil {
			return nil, err
		}
		if out.Users, err = present.New(h.A.Q, v).UserList(ctx, users); err != nil {
			return nil, err
		}
		if kind != nil {
			out.Total = len(out.Users)
			return api.Search200JSONResponse(out), nil
		}
	}

	arg := dbgen.SearchAllParams{Q: q, ViewerID: httpx.ViewerID(ctx), PageLimit: limit, PageOffset: offset}
	if kind != nil {
		arg.Kind = present.Ptr(string(*kind))
	}
	hits, err := h.A.Q.SearchAll(ctx, arg)
	if err != nil {
		return nil, err
	}
	var refs []timeline.Ref
	var commentIDs []int64
	for _, hit := range hits {
		if hit.Kind == "comment" {
			commentIDs = append(commentIDs, hit.ID)
		} else {
			refs = append(refs, timeline.Ref{Kind: hit.Kind, ID: hit.ID})
		}
	}
	items, err := timeline.Hydrate(ctx, h.A.Q, v, refs)
	if err != nil {
		return nil, err
	}
	for _, it := range items {
		switch {
		case it.Link != nil:
			out.Links = append(out.Links, *it.Link)
		case it.Note != nil:
			out.Notes = append(out.Notes, *it.Note)
		case it.Article != nil:
			out.Articles = append(out.Articles, *it.Article)
		}
	}
	for _, id := range commentIDs {
		row, err := h.A.Q.GetComment(ctx, id)
		if err != nil {
			continue
		}
		c, err := present.New(h.A.Q, v).CommentOne(ctx, row.Comment, row.User)
		if err == nil {
			out.Comments = append(out.Comments, c)
		}
	}
	out.Total = len(out.Links) + len(out.Notes) + len(out.Articles) + len(out.Comments) + len(out.Users)
	return api.Search200JSONResponse(out), nil
}
