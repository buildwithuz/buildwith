// Package notes owns the X-style surface: short notes, replies, quotes,
// reposts, likes and bookmarks.
package notes

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/buildwithuz/buildwith/apps/api/internal/api"
	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/cursor"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/httpx"
	"github.com/buildwithuz/buildwith/apps/api/internal/jobs"
	"github.com/buildwithuz/buildwith/apps/api/internal/links"
	"github.com/buildwithuz/buildwith/apps/api/internal/markdown"
	"github.com/buildwithuz/buildwith/apps/api/internal/notify"
	"github.com/buildwithuz/buildwith/apps/api/internal/present"
	"github.com/buildwithuz/buildwith/apps/api/internal/rank"
	"github.com/buildwithuz/buildwith/apps/api/internal/ratelimit"
	"github.com/buildwithuz/buildwith/apps/api/internal/translit"
	"github.com/buildwithuz/buildwith/apps/api/internal/urlx"
)

type Notes struct{ A *app.App }

const (
	MaxChars   = 500
	MaxMedia   = 4
	EditWindow = 15 * time.Minute
)

func (h *Notes) one(ctx context.Context, id int64) (api.Note, error) {
	row, err := h.A.Q.GetNote(ctx, id)
	if err != nil {
		return api.Note{}, httpx.NotFoundIfNoRows(err, "note")
	}
	out, err := h.presentRows(ctx, []present.NoteRow{{Note: row.Note, User: row.User}})
	if err != nil {
		return api.Note{}, err
	}
	return out[0], nil
}

func (h *Notes) presentRows(ctx context.Context, rows []present.NoteRow) ([]api.Note, error) {
	v := httpx.Viewer(ctx)
	out, err := present.New(h.A.Q, v).Notes(ctx, rows)
	if err != nil {
		return nil, err
	}
	mod := v != nil && (v.IsModerator || v.IsAdmin)
	for i, r := range rows {
		if r.Note.KilledAt != nil && !mod && (v == nil || v.ID != r.Note.AuthorID) {
			out[i].BodyHtml, out[i].Code, out[i].Media = "", nil, []api.NoteMedia{}
		}
		if v != nil {
			can, err := h.A.Q.CanReplyToNote(ctx, dbgen.CanReplyToNoteParams{NoteID: r.Note.ID, ViewerID: v.ID})
			if err == nil {
				out[i].CanReply = present.Ptr(can)
			}
		}
	}
	return out, nil
}

func (h *Notes) notBlocked(ctx context.Context, a, b int64) error {
	blocked, err := h.A.Q.IsBlocked(ctx, dbgen.IsBlockedParams{A: a, B: b})
	if err != nil {
		return err
	}
	if blocked {
		return httpx.Coded(http.StatusForbidden, api.ErrorCodeBlocked, "you cannot interact with this account")
	}
	return nil
}

var firstURL = regexp.MustCompile(`https?://[^\s<>()]+`)

func (h *Notes) CreateNote(ctx context.Context, req api.CreateNoteRequestObject) (api.CreateNoteResponseObject, error) {
	v, err := httpx.RequireActive(ctx)
	if err != nil {
		return nil, err
	}
	b := req.Body
	refs := 0
	for _, p := range []*int64{b.ReplyToId, b.QuoteOfId, b.RepostOfId} {
		if p != nil {
			refs++
		}
	}
	if refs > 1 {
		return nil, httpx.Invalid("reply_to_id", "a note is a reply, a quote or a repost, not several")
	}
	if b.RepostOfId != nil {
		n, err := h.repost(ctx, v, *b.RepostOfId)
		if err != nil {
			return nil, err
		}
		return api.CreateNote201JSONResponse(n), nil
	}

	body := ""
	if b.BodyMd != nil {
		body = strings.TrimSpace(translit.Normalize(*b.BodyMd))
	}
	if utf8.RuneCountInString(body) > MaxChars {
		return nil, httpx.Invalid("body_md", "at most 500 characters")
	}
	arg := dbgen.CreateNoteParams{AuthorID: v.ID, BodyMd: body, ReplyPolicy: string(api.Everyone)}
	if b.ReplyPolicy != nil {
		arg.ReplyPolicy = string(*b.ReplyPolicy)
	}
	if b.Code != nil && strings.TrimSpace(b.Code.Body) != "" {
		lang := ""
		if b.Code.Lang != nil {
			lang = strings.ToLower(strings.TrimSpace(*b.Code.Lang))
		}
		if len(lang) > 20 || utf8.RuneCountInString(b.Code.Body) > 4000 {
			return nil, httpx.Invalid("code", "code is limited to 4000 characters")
		}
		arg.CodeLang, arg.CodeBody, arg.CodeHtml = lang, b.Code.Body, markdown.Highlight(b.Code.Body, lang)
	}
	var mediaItems []api.NoteMediaNew
	if b.Media != nil {
		mediaItems = *b.Media
	}
	if len(mediaItems) > MaxMedia {
		return nil, httpx.Invalid("media", "at most four images")
	}
	for i, m := range mediaItems {
		alt := strings.TrimSpace(m.Alt)
		if alt == "" || utf8.RuneCountInString(alt) > 300 {
			return nil, httpx.Invalid("media", "every image needs alt text (1-300 characters)")
		}
		mediaItems[i].Alt = alt
		row, err := h.A.Q.GetMedia(ctx, m.MediaId)
		if err != nil {
			return nil, httpx.NotFoundIfNoRows(err, "media")
		}
		if row.OwnerID == nil || *row.OwnerID != v.ID || row.Kind != "note" {
			return nil, httpx.Forbidden("that image is not yours")
		}
	}
	if body == "" && arg.CodeBody == "" && len(mediaItems) == 0 && b.QuoteOfId == nil {
		return nil, httpx.Invalid("body_md", "write something")
	}

	var notifyTo int64
	notifyKind := api.NotificationKindReply
	if b.ReplyToId != nil {
		parent, err := h.A.Q.GetNote(ctx, *b.ReplyToId)
		if err != nil {
			return nil, httpx.NotFoundIfNoRows(err, "note")
		}
		if parent.Note.KilledAt != nil {
			return nil, httpx.Forbidden("that note was removed by a moderator")
		}
		if err := h.notBlocked(ctx, v.ID, parent.Note.AuthorID); err != nil {
			return nil, err
		}
		allowed, err := h.A.Q.CanReplyToNote(ctx, dbgen.CanReplyToNoteParams{NoteID: parent.Note.ID, ViewerID: v.ID})
		if err != nil {
			return nil, err
		}
		if !allowed {
			return nil, httpx.Coded(http.StatusForbidden, api.ErrorCodeReplyNotAllowed, "the author limited who can reply")
		}
		arg.ReplyToID = &parent.Note.ID
		arg.RootID = parent.Note.RootID
		if arg.RootID == nil {
			arg.RootID = &parent.Note.ID
		}
		notifyTo = parent.Note.AuthorID
	}
	if b.QuoteOfId != nil {
		q, err := h.A.Q.GetNote(ctx, *b.QuoteOfId)
		if err != nil {
			return nil, httpx.NotFoundIfNoRows(err, "note")
		}
		if err := h.notBlocked(ctx, v.ID, q.Note.AuthorID); err != nil {
			return nil, err
		}
		arg.QuoteOfID = &q.Note.ID
		notifyTo, notifyKind = q.Note.AuthorID, api.NotificationKindQuote
	}

	if err := links.Limit(ctx, h.A, v, ratelimit.Notes, ratelimit.NotesNew); err != nil {
		return nil, err
	}
	arg.BodyHtml = markdown.Render(body, markdown.Options{Profile: markdown.Note,
		NoFollow: int(v.Karma) < rank.KarmaForFollowLinks}).HTML

	var n dbgen.Note
	err = h.A.Tx(ctx, func(q *dbgen.Queries) error {
		var err error
		if n, err = q.CreateNote(ctx, arg); err != nil {
			return err
		}
		for i, m := range mediaItems {
			if err := q.AddNoteMedia(ctx, dbgen.AddNoteMediaParams{NoteID: n.ID, MediaID: m.MediaId, Alt: m.Alt, Sort: int16(i)}); err != nil {
				return err
			}
		}
		// A link in a note without images gets a preview card, fetched in the background.
		if len(mediaItems) == 0 {
			if u := firstURL.FindString(body); u != "" {
				if _, err := urlx.Canonicalize(u); err == nil {
					return jobs.Enqueue(ctx, q, jobs.NotePreview, map[string]any{"note_id": n.ID, "url": u}, h.A.Clock.Now())
				}
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if notifyTo != 0 {
		notify.Send(ctx, h.A.Q, notify.Event{To: notifyTo, Kind: notifyKind, Actor: v.ID, SubjectType: "note", SubjectID: n.ID})
	}
	notify.SendMentions(ctx, h.A.Q, body, v.ID, "note", n.ID, notifyTo)

	out, err := h.one(ctx, n.ID)
	return api.CreateNote201JSONResponse(out), err
}

func (h *Notes) repost(ctx context.Context, v *dbgen.User, target int64) (api.Note, error) {
	orig, err := h.A.Q.GetNote(ctx, target)
	if err != nil {
		return api.Note{}, httpx.NotFoundIfNoRows(err, "note")
	}
	if orig.Note.RepostOfID != nil {
		// Reposting a repost reposts the original.
		return h.repost(ctx, v, *orig.Note.RepostOfID)
	}
	if err := h.notBlocked(ctx, v.ID, orig.Note.AuthorID); err != nil {
		return api.Note{}, err
	}
	if existing, err := h.A.Q.FindRepost(ctx, dbgen.FindRepostParams{AuthorID: v.ID, RepostOfID: &orig.Note.ID}); err == nil {
		return h.one(ctx, existing)
	} else if !httpx.IsNoRows(err) {
		return api.Note{}, err
	}
	if err := links.Limit(ctx, h.A, v, ratelimit.Notes, ratelimit.NotesNew); err != nil {
		return api.Note{}, err
	}
	n, err := h.A.Q.CreateNote(ctx, dbgen.CreateNoteParams{AuthorID: v.ID, RepostOfID: &orig.Note.ID, ReplyPolicy: string(api.Everyone)})
	if err != nil {
		return api.Note{}, err
	}
	notify.Send(ctx, h.A.Q, notify.Event{To: orig.Note.AuthorID, Kind: api.NotificationKindRepost, Actor: v.ID,
		SubjectType: "note", SubjectID: orig.Note.ID})
	return h.one(ctx, n.ID)
}

func (h *Notes) GetNote(ctx context.Context, req api.GetNoteRequestObject) (api.GetNoteResponseObject, error) {
	row, err := h.A.Q.GetNote(ctx, req.Id)
	if err != nil {
		return nil, httpx.NotFoundIfNoRows(err, "note")
	}
	if err := links.Visible(ctx, h.A.Q, "note", row.Note.ID, row.Note.AuthorID); err != nil {
		return nil, err
	}
	out, err := h.presentRows(ctx, []present.NoteRow{{Note: row.Note, User: row.User}})
	if err != nil {
		return nil, err
	}
	return api.GetNote200JSONResponse(out[0]), nil
}

func (h *Notes) UpdateNote(ctx context.Context, req api.UpdateNoteRequestObject) (api.UpdateNoteResponseObject, error) {
	v, err := httpx.RequireActive(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.A.Q.GetNote(ctx, req.Id)
	if err != nil {
		return nil, httpx.NotFoundIfNoRows(err, "note")
	}
	n := row.Note
	if n.AuthorID != v.ID || n.RepostOfID != nil {
		return nil, httpx.Forbidden("not your note")
	}
	if h.A.Clock.Now().Sub(n.CreatedAt) > EditWindow {
		return nil, httpx.Coded(http.StatusForbidden, api.ErrorCodeEditWindowClosed, "notes can be edited for 15 minutes")
	}
	body := strings.TrimSpace(translit.Normalize(req.Body.BodyMd))
	if utf8.RuneCountInString(body) > MaxChars {
		return nil, httpx.Invalid("body_md", "at most 500 characters")
	}
	if body == "" && n.CodeBody == "" {
		return nil, httpx.Invalid("body_md", "write something")
	}
	html := markdown.Render(body, markdown.Options{Profile: markdown.Note, NoFollow: int(v.Karma) < rank.KarmaForFollowLinks}).HTML
	err = h.A.Tx(ctx, func(q *dbgen.Queries) error {
		if body == n.BodyMd {
			return nil
		}
		if err := q.RecordNoteEdit(ctx, dbgen.RecordNoteEditParams{NoteID: n.ID, BodyMd: n.BodyMd}); err != nil {
			return err
		}
		_, err := q.UpdateNote(ctx, dbgen.UpdateNoteParams{ID: n.ID, BodyMd: body, BodyHtml: html})
		return err
	})
	if err != nil {
		return nil, err
	}
	out, err := h.one(ctx, n.ID)
	return api.UpdateNote200JSONResponse(out), err
}

func (h *Notes) DeleteNote(ctx context.Context, req api.DeleteNoteRequestObject) (api.DeleteNoteResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.A.Q.GetNote(ctx, req.Id)
	if err != nil {
		return nil, httpx.NotFoundIfNoRows(err, "note")
	}
	if row.Note.AuthorID != v.ID {
		return nil, httpx.Forbidden("not your note")
	}
	_, err = h.A.Q.SoftDeleteNote(ctx, req.Id)
	return api.DeleteNote204Response{}, err
}

func (h *Notes) GetNoteThread(ctx context.Context, req api.GetNoteThreadRequestObject) (api.GetNoteThreadResponseObject, error) {
	row, err := h.A.Q.GetNote(ctx, req.Id)
	if err != nil {
		return nil, httpx.NotFoundIfNoRows(err, "note")
	}
	if err := links.Visible(ctx, h.A.Q, "note", row.Note.ID, row.Note.AuthorID); err != nil {
		return nil, err
	}
	viewer := httpx.ViewerID(ctx)
	anc, err := h.A.Q.ListNoteAncestors(ctx, req.Id)
	if err != nil {
		return nil, err
	}
	reps, err := h.A.Q.ListNoteReplies(ctx, dbgen.ListNoteRepliesParams{NoteID: req.Id, ViewerID: viewer,
		PageLimit: cursor.Limit(req.Params.Limit, 50)})
	if err != nil {
		return nil, err
	}
	all := []present.NoteRow{{Note: row.Note, User: row.User}}
	for _, a := range anc {
		all = append(all, present.NoteRow{Note: a.Note, User: a.User})
	}
	for _, r := range reps {
		all = append(all, present.NoteRow{Note: r.Note, User: r.User})
	}
	out, err := h.presentRows(ctx, all)
	if err != nil {
		return nil, err
	}
	res := api.GetNoteThread200JSONResponse{Note: out[0], Ancestors: out[1 : 1+len(anc)], Replies: out[1+len(anc):]}
	return res, nil
}

func (h *Notes) ListNoteEdits(ctx context.Context, req api.ListNoteEditsRequestObject) (api.ListNoteEditsResponseObject, error) {
	rows, err := h.A.Q.ListNoteEdits(ctx, req.Id)
	if err != nil {
		return nil, err
	}
	out := api.ListNoteEdits200JSONResponse{}
	for _, r := range rows {
		out.Items = append(out.Items, struct {
			BodyMd    string    `json:"body_md"`
			CreatedAt time.Time `json:"created_at"`
		}{BodyMd: r.BodyMd, CreatedAt: r.CreatedAt})
	}
	if out.Items == nil {
		out.Items = out.Items[:0]
	}
	return out, nil
}

// ---- reactions ---------------------------------------------------------------

func (h *Notes) state(ctx context.Context, id int64) (api.NoteStateJSONResponse, error) {
	n, err := h.one(ctx, id)
	if err != nil {
		return api.NoteStateJSONResponse{}, err
	}
	return api.NoteStateJSONResponse{LikeCount: n.LikeCount, RepostCount: n.RepostCount,
		Liked: deref(n.Liked), Reposted: deref(n.Reposted), Bookmarked: deref(n.Bookmarked)}, nil
}

func deref(b *bool) bool { return b != nil && *b }

// react loads the target note and checks the viewer may interact with it.
func (h *Notes) react(ctx context.Context, id int64) (*dbgen.User, dbgen.Note, error) {
	v, err := httpx.RequireActive(ctx)
	if err != nil {
		return nil, dbgen.Note{}, err
	}
	row, err := h.A.Q.GetNote(ctx, id)
	if err != nil {
		return nil, dbgen.Note{}, httpx.NotFoundIfNoRows(err, "note")
	}
	if err := h.notBlocked(ctx, v.ID, row.Note.AuthorID); err != nil {
		return nil, dbgen.Note{}, err
	}
	return v, row.Note, nil
}

func (h *Notes) LikeNote(ctx context.Context, req api.LikeNoteRequestObject) (api.LikeNoteResponseObject, error) {
	v, n, err := h.react(ctx, req.Id)
	if err != nil {
		return nil, err
	}
	added, err := h.A.Q.LikeNote(ctx, dbgen.LikeNoteParams{NoteID: n.ID, UserID: v.ID})
	if err != nil {
		return nil, err
	}
	if added > 0 {
		notify.Send(ctx, h.A.Q, notify.Event{To: n.AuthorID, Kind: api.NotificationKindLike, Actor: v.ID, SubjectType: "note", SubjectID: n.ID})
		_ = jobs.Enqueue(ctx, h.A.Q, jobs.RecomputeKarma, map[string]int64{"user_id": n.AuthorID}, h.A.Clock.Now())
	}
	st, err := h.state(ctx, n.ID)
	return api.LikeNote200JSONResponse{NoteStateJSONResponse: st}, err
}

func (h *Notes) UnlikeNote(ctx context.Context, req api.UnlikeNoteRequestObject) (api.UnlikeNoteResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := h.A.Q.UnlikeNote(ctx, dbgen.UnlikeNoteParams{NoteID: req.Id, UserID: v.ID}); err != nil {
		return nil, err
	}
	st, err := h.state(ctx, req.Id)
	return api.UnlikeNote200JSONResponse{NoteStateJSONResponse: st}, err
}

func (h *Notes) RepostNote(ctx context.Context, req api.RepostNoteRequestObject) (api.RepostNoteResponseObject, error) {
	v, n, err := h.react(ctx, req.Id)
	if err != nil {
		return nil, err
	}
	if _, err := h.repost(ctx, v, n.ID); err != nil {
		return nil, err
	}
	target := n.ID
	if n.RepostOfID != nil {
		target = *n.RepostOfID
	}
	st, err := h.state(ctx, target)
	return api.RepostNote200JSONResponse{NoteStateJSONResponse: st}, err
}

func (h *Notes) UnrepostNote(ctx context.Context, req api.UnrepostNoteRequestObject) (api.UnrepostNoteResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	if id, err := h.A.Q.FindRepost(ctx, dbgen.FindRepostParams{AuthorID: v.ID, RepostOfID: &req.Id}); err == nil {
		if _, err := h.A.Q.SoftDeleteNote(ctx, id); err != nil {
			return nil, err
		}
	} else if !httpx.IsNoRows(err) {
		return nil, err
	}
	st, err := h.state(ctx, req.Id)
	return api.UnrepostNote200JSONResponse{NoteStateJSONResponse: st}, err
}

func (h *Notes) BookmarkNote(ctx context.Context, req api.BookmarkNoteRequestObject) (api.BookmarkNoteResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := h.A.Q.GetNote(ctx, req.Id); err != nil {
		return nil, httpx.NotFoundIfNoRows(err, "note")
	}
	if _, err := h.A.Q.BookmarkNote(ctx, dbgen.BookmarkNoteParams{NoteID: req.Id, UserID: v.ID}); err != nil {
		return nil, err
	}
	st, err := h.state(ctx, req.Id)
	return api.BookmarkNote200JSONResponse{NoteStateJSONResponse: st}, err
}

func (h *Notes) UnbookmarkNote(ctx context.Context, req api.UnbookmarkNoteRequestObject) (api.UnbookmarkNoteResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := h.A.Q.UnbookmarkNote(ctx, dbgen.UnbookmarkNoteParams{NoteID: req.Id, UserID: v.ID}); err != nil {
		return nil, err
	}
	st, err := h.state(ctx, req.Id)
	return api.UnbookmarkNote200JSONResponse{NoteStateJSONResponse: st}, err
}

// ---- lists -------------------------------------------------------------------

func (h *Notes) ListNotes(ctx context.Context, req api.ListNotesRequestObject) (api.ListNotesResponseObject, error) {
	pos, err := cursor.Decode(req.Params.Cursor)
	if err != nil {
		return nil, httpx.Invalid("cursor", err.Error())
	}
	limit := cursor.Limit(req.Params.Limit, 30)
	arg := dbgen.ListNotesParams{ViewerID: httpx.ViewerID(ctx), PageLimit: limit}
	if req.Params.Author != nil && *req.Params.Author != "" {
		u, err := h.A.Q.GetUserByUsername(ctx, strings.TrimPrefix(*req.Params.Author, "@"))
		if httpx.IsNoRows(err) {
			return api.ListNotes200JSONResponse{Items: []api.Note{}}, nil
		} else if err != nil {
			return nil, err
		}
		arg.AuthorID = &u.ID
	}
	if pos != nil {
		arg.CursorCreated, arg.CursorID = pos.T, &pos.ID
	}
	rows, err := h.A.Q.ListNotes(ctx, arg)
	if err != nil {
		return nil, err
	}
	nr := make([]present.NoteRow, len(rows))
	for i, r := range rows {
		nr[i] = present.NoteRow{Note: r.Note, User: r.User}
	}
	items, err := h.presentRows(ctx, nr)
	if err != nil {
		return nil, err
	}
	next := cursor.Next(rows, limit, func(r dbgen.ListNotesRow) *string { return cursor.ByTime(r.Note.CreatedAt, r.Note.ID) })
	return api.ListNotes200JSONResponse{Items: items, NextCursor: next}, nil
}

func (h *Notes) ListPopularNotes(ctx context.Context, req api.ListPopularNotesRequestObject) (api.ListPopularNotesResponseObject, error) {
	rows, err := h.A.Q.ListPopularNotes(ctx, dbgen.ListPopularNotesParams{
		MinTraction: rank.PopularNoteTraction, ViewerID: httpx.ViewerID(ctx), PageLimit: cursor.Limit(req.Params.Limit, 5),
	})
	if err != nil {
		return nil, err
	}
	nr := make([]present.NoteRow, len(rows))
	for i, r := range rows {
		nr[i] = present.NoteRow{Note: r.Note, User: r.User}
	}
	items, err := h.presentRows(ctx, nr)
	return api.ListPopularNotes200JSONResponse{Items: items}, err
}

func (h *Notes) ListBookmarks(ctx context.Context, req api.ListBookmarksRequestObject) (api.ListBookmarksResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	pos, err := cursor.Decode(req.Params.Cursor)
	if err != nil {
		return nil, httpx.Invalid("cursor", err.Error())
	}
	limit := cursor.Limit(req.Params.Limit, 30)
	arg := dbgen.ListBookmarkedNotesParams{UserID: v.ID, PageLimit: limit}
	if pos != nil {
		arg.CursorCreated, arg.CursorID = pos.T, &pos.ID
	}
	rows, err := h.A.Q.ListBookmarkedNotes(ctx, arg)
	if err != nil {
		return nil, err
	}
	nr := make([]present.NoteRow, len(rows))
	for i, r := range rows {
		nr[i] = present.NoteRow{Note: r.Note, User: r.User}
	}
	items, err := h.presentRows(ctx, nr)
	if err != nil {
		return nil, err
	}
	next := cursor.Next(rows, limit, func(r dbgen.ListBookmarkedNotesRow) *string { return cursor.ByTime(r.BookmarkedAt, r.Note.ID) })
	return api.ListBookmarks200JSONResponse{Items: items, NextCursor: next}, nil
}
