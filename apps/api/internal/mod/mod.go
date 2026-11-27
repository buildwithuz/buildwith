// Package mod owns reports, moderator actions and the public moderation log.
// Every moderator action is written to mod_actions, which anyone can read.
package mod

import (
	"context"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/buildwithuz/buildwith/apps/api/internal/api"
	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/cursor"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/httpx"
	"github.com/buildwithuz/buildwith/apps/api/internal/notify"
	"github.com/buildwithuz/buildwith/apps/api/internal/present"
	"github.com/buildwithuz/buildwith/apps/api/internal/ratelimit"
)

type Mod struct{ A *app.App }

func reason(s string) (string, error) {
	s = strings.TrimSpace(s)
	if n := utf8.RuneCountInString(s); n < 3 || n > 500 {
		return "", httpx.Invalid("reason", "3-500 characters; the reason is public")
	}
	return s, nil
}

func (h *Mod) log(ctx context.Context, q *dbgen.Queries, actor int64, action, subjectType string, id *int64, text, why string) error {
	_, err := q.LogModAction(ctx, dbgen.LogModActionParams{ActorID: actor, Action: action, SubjectType: subjectType,
		SubjectID: id, SubjectText: text, Reason: why})
	return err
}

func (h *Mod) CreateReport(ctx context.Context, req api.CreateReportRequestObject) (api.CreateReportResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	ok, retry, err := h.A.Limiter.Allow(ctx, ratelimit.Reports, strconv.FormatInt(v.ID, 10))
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, httpx.RateLimited(retry)
	}
	note := ""
	if req.Body.Note != nil {
		note = strings.TrimSpace(*req.Body.Note)
	}
	if utf8.RuneCountInString(note) > 1000 {
		return nil, httpx.Invalid("note", "at most 1000 characters")
	}
	_, err = h.A.Q.CreateReport(ctx, dbgen.CreateReportParams{ReporterID: v.ID, SubjectType: string(req.Body.SubjectType),
		SubjectID: req.Body.SubjectId, Reason: string(req.Body.Reason), Note: note})
	return api.CreateReport204Response{}, err
}

func (h *Mod) ListModLog(ctx context.Context, req api.ListModLogRequestObject) (api.ListModLogResponseObject, error) {
	pos, err := cursor.Decode(req.Params.Cursor)
	if err != nil {
		return nil, httpx.Invalid("cursor", err.Error())
	}
	limit := cursor.Limit(req.Params.Limit, 50)
	arg := dbgen.ListModActionsParams{PageLimit: limit}
	if pos != nil {
		arg.CursorCreated, arg.CursorID = pos.T, &pos.ID
	}
	rows, err := h.A.Q.ListModActions(ctx, arg)
	if err != nil {
		return nil, err
	}
	users := make([]dbgen.User, len(rows))
	for i, r := range rows {
		users[i] = r.User
	}
	um, err := present.New(h.A.Q, httpx.Viewer(ctx)).Users(ctx, users)
	if err != nil {
		return nil, err
	}
	items := make([]api.ModAction, 0, len(rows))
	for _, r := range rows {
		m := r.ModAction
		items = append(items, api.ModAction{Id: m.ID, Actor: um[r.User.ID], Action: m.Action, SubjectType: m.SubjectType,
			SubjectId: m.SubjectID, SubjectText: present.Ptr(m.SubjectText), Reason: present.Ptr(m.Reason), CreatedAt: m.CreatedAt})
	}
	next := cursor.Next(rows, limit, func(r dbgen.ListModActionsRow) *string { return cursor.ByTime(r.ModAction.CreatedAt, r.ModAction.ID) })
	return api.ListModLog200JSONResponse{Items: items, NextCursor: next}, nil
}

func (h *Mod) ListModerators(ctx context.Context, _ api.ListModeratorsRequestObject) (api.ListModeratorsResponseObject, error) {
	rows, err := h.A.Q.ListModerators(ctx)
	if err != nil {
		return nil, err
	}
	items, err := present.New(h.A.Q, httpx.Viewer(ctx)).UserList(ctx, rows)
	return api.ListModerators200JSONResponse{UserPageJSONResponse: api.UserPageJSONResponse{Items: items}}, err
}

func (h *Mod) ListOpenReports(ctx context.Context, req api.ListOpenReportsRequestObject) (api.ListOpenReportsResponseObject, error) {
	v, err := httpx.RequireModerator(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := h.A.Q.ListOpenReports(ctx, cursor.Limit(req.Params.Limit, 50))
	if err != nil {
		return nil, err
	}
	users := make([]dbgen.User, len(rows))
	for i, r := range rows {
		users[i] = r.User
	}
	um, err := present.New(h.A.Q, v).Users(ctx, users)
	if err != nil {
		return nil, err
	}
	n, err := h.A.Q.CountOpenReports(ctx)
	if err != nil {
		return nil, err
	}
	out := api.ListOpenReports200JSONResponse{OpenCount: int(n), Items: make([]api.Report, 0, len(rows))}
	for _, r := range rows {
		out.Items = append(out.Items, api.Report{Id: r.Report.ID, Reporter: um[r.User.ID],
			SubjectType: api.ReportSubject(r.Report.SubjectType), SubjectId: r.Report.SubjectID,
			Reason: api.ReportReason(r.Report.Reason), Note: present.Ptr(r.Report.Note), CreatedAt: r.Report.CreatedAt})
	}
	return out, nil
}

func (h *Mod) ResolveReport(ctx context.Context, req api.ResolveReportRequestObject) (api.ResolveReportResponseObject, error) {
	v, err := httpx.RequireModerator(ctx)
	if err != nil {
		return nil, err
	}
	err = h.A.Tx(ctx, func(q *dbgen.Queries) error {
		if err := q.ResolveReport(ctx, dbgen.ResolveReportParams{ID: req.Id, Status: string(req.Body.Status), HandledBy: &v.ID}); err != nil {
			return err
		}
		if req.Body.Status == api.Dismissed {
			why := "dismissed"
			if req.Body.Reason != nil {
				why = *req.Body.Reason
			}
			return h.log(ctx, q, v.ID, "dismiss_report", "user", nil, "report #"+strconv.FormatInt(req.Id, 10), why)
		}
		return nil
	})
	return api.ResolveReport204Response{}, err
}

func (h *Mod) KillContent(ctx context.Context, req api.KillContentRequestObject) (api.KillContentResponseObject, error) {
	v, err := httpx.RequireModerator(ctx)
	if err != nil {
		return nil, err
	}
	why, err := reason(req.Body.Reason)
	if err != nil {
		return nil, err
	}
	b := req.Body
	id := b.SubjectId
	action := "kill"
	if !b.Killed {
		action = "unkill"
	}
	var author int64
	err = h.A.Tx(ctx, func(q *dbgen.Queries) error {
		t, err := q.GetVoteTarget(ctx, dbgen.GetVoteTargetParams{SubjectType: string(b.SubjectType), SubjectID: id})
		if err != nil {
			return err
		}
		if t.AuthorID == 0 {
			return httpx.NotFound(string(b.SubjectType))
		}
		author = t.AuthorID
		switch b.SubjectType {
		case api.FlagSubjectLink:
			err = q.KillLink(ctx, dbgen.KillLinkParams{ID: id, Enabled: b.Killed})
		case api.FlagSubjectArticle:
			err = q.KillArticle(ctx, dbgen.KillArticleParams{ID: id, Enabled: b.Killed})
		case api.FlagSubjectComment:
			err = q.KillComment(ctx, dbgen.KillCommentParams{ID: id, Enabled: b.Killed})
		case api.FlagSubjectNote:
			err = q.KillNote(ctx, dbgen.KillNoteParams{ID: id, Enabled: b.Killed})
		}
		if err != nil {
			return err
		}
		if !b.Killed {
			if _, err := q.ReleaseHold(ctx, dbgen.ReleaseHoldParams{SubjectType: string(b.SubjectType), SubjectID: id}); err != nil {
				return err
			}
		}
		return h.log(ctx, q, v.ID, action, string(b.SubjectType), &id, "", why)
	})
	if err != nil {
		return nil, err
	}
	notify.Send(ctx, h.A.Q, notify.Event{To: author, Kind: api.NotificationKindModAction, Actor: v.ID,
		SubjectType: string(b.SubjectType), SubjectID: id})
	return api.KillContent204Response{}, nil
}

func (h *Mod) BanUser(ctx context.Context, req api.BanUserRequestObject) (api.BanUserResponseObject, error) {
	v, err := httpx.RequireModerator(ctx)
	if err != nil {
		return nil, err
	}
	why, err := reason(req.Body.Reason)
	if err != nil {
		return nil, err
	}
	u, err := h.A.Q.GetUserByUsername(ctx, strings.TrimPrefix(req.Body.Username, "@"))
	if err != nil {
		return nil, httpx.NotFoundIfNoRows(err, "user")
	}
	if u.IsAdmin || (u.IsModerator && !v.IsAdmin) {
		return nil, httpx.Forbidden("moderators can only be removed by an admin")
	}
	err = h.A.Tx(ctx, func(q *dbgen.Queries) error {
		if req.Body.Banned {
			if err := q.BanUser(ctx, dbgen.BanUserParams{ID: u.ID, BanReason: why}); err != nil {
				return err
			}
			if err := q.DeleteUserSessions(ctx, u.ID); err != nil {
				return err
			}
			return h.log(ctx, q, v.ID, "ban", "user", &u.ID, u.Username, why)
		}
		if err := q.UnbanUser(ctx, u.ID); err != nil {
			return err
		}
		return h.log(ctx, q, v.ID, "unban", "user", &u.ID, u.Username, why)
	})
	return api.BanUser204Response{}, err
}

func (h *Mod) FeatureArticle(ctx context.Context, req api.FeatureArticleRequestObject) (api.FeatureArticleResponseObject, error) {
	v, err := httpx.RequireModerator(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.A.Q.GetArticle(ctx, req.Body.ArticleId)
	if err != nil {
		return nil, httpx.NotFoundIfNoRows(err, "article")
	}
	action := "feature"
	if !req.Body.Featured {
		action = "unfeature"
	}
	id := row.Article.ID
	err = h.A.Tx(ctx, func(q *dbgen.Queries) error {
		if err := q.FeatureArticle(ctx, dbgen.FeatureArticleParams{ID: id, Enabled: req.Body.Featured}); err != nil {
			return err
		}
		return h.log(ctx, q, v.ID, action, "article", &id, row.Article.Title, "editors' pick")
	})
	if err == nil && req.Body.Featured {
		notify.Send(ctx, h.A.Q, notify.Event{To: row.Article.AuthorID, Kind: api.NotificationKindFeatured, Actor: v.ID,
			SubjectType: "article", SubjectID: id})
	}
	return api.FeatureArticle204Response{}, err
}

func domainRule(r dbgen.DomainRule) api.DomainRule {
	return api.DomainRule{Domain: r.Domain, Multiplier: float32(r.Multiplier), Banned: r.Banned, Note: present.Ptr(r.Note)}
}

func (h *Mod) ListDomainRules(ctx context.Context, _ api.ListDomainRulesRequestObject) (api.ListDomainRulesResponseObject, error) {
	if _, err := httpx.RequireModerator(ctx); err != nil {
		return nil, err
	}
	rows, err := h.A.Q.ListDomainRules(ctx)
	if err != nil {
		return nil, err
	}
	out := api.ListDomainRules200JSONResponse{Items: make([]api.DomainRule, 0, len(rows))}
	for _, r := range rows {
		out.Items = append(out.Items, domainRule(r))
	}
	return out, nil
}

func (h *Mod) SetDomainRule(ctx context.Context, req api.SetDomainRuleRequestObject) (api.SetDomainRuleResponseObject, error) {
	v, err := httpx.RequireModerator(ctx)
	if err != nil {
		return nil, err
	}
	b := req.Body
	domain := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(b.Domain), "www."))
	if domain == "" || !strings.Contains(domain, ".") {
		return nil, httpx.Invalid("domain", "not a domain")
	}
	arg := dbgen.UpsertDomainRuleParams{Domain: domain, Multiplier: 1}
	if b.Multiplier != nil {
		arg.Multiplier = float64(*b.Multiplier)
	}
	if b.Banned != nil {
		arg.Banned = *b.Banned
	}
	if b.Note != nil {
		arg.Note = *b.Note
	}
	var r dbgen.DomainRule
	err = h.A.Tx(ctx, func(q *dbgen.Queries) error {
		var err error
		if r, err = q.UpsertDomainRule(ctx, arg); err != nil {
			return err
		}
		why := arg.Note
		if why == "" {
			why = "ranking rule"
		}
		return h.log(ctx, q, v.ID, "domain_rule", "domain", nil, domain, why)
	})
	if err != nil {
		return nil, err
	}
	return api.SetDomainRule200JSONResponse(domainRule(r)), nil
}

func (h *Mod) ListHolds(ctx context.Context, req api.ListHoldsRequestObject) (api.ListHoldsResponseObject, error) {
	if _, err := httpx.RequireModerator(ctx); err != nil {
		return nil, err
	}
	rows, err := h.A.Q.ListHolds(ctx, cursor.Limit(req.Params.Limit, 50))
	if err != nil {
		return nil, err
	}
	out := api.ListHolds200JSONResponse{Items: make([]api.Hold, 0, len(rows))}
	for _, r := range rows {
		out.Items = append(out.Items, api.Hold{SubjectType: r.SubjectType, SubjectId: r.SubjectID, Reason: r.Reason, CreatedAt: r.CreatedAt})
	}
	return out, nil
}

func (h *Mod) ReleaseHold(ctx context.Context, req api.ReleaseHoldRequestObject) (api.ReleaseHoldResponseObject, error) {
	if _, err := httpx.RequireModerator(ctx); err != nil {
		return nil, err
	}
	_, err := h.A.Q.ReleaseHold(ctx, dbgen.ReleaseHoldParams{SubjectType: string(req.Body.SubjectType), SubjectID: req.Body.SubjectId})
	return api.ReleaseHold204Response{}, err
}
