// Package timeline builds the chronological Following feed: fan-out on read,
// no ranking, keyset paginated across links, notes and articles.
package timeline

import (
	"context"

	"github.com/buildwithuz/buildwith/apps/api/internal/api"
	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/cursor"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/httpx"
	"github.com/buildwithuz/buildwith/apps/api/internal/present"
)

type Timeline struct{ A *app.App }

// Ref is one item to hydrate.
type Ref struct {
	Kind string
	ID   int64
}

// Hydrate loads and presents mixed items in the given order, one query per kind.
// Items that became invisible between listing and loading are dropped.
func Hydrate(ctx context.Context, q *dbgen.Queries, viewer *dbgen.User, refs []Ref) ([]api.FeedItem, error) {
	var linkIDs, noteIDs, articleIDs []int64
	for _, r := range refs {
		switch r.Kind {
		case "link":
			linkIDs = append(linkIDs, r.ID)
		case "note":
			noteIDs = append(noteIDs, r.ID)
		case "article":
			articleIDs = append(articleIDs, r.ID)
		}
	}
	var vid *int64
	if viewer != nil {
		vid = &viewer.ID
	}
	p := present.New(q, viewer)
	linkMap, noteMap, articleMap := map[int64]api.Link{}, map[int64]api.Note{}, map[int64]api.Article{}

	if len(linkIDs) > 0 {
		rows, err := q.ListLinksByIDs(ctx, dbgen.ListLinksByIDsParams{Ids: linkIDs, ViewerID: vid})
		if err != nil {
			return nil, err
		}
		lr := make([]present.LinkRow, len(rows))
		for i, r := range rows {
			lr[i] = present.LinkRow{Link: r.Link, User: r.User}
		}
		items, err := p.Links(ctx, lr)
		if err != nil {
			return nil, err
		}
		for _, l := range items {
			linkMap[l.Id] = l
		}
	}
	if len(noteIDs) > 0 {
		rows, err := q.ListNotesByIDs(ctx, dbgen.ListNotesByIDsParams{Ids: noteIDs, ViewerID: vid})
		if err != nil {
			return nil, err
		}
		nr := make([]present.NoteRow, len(rows))
		for i, r := range rows {
			nr[i] = present.NoteRow{Note: r.Note, User: r.User}
		}
		items, err := p.Notes(ctx, nr)
		if err != nil {
			return nil, err
		}
		for _, n := range items {
			noteMap[n.Id] = n
		}
	}
	if len(articleIDs) > 0 {
		rows, err := q.ListArticlesByIDs(ctx, dbgen.ListArticlesByIDsParams{Ids: articleIDs, ViewerID: vid})
		if err != nil {
			return nil, err
		}
		ar := make([]present.ArticleRow, len(rows))
		for i, r := range rows {
			ar[i] = present.ArticleRow{Article: r.Article, User: r.User}
		}
		items, err := p.Articles(ctx, ar, false)
		if err != nil {
			return nil, err
		}
		for _, a := range items {
			articleMap[a.Id] = a
		}
	}

	out := make([]api.FeedItem, 0, len(refs))
	for _, r := range refs {
		switch r.Kind {
		case "link":
			if l, ok := linkMap[r.ID]; ok {
				out = append(out, api.FeedItem{Kind: api.FeedKindLink, CreatedAt: l.CreatedAt, Link: &l})
			}
		case "note":
			if n, ok := noteMap[r.ID]; ok {
				out = append(out, api.FeedItem{Kind: api.FeedKindNote, CreatedAt: n.CreatedAt, Note: &n})
			}
		case "article":
			if a, ok := articleMap[r.ID]; ok {
				at := a.CreatedAt
				if a.PublishedAt != nil {
					at = *a.PublishedAt
				}
				out = append(out, api.FeedItem{Kind: api.FeedKindArticle, CreatedAt: at, Article: &a})
			}
		}
	}
	return out, nil
}

func (h *Timeline) GetTimeline(ctx context.Context, req api.GetTimelineRequestObject) (api.GetTimelineResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	pos, err := cursor.Decode(req.Params.Cursor)
	if err != nil {
		return nil, httpx.Invalid("cursor", err.Error())
	}
	limit := cursor.Limit(req.Params.Limit, 30)
	arg := dbgen.ListTimelineParams{ViewerID: v.ID, PageLimit: limit}
	if pos != nil {
		arg.CursorCreated, arg.CursorID = pos.T, &pos.ID
	}
	rows, err := h.A.Q.ListTimeline(ctx, arg)
	if err != nil {
		return nil, err
	}
	refs := make([]Ref, len(rows))
	for i, r := range rows {
		refs[i] = Ref{Kind: r.Kind, ID: r.ID}
	}
	items, err := Hydrate(ctx, h.A.Q, v, refs)
	if err != nil {
		return nil, err
	}
	next := cursor.Next(rows, limit, func(r dbgen.ListTimelineRow) *string { return cursor.ByTime(r.CreatedAt, r.ID) })
	return api.GetTimeline200JSONResponse{Items: items, NextCursor: next}, nil
}

func (h *Timeline) CountTimelineSince(ctx context.Context, req api.CountTimelineSinceRequestObject) (api.CountTimelineSinceResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	n, err := h.A.Q.CountTimelineSince(ctx, dbgen.CountTimelineSinceParams{ViewerID: v.ID, Since: req.Params.Since})
	return api.CountTimelineSince200JSONResponse{Count: int(n)}, err
}
