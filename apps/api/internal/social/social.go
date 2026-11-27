// Package social owns relationships between people and with tags: follows,
// blocks, mutes and muted words. Their effect on what anyone sees is enforced in
// SQL (bw_hidden, bw_blocked), not here.
package social

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/buildwithuz/buildwith/apps/api/internal/api"
	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/cursor"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/httpx"
	"github.com/buildwithuz/buildwith/apps/api/internal/notify"
	"github.com/buildwithuz/buildwith/apps/api/internal/present"
)

type Social struct{ A *app.App }

func (h *Social) target(ctx context.Context, username string) (dbgen.User, error) {
	u, err := h.A.Q.GetUserByUsername(ctx, strings.TrimPrefix(username, "@"))
	return u, httpx.NotFoundIfNoRows(err, "user")
}

func (h *Social) relation(ctx context.Context, viewer, other int64) (api.Relation, error) {
	r, err := h.A.Q.RelationTo(ctx, dbgen.RelationToParams{ViewerID: viewer, OtherID: other})
	return api.Relation{Following: r.Following, FollowedBy: r.FollowedBy, Blocking: r.Blocking, Muting: r.Muting}, err
}

// act runs one relationship change and returns the new relation.
func (h *Social) act(ctx context.Context, username string, needActive bool,
	do func(v *dbgen.User, t dbgen.User) error) (api.Relation, error) {
	var v *dbgen.User
	var err error
	if needActive {
		v, err = httpx.RequireActive(ctx)
	} else {
		v, err = httpx.RequireViewer(ctx)
	}
	if err != nil {
		return api.Relation{}, err
	}
	t, err := h.target(ctx, username)
	if err != nil {
		return api.Relation{}, err
	}
	if t.ID == v.ID {
		return api.Relation{}, httpx.Invalid("username", "that is you")
	}
	if err := do(v, t); err != nil {
		return api.Relation{}, err
	}
	return h.relation(ctx, v.ID, t.ID)
}

func rel(r api.Relation) api.RelationJSONResponse { return api.RelationJSONResponse(r) }

func (h *Social) FollowUser(ctx context.Context, req api.FollowUserRequestObject) (api.FollowUserResponseObject, error) {
	r, err := h.act(ctx, req.Username, true, func(v *dbgen.User, t dbgen.User) error {
		blocked, err := h.A.Q.IsBlocked(ctx, dbgen.IsBlockedParams{A: v.ID, B: t.ID})
		if err != nil {
			return err
		}
		if blocked {
			return httpx.Coded(http.StatusForbidden, api.ErrorCodeBlocked, "you cannot follow this account")
		}
		n, err := h.A.Q.Follow(ctx, dbgen.FollowParams{FollowerID: v.ID, FolloweeID: t.ID})
		if err == nil && n > 0 {
			notify.Send(ctx, h.A.Q, notify.Event{To: t.ID, Kind: api.NotificationKindFollow, Actor: v.ID,
				SubjectType: "user", SubjectID: v.ID})
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return api.FollowUser200JSONResponse{RelationJSONResponse: rel(r)}, nil
}

func (h *Social) UnfollowUser(ctx context.Context, req api.UnfollowUserRequestObject) (api.UnfollowUserResponseObject, error) {
	r, err := h.act(ctx, req.Username, false, func(v *dbgen.User, t dbgen.User) error {
		_, err := h.A.Q.Unfollow(ctx, dbgen.UnfollowParams{FollowerID: v.ID, FolloweeID: t.ID})
		return err
	})
	if err != nil {
		return nil, err
	}
	return api.UnfollowUser200JSONResponse{RelationJSONResponse: rel(r)}, nil
}

func (h *Social) BlockUser(ctx context.Context, req api.BlockUserRequestObject) (api.BlockUserResponseObject, error) {
	r, err := h.act(ctx, req.Username, false, func(v *dbgen.User, t dbgen.User) error {
		return h.A.Tx(ctx, func(q *dbgen.Queries) error {
			if _, err := q.Block(ctx, dbgen.BlockParams{BlockerID: v.ID, BlockedID: t.ID}); err != nil {
				return err
			}
			return q.RemoveFollowsBetween(ctx, dbgen.RemoveFollowsBetweenParams{A: v.ID, B: t.ID})
		})
	})
	if err != nil {
		return nil, err
	}
	return api.BlockUser200JSONResponse{RelationJSONResponse: rel(r)}, nil
}

func (h *Social) UnblockUser(ctx context.Context, req api.UnblockUserRequestObject) (api.UnblockUserResponseObject, error) {
	r, err := h.act(ctx, req.Username, false, func(v *dbgen.User, t dbgen.User) error {
		_, err := h.A.Q.Unblock(ctx, dbgen.UnblockParams{BlockerID: v.ID, BlockedID: t.ID})
		return err
	})
	if err != nil {
		return nil, err
	}
	return api.UnblockUser200JSONResponse{RelationJSONResponse: rel(r)}, nil
}

func (h *Social) MuteUser(ctx context.Context, req api.MuteUserRequestObject) (api.MuteUserResponseObject, error) {
	r, err := h.act(ctx, req.Username, false, func(v *dbgen.User, t dbgen.User) error {
		_, err := h.A.Q.Mute(ctx, dbgen.MuteParams{MuterID: v.ID, MutedID: t.ID})
		return err
	})
	if err != nil {
		return nil, err
	}
	return api.MuteUser200JSONResponse{RelationJSONResponse: rel(r)}, nil
}

func (h *Social) UnmuteUser(ctx context.Context, req api.UnmuteUserRequestObject) (api.UnmuteUserResponseObject, error) {
	r, err := h.act(ctx, req.Username, false, func(v *dbgen.User, t dbgen.User) error {
		_, err := h.A.Q.Unmute(ctx, dbgen.UnmuteParams{MuterID: v.ID, MutedID: t.ID})
		return err
	})
	if err != nil {
		return nil, err
	}
	return api.UnmuteUser200JSONResponse{RelationJSONResponse: rel(r)}, nil
}

func (h *Social) listPeople(ctx context.Context, username string, c *string, l *int, following bool) (api.UserPage, error) {
	t, err := h.target(ctx, username)
	if err != nil {
		return api.UserPage{}, err
	}
	pos, err := cursor.Decode(c)
	if err != nil {
		return api.UserPage{}, httpx.Invalid("cursor", err.Error())
	}
	limit := cursor.Limit(l, 30)
	var users []dbgen.User
	var last *string
	if following {
		p := dbgen.ListFollowingParams{UserID: t.ID, ViewerID: httpx.ViewerID(ctx), PageLimit: limit}
		if pos != nil {
			p.Cursor = pos.T
		}
		rows, err := h.A.Q.ListFollowing(ctx, p)
		if err != nil {
			return api.UserPage{}, err
		}
		for _, r := range rows {
			users = append(users, r.User)
		}
		last = cursor.Next(rows, limit, func(r dbgen.ListFollowingRow) *string { return cursor.ByTime(r.CreatedAt, r.User.ID) })
	} else {
		p := dbgen.ListFollowersParams{UserID: t.ID, ViewerID: httpx.ViewerID(ctx), PageLimit: limit}
		if pos != nil {
			p.Cursor = pos.T
		}
		rows, err := h.A.Q.ListFollowers(ctx, p)
		if err != nil {
			return api.UserPage{}, err
		}
		for _, r := range rows {
			users = append(users, r.User)
		}
		last = cursor.Next(rows, limit, func(r dbgen.ListFollowersRow) *string { return cursor.ByTime(r.CreatedAt, r.User.ID) })
	}
	items, err := present.New(h.A.Q, httpx.Viewer(ctx)).UserList(ctx, users)
	return api.UserPage{Items: items, NextCursor: last}, err
}

func (h *Social) ListFollowers(ctx context.Context, req api.ListFollowersRequestObject) (api.ListFollowersResponseObject, error) {
	page, err := h.listPeople(ctx, req.Username, req.Params.Cursor, req.Params.Limit, false)
	if err != nil {
		return nil, err
	}
	return api.ListFollowers200JSONResponse{UserPageJSONResponse: api.UserPageJSONResponse(page)}, nil
}

func (h *Social) ListFollowing(ctx context.Context, req api.ListFollowingRequestObject) (api.ListFollowingResponseObject, error) {
	page, err := h.listPeople(ctx, req.Username, req.Params.Cursor, req.Params.Limit, true)
	if err != nil {
		return nil, err
	}
	return api.ListFollowing200JSONResponse{UserPageJSONResponse: api.UserPageJSONResponse(page)}, nil
}

func (h *Social) WhoToFollow(ctx context.Context, req api.WhoToFollowRequestObject) (api.WhoToFollowResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := h.A.Q.WhoToFollow(ctx, dbgen.WhoToFollowParams{ViewerID: v.ID, PageLimit: cursor.Limit(req.Params.Limit, 5)})
	if err != nil {
		return nil, err
	}
	users := make([]dbgen.User, len(rows))
	for i, r := range rows {
		users[i] = r.User
	}
	pm, err := present.New(h.A.Q, v).Users(ctx, users)
	if err != nil {
		return nil, err
	}
	out := api.WhoToFollow200JSONResponse{}
	for _, r := range rows {
		out.Items = append(out.Items, struct {
			Mutuals int      `json:"mutuals"`
			User    api.User `json:"user"`
		}{Mutuals: int(r.Mutuals), User: pm[r.User.ID]})
	}
	if out.Items == nil {
		out.Items = out.Items[:0]
	}
	return out, nil
}

func (h *Social) ListMutedWords(ctx context.Context, _ api.ListMutedWordsRequestObject) (api.ListMutedWordsResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := h.A.Q.ListMutedWords(ctx, v.ID)
	if err != nil {
		return nil, err
	}
	out := api.ListMutedWords200JSONResponse{}
	for _, r := range rows {
		out.Items = append(out.Items, struct {
			Id   int64  `json:"id"`
			Word string `json:"word"`
		}{Id: r.ID, Word: r.Word})
	}
	if out.Items == nil {
		out.Items = out.Items[:0]
	}
	return out, nil
}

func (h *Social) AddMutedWord(ctx context.Context, req api.AddMutedWordRequestObject) (api.AddMutedWordResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	w := strings.TrimSpace(req.Body.Word)
	if n := utf8.RuneCountInString(w); n < 2 || n > 40 {
		return nil, httpx.Invalid("word", "2-40 characters")
	}
	return api.AddMutedWord204Response{}, h.A.Q.AddMutedWord(ctx, dbgen.AddMutedWordParams{UserID: v.ID, Word: w})
}

func (h *Social) RemoveMutedWord(ctx context.Context, req api.RemoveMutedWordRequestObject) (api.RemoveMutedWordResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	_, err = h.A.Q.RemoveMutedWord(ctx, dbgen.RemoveMutedWordParams{UserID: v.ID, ID: req.Id})
	return api.RemoveMutedWord204Response{}, err
}

// ---- tags --------------------------------------------------------------------

var tagSlugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,29}$`)

// NormalizeTag turns user input like "#Go Lang" into a slug, "go-lang".
func NormalizeTag(s string) string {
	s = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(s), "#")))
	s = strings.Join(strings.Fields(s), "-")
	s = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			return r
		}
		return -1
	}, s)
	s = strings.Trim(s, "-")
	if len(s) > 30 {
		s = s[:30]
	}
	if !tagSlugRe.MatchString(s) {
		return ""
	}
	return s
}

// UpsertTags resolves tag names to ids, creating new tags as needed.
func UpsertTags(ctx context.Context, q *dbgen.Queries, names []string, maxTags int) ([]int64, error) {
	seen := map[string]bool{}
	var ids []int64
	for _, n := range names {
		slug := NormalizeTag(n)
		if slug == "" || seen[slug] {
			continue
		}
		seen[slug] = true
		if len(ids) == maxTags {
			return nil, httpx.Invalid("tags", "too many tags")
		}
		t, err := q.UpsertTag(ctx, dbgen.UpsertTagParams{Slug: slug, Name: slug})
		if err != nil {
			return nil, err
		}
		ids = append(ids, t.ID)
	}
	return ids, nil
}

func (h *Social) ListTags(ctx context.Context, req api.ListTagsRequestObject) (api.ListTagsResponseObject, error) {
	limit := cursor.Limit(req.Params.Limit, 50)
	var rows []dbgen.Tag
	var err error
	if req.Params.Q != nil && strings.TrimSpace(*req.Params.Q) != "" {
		rows, err = h.A.Q.SearchTags(ctx, dbgen.SearchTagsParams{Q: NormalizeTag(*req.Params.Q), PageLimit: limit})
	} else {
		rows, err = h.A.Q.ListPopularTags(ctx, limit)
	}
	if err != nil {
		return nil, err
	}
	out := api.ListTags200JSONResponse{Items: make([]api.Tag, 0, len(rows))}
	for _, t := range rows {
		out.Items = append(out.Items, present.TagOf(t))
	}
	return out, nil
}

func (h *Social) tag(ctx context.Context, slug string) (api.Tag, dbgen.Tag, error) {
	t, err := h.A.Q.GetTagBySlug(ctx, NormalizeTag(slug))
	if err != nil {
		return api.Tag{}, t, httpx.NotFoundIfNoRows(err, "tag")
	}
	at := present.TagOf(t)
	if v := httpx.Viewer(ctx); v != nil {
		f, err := h.A.Q.IsFollowingTag(ctx, dbgen.IsFollowingTagParams{UserID: v.ID, TagID: t.ID})
		if err != nil {
			return at, t, err
		}
		at.Following = &f
	}
	return at, t, nil
}

func (h *Social) GetTag(ctx context.Context, req api.GetTagRequestObject) (api.GetTagResponseObject, error) {
	at, _, err := h.tag(ctx, req.Slug)
	if err != nil {
		return nil, err
	}
	return api.GetTag200JSONResponse(at), nil
}

func (h *Social) FollowTag(ctx context.Context, req api.FollowTagRequestObject) (api.FollowTagResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	_, t, err := h.tag(ctx, req.Slug)
	if err != nil {
		return nil, err
	}
	if _, err := h.A.Q.FollowTag(ctx, dbgen.FollowTagParams{UserID: v.ID, TagID: t.ID}); err != nil {
		return nil, err
	}
	at, _, err := h.tag(ctx, req.Slug)
	return api.FollowTag200JSONResponse(at), err
}

func (h *Social) UnfollowTag(ctx context.Context, req api.UnfollowTagRequestObject) (api.UnfollowTagResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	_, t, err := h.tag(ctx, req.Slug)
	if err != nil {
		return nil, err
	}
	if _, err := h.A.Q.UnfollowTag(ctx, dbgen.UnfollowTagParams{UserID: v.ID, TagID: t.ID}); err != nil {
		return nil, err
	}
	at, _, err := h.tag(ctx, req.Slug)
	return api.UnfollowTag200JSONResponse(at), err
}
