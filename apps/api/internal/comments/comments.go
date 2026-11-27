// Package comments owns threaded discussion under link posts and articles.
package comments

import (
	"context"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/buildwithuz/buildwith/apps/api/internal/api"
	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/httpx"
	"github.com/buildwithuz/buildwith/apps/api/internal/links"
	"github.com/buildwithuz/buildwith/apps/api/internal/markdown"
	"github.com/buildwithuz/buildwith/apps/api/internal/notify"
	"github.com/buildwithuz/buildwith/apps/api/internal/present"
	"github.com/buildwithuz/buildwith/apps/api/internal/rank"
	"github.com/buildwithuz/buildwith/apps/api/internal/ratelimit"
	"github.com/buildwithuz/buildwith/apps/api/internal/translit"
)

type Comments struct{ A *app.App }

const (
	EditWindow = time.Hour
	MaxDepth   = 12
)

// Cooldown is how long someone waits between comments when replying at a given
// depth. Deep back-and-forth slows down, which cools flamewars.
func Cooldown(depth int) time.Duration {
	if depth < 3 {
		return 0
	}
	return time.Duration(min(depth, 10)-2) * 15 * time.Second
}

func (h *Comments) ListComments(ctx context.Context, req api.ListCommentsRequestObject) (api.ListCommentsResponseObject, error) {
	limit := int32(500)
	if req.Params.Limit != nil {
		limit = int32(min(1000, max(1, *req.Params.Limit)))
	}
	rows, err := h.A.Q.ListCommentsForSubject(ctx, dbgen.ListCommentsForSubjectParams{
		SubjectType: string(req.Params.SubjectType), SubjectID: req.Params.SubjectId,
		ViewerID: httpx.ViewerID(ctx), PageLimit: limit,
	})
	if err != nil {
		return nil, err
	}
	items, err := present.New(h.A.Q, httpx.Viewer(ctx)).Comments(ctx, rows)
	if err != nil {
		return nil, err
	}
	if req.Params.Sort == nil || *req.Params.Sort == api.CommentSortBest {
		items = Best(items)
	}
	return api.ListComments200JSONResponse{Items: items}, nil
}

func (h *Comments) CreateComment(ctx context.Context, req api.CreateCommentRequestObject) (api.CreateCommentResponseObject, error) {
	v, err := httpx.RequireActive(ctx)
	if err != nil {
		return nil, err
	}
	b := req.Body
	body := strings.TrimSpace(translit.Normalize(b.BodyMd))
	if n := utf8.RuneCountInString(body); n < 1 || n > 10000 {
		return nil, httpx.Invalid("body_md", "1-10000 characters")
	}
	subjectAuthor, err := h.A.Q.GetCommentTarget(ctx, dbgen.GetCommentTargetParams{
		SubjectType: string(b.SubjectType), SubjectID: b.SubjectId,
	})
	if err != nil {
		return nil, err
	}
	if subjectAuthor == 0 {
		return nil, httpx.NotFound(string(b.SubjectType))
	}
	if err := h.notBlocked(ctx, v.ID, subjectAuthor); err != nil {
		return nil, err
	}

	depth := 0
	var parentAuthor int64
	if b.ParentId != nil {
		parent, err := h.A.Q.GetComment(ctx, *b.ParentId)
		if err != nil {
			return nil, httpx.NotFoundIfNoRows(err, "parent comment")
		}
		pc := parent.Comment
		if pc.SubjectType != string(b.SubjectType) || pc.SubjectID != b.SubjectId {
			return nil, httpx.Invalid("parent_id", "that comment belongs to another thread")
		}
		if pc.KilledAt != nil {
			return nil, httpx.Forbidden("that comment was removed by a moderator")
		}
		depth = int(pc.Depth) + 1
		if depth > MaxDepth {
			return nil, httpx.Invalid("parent_id", "this thread is as deep as it goes")
		}
		parentAuthor = pc.AuthorID
		if err := h.notBlocked(ctx, v.ID, parentAuthor); err != nil {
			return nil, err
		}
	}

	if wait := Cooldown(depth); wait > 0 {
		last, err := h.A.Q.LastCommentAt(ctx, v.ID)
		if err != nil {
			return nil, err
		}
		if left := wait - h.A.Clock.Now().Sub(last); left > 0 {
			return nil, httpx.RateLimited(int(left.Seconds()) + 1)
		}
	}
	if err := links.Limit(ctx, h.A, v, ratelimit.Comments, ratelimit.CommentsNew); err != nil {
		return nil, err
	}
	if ok, retry, err := h.A.Limiter.Allow(ctx, ratelimit.CommentBurst, itoa(v.ID)); err != nil {
		return nil, err
	} else if !ok {
		return nil, httpx.RateLimited(retry)
	}

	html := markdown.Render(body, markdown.Options{Profile: markdown.Comment,
		NoFollow: int(v.Karma) < rank.KarmaForFollowLinks}).HTML
	c, err := h.A.Q.CreateComment(ctx, dbgen.CreateCommentParams{
		SubjectType: string(b.SubjectType), SubjectID: b.SubjectId, AuthorID: v.ID,
		ParentID: b.ParentId, BodyMd: body, BodyHtml: html,
	})
	if err != nil {
		return nil, err
	}

	if parentAuthor != 0 {
		notify.Send(ctx, h.A.Q, notify.Event{To: parentAuthor, Kind: api.NotificationKindReply, Actor: v.ID,
			SubjectType: "comment", SubjectID: c.ID})
	} else {
		notify.Send(ctx, h.A.Q, notify.Event{To: subjectAuthor, Kind: api.NotificationKindComment, Actor: v.ID,
			SubjectType: "comment", SubjectID: c.ID})
	}
	notify.SendMentions(ctx, h.A.Q, body, v.ID, "comment", c.ID, parentAuthor, subjectAuthor)

	out, err := present.New(h.A.Q, v).CommentOne(ctx, c, *v)
	return api.CreateComment201JSONResponse(out), err
}

func (h *Comments) notBlocked(ctx context.Context, a, b int64) error {
	blocked, err := h.A.Q.IsBlocked(ctx, dbgen.IsBlockedParams{A: a, B: b})
	if err != nil {
		return err
	}
	if blocked {
		return httpx.Coded(http.StatusForbidden, api.ErrorCodeBlocked, "you cannot reply here")
	}
	return nil
}

func (h *Comments) UpdateComment(ctx context.Context, req api.UpdateCommentRequestObject) (api.UpdateCommentResponseObject, error) {
	v, err := httpx.RequireActive(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.A.Q.GetComment(ctx, req.Id)
	if err != nil {
		return nil, httpx.NotFoundIfNoRows(err, "comment")
	}
	if row.Comment.AuthorID != v.ID {
		return nil, httpx.Forbidden("not your comment")
	}
	if h.A.Clock.Now().Sub(row.Comment.CreatedAt) > EditWindow {
		return nil, httpx.Coded(http.StatusForbidden, api.ErrorCodeEditWindowClosed, "the edit window has closed")
	}
	body := strings.TrimSpace(translit.Normalize(req.Body.BodyMd))
	if n := utf8.RuneCountInString(body); n < 1 || n > 10000 {
		return nil, httpx.Invalid("body_md", "1-10000 characters")
	}
	html := markdown.Render(body, markdown.Options{Profile: markdown.Comment,
		NoFollow: int(v.Karma) < rank.KarmaForFollowLinks}).HTML
	c, err := h.A.Q.UpdateComment(ctx, dbgen.UpdateCommentParams{ID: req.Id, BodyMd: body, BodyHtml: html})
	if err != nil {
		return nil, err
	}
	out, err := present.New(h.A.Q, v).CommentOne(ctx, c, *v)
	return api.UpdateComment200JSONResponse(out), err
}

func (h *Comments) DeleteComment(ctx context.Context, req api.DeleteCommentRequestObject) (api.DeleteCommentResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.A.Q.GetComment(ctx, req.Id)
	if err != nil {
		return nil, httpx.NotFoundIfNoRows(err, "comment")
	}
	if row.Comment.AuthorID != v.ID {
		return nil, httpx.Forbidden("not your comment")
	}
	_, err = h.A.Q.SoftDeleteComment(ctx, req.Id)
	return api.DeleteComment204Response{}, err
}
