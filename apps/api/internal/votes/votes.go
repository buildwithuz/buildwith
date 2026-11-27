// Package votes owns upvotes, comment downvotes and flags.
package votes

import (
	"context"
	"net/http"
	"strconv"

	"github.com/buildwithuz/buildwith/apps/api/internal/api"
	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/httpx"
	"github.com/buildwithuz/buildwith/apps/api/internal/jobs"
	"github.com/buildwithuz/buildwith/apps/api/internal/rank"
	"github.com/buildwithuz/buildwith/apps/api/internal/ratelimit"
)

type Votes struct{ A *app.App }

func (h *Votes) target(ctx context.Context, v *dbgen.User, subject string, id int64) (dbgen.GetVoteTargetRow, error) {
	t, err := h.A.Q.GetVoteTarget(ctx, dbgen.GetVoteTargetParams{SubjectType: subject, SubjectID: id})
	if err != nil {
		return t, err
	}
	if t.AuthorID == 0 {
		return t, httpx.NotFound(subject)
	}
	if t.AuthorID == v.ID {
		return t, httpx.Forbidden("you cannot vote on or flag your own post")
	}
	blocked, err := h.A.Q.IsBlocked(ctx, dbgen.IsBlockedParams{A: v.ID, B: t.AuthorID})
	if err != nil {
		return t, err
	}
	if blocked {
		return t, httpx.Coded(http.StatusForbidden, api.ErrorCodeBlocked, "you cannot interact with this account")
	}
	return t, nil
}

func (h *Votes) state(ctx context.Context, subject string, id int64, viewer int64) (api.VoteStateJSONResponse, error) {
	t, err := h.A.Q.GetVoteTarget(ctx, dbgen.GetVoteTargetParams{SubjectType: subject, SubjectID: id})
	if err != nil {
		return api.VoteStateJSONResponse{}, err
	}
	val, err := h.A.Q.GetVote(ctx, dbgen.GetVoteParams{SubjectType: subject, SubjectID: id, UserID: viewer})
	if err != nil && !httpx.IsNoRows(err) {
		return api.VoteStateJSONResponse{}, err
	}
	return api.VoteStateJSONResponse{Points: int(t.Points), ViewerVote: api.VoteValue(val)}, nil
}

func (h *Votes) CastVote(ctx context.Context, req api.CastVoteRequestObject) (api.CastVoteResponseObject, error) {
	v, err := httpx.RequireActive(ctx)
	if err != nil {
		return nil, err
	}
	b := req.Body
	subject := string(b.SubjectType)
	if b.Value == api.VoteDirectionMinus1 {
		if b.SubjectType != api.VoteSubjectComment {
			return nil, httpx.Invalid("value", "only comments can be downvoted")
		}
		if int(v.Karma) < rank.KarmaToDownvote {
			return nil, httpx.Coded(http.StatusForbidden, api.ErrorCodeKarmaTooLow, "downvoting needs 100 karma")
		}
	}
	ok, retry, err := h.A.Limiter.Allow(ctx, ratelimit.Votes, strconv.FormatInt(v.ID, 10))
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, httpx.RateLimited(retry)
	}
	t, err := h.target(ctx, v, subject, b.SubjectId)
	if err != nil {
		return nil, err
	}
	if err := h.A.Q.CastVote(ctx, dbgen.CastVoteParams{SubjectType: subject, SubjectID: b.SubjectId,
		UserID: v.ID, Value: int16(b.Value)}); err != nil {
		return nil, err
	}
	_ = jobs.Enqueue(ctx, h.A.Q, jobs.RecomputeKarma, map[string]int64{"user_id": t.AuthorID}, h.A.Clock.Now())
	st, err := h.state(ctx, subject, b.SubjectId, v.ID)
	return api.CastVote200JSONResponse{VoteStateJSONResponse: st}, err
}

func (h *Votes) ClearVote(ctx context.Context, req api.ClearVoteRequestObject) (api.ClearVoteResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	subject := string(req.Params.SubjectType)
	n, err := h.A.Q.ClearVote(ctx, dbgen.ClearVoteParams{SubjectType: subject, SubjectID: req.Params.SubjectId, UserID: v.ID})
	if err != nil {
		return nil, err
	}
	if n > 0 {
		if t, err := h.A.Q.GetVoteTarget(ctx, dbgen.GetVoteTargetParams{SubjectType: subject, SubjectID: req.Params.SubjectId}); err == nil && t.AuthorID != 0 {
			_ = jobs.Enqueue(ctx, h.A.Q, jobs.RecomputeKarma, map[string]int64{"user_id": t.AuthorID}, h.A.Clock.Now())
		}
	}
	st, err := h.state(ctx, subject, req.Params.SubjectId, v.ID)
	return api.ClearVote200JSONResponse{VoteStateJSONResponse: st}, err
}

func (h *Votes) AddFlag(ctx context.Context, req api.AddFlagRequestObject) (api.AddFlagResponseObject, error) {
	v, err := httpx.RequireActive(ctx)
	if err != nil {
		return nil, err
	}
	if int(v.Karma) < rank.KarmaToFlag && !v.IsModerator {
		return nil, httpx.Coded(http.StatusForbidden, api.ErrorCodeKarmaTooLow, "flagging needs 30 karma")
	}
	subject := string(req.Body.SubjectType)
	if _, err := h.target(ctx, v, subject, req.Body.SubjectId); err != nil {
		return nil, err
	}
	if _, err := h.A.Q.AddFlag(ctx, dbgen.AddFlagParams{SubjectType: subject, SubjectID: req.Body.SubjectId, UserID: v.ID}); err != nil {
		return nil, err
	}
	trusted, err := h.A.Q.CountTrustedFlags(ctx, dbgen.CountTrustedFlagsParams{
		SubjectType: subject, SubjectID: req.Body.SubjectId, MinKarma: rank.TrustedFlagKarma,
	})
	if err != nil {
		return nil, err
	}
	if int(trusted) >= rank.HideAtTrusted {
		if err := h.A.Q.HoldForReview(ctx, dbgen.HoldForReviewParams{SubjectType: subject,
			SubjectID: req.Body.SubjectId, Reason: "flagged by trusted members"}); err != nil {
			return nil, err
		}
	}
	return api.AddFlag204Response{}, nil
}

func (h *Votes) RemoveFlag(ctx context.Context, req api.RemoveFlagRequestObject) (api.RemoveFlagResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	_, err = h.A.Q.RemoveFlag(ctx, dbgen.RemoveFlagParams{SubjectType: string(req.Params.SubjectType),
		SubjectID: req.Params.SubjectId, UserID: v.ID})
	return api.RemoveFlag204Response{}, err
}
