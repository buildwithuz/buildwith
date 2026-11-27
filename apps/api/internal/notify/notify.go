// Package notify creates in-app notifications, queues their Telegram delivery,
// and streams unread counts to open browser tabs.
package notify

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/buildwithuz/buildwith/apps/api/internal/api"
	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/cursor"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/httpx"
	"github.com/buildwithuz/buildwith/apps/api/internal/jobs"
	"github.com/buildwithuz/buildwith/apps/api/internal/present"
)

// Event is one thing worth telling someone about.
type Event struct {
	To          int64
	Kind        api.NotificationKind
	Actor       int64
	SubjectType string
	SubjectID   int64
}

// Send records ev. The SQL refuses notifications to yourself and across blocks
// or mutes, so callers do not need to check.
func Send(ctx context.Context, q *dbgen.Queries, ev Event) {
	n, err := q.CreateNotification(ctx, dbgen.CreateNotificationParams{
		UserID: ev.To, Kind: string(ev.Kind), ActorID: &ev.Actor,
		SubjectType: ev.SubjectType, SubjectID: &ev.SubjectID,
	})
	if err != nil {
		slog.WarnContext(ctx, "notification not saved", "kind", ev.Kind, "err", err)
		return
	}
	if n == 0 {
		return
	}
	DefaultHub.Publish(ev.To)
	_ = jobs.Enqueue(ctx, q, jobs.TelegramNotify, map[string]any{
		"user_id": ev.To, "kind": ev.Kind, "actor_id": ev.Actor,
		"subject_type": ev.SubjectType, "subject_id": ev.SubjectID,
	}, time.Now())
}

var mentionRe = regexp.MustCompile(`(?:^|[\s(])@([A-Za-z0-9][A-Za-z0-9_-]{1,29})\b`)

// Mentions returns the distinct usernames mentioned in Markdown, at most ten.
func Mentions(body string) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range mentionRe.FindAllStringSubmatch(body, -1) {
		name := strings.ToLower(m[1])
		if !seen[name] {
			seen[name] = true
			out = append(out, m[1])
		}
		if len(out) == 10 {
			break
		}
	}
	return out
}

// SendMentions notifies everyone mentioned in body, except those in skip.
func SendMentions(ctx context.Context, q *dbgen.Queries, body string, actor int64, subjectType string, subjectID int64, skip ...int64) {
	for _, name := range Mentions(body) {
		u, err := q.GetUserByUsername(ctx, name)
		if err != nil {
			continue
		}
		skipped := false
		for _, s := range skip {
			skipped = skipped || s == u.ID
		}
		if !skipped {
			Send(ctx, q, Event{To: u.ID, Kind: api.NotificationKindMention, Actor: actor,
				SubjectType: subjectType, SubjectID: subjectID})
		}
	}
}

// Hub fans "your unread count changed" out to open event streams in this process.
type Hub struct {
	mu   sync.Mutex
	subs map[int64]map[chan struct{}]bool
}

var DefaultHub = &Hub{subs: map[int64]map[chan struct{}]bool{}}

func (h *Hub) Subscribe(user int64) (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	h.mu.Lock()
	if h.subs[user] == nil {
		h.subs[user] = map[chan struct{}]bool{}
	}
	h.subs[user][ch] = true
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		delete(h.subs[user], ch)
		h.mu.Unlock()
	}
}

func (h *Hub) Publish(user int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs[user] {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

// ---- handlers ----------------------------------------------------------------

type Notify struct{ A *app.App }

func Href(n dbgen.Notification, actorUsername string) string {
	if n.SubjectID == nil {
		if actorUsername != "" {
			return "/@" + actorUsername
		}
		return "/notifications"
	}
	id := *n.SubjectID
	switch n.SubjectType {
	case "link":
		return fmt.Sprintf("/l/%d", id)
	case "article":
		return fmt.Sprintf("/a/%d", id)
	case "note":
		return fmt.Sprintf("/n/%d", id)
	case "comment":
		return fmt.Sprintf("/c/%d", id)
	case "user":
		if actorUsername != "" {
			return "/@" + actorUsername
		}
	}
	return "/notifications"
}

func (h *Notify) ListNotifications(ctx context.Context, req api.ListNotificationsRequestObject) (api.ListNotificationsResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	pos, err := cursor.Decode(req.Params.Cursor)
	if err != nil {
		return nil, httpx.Invalid("cursor", err.Error())
	}
	limit := cursor.Limit(req.Params.Limit, 30)
	params := dbgen.ListNotificationsParams{UserID: v.ID, PageLimit: limit}
	if pos != nil {
		params.CursorCreated, params.CursorID = pos.T, &pos.ID
	}
	rows, err := h.A.Q.ListNotifications(ctx, params)
	if err != nil {
		return nil, err
	}
	var actorIDs []int64
	for _, r := range rows {
		if r.ActorIDOut != nil {
			actorIDs = append(actorIDs, *r.ActorIDOut)
		}
	}
	actors, err := h.A.Q.ListUsersByID(ctx, actorIDs)
	if err != nil {
		return nil, err
	}
	pm, err := present.New(h.A.Q, v).Users(ctx, actors)
	if err != nil {
		return nil, err
	}
	items := make([]api.Notification, 0, len(rows))
	for _, r := range rows {
		n := r.Notification
		item := api.Notification{
			Id: n.ID, Kind: api.NotificationKind(n.Kind), Read: n.ReadAt != nil, CreatedAt: n.CreatedAt,
			SubjectId: n.SubjectID, SubjectType: present.Ptr(n.SubjectType),
		}
		username := ""
		if r.ActorIDOut != nil {
			if a, ok := pm[*r.ActorIDOut]; ok {
				item.Actor = &a
				username = a.Username
			}
		}
		item.Href = present.Ptr(Href(n, username))
		items = append(items, item)
	}
	unread, err := h.A.Q.CountUnreadNotifications(ctx, v.ID)
	if err != nil {
		return nil, err
	}
	next := cursor.Next(rows, limit, func(r dbgen.ListNotificationsRow) *string {
		return cursor.ByTime(r.Notification.CreatedAt, r.Notification.ID)
	})
	return api.ListNotifications200JSONResponse{Items: items, NextCursor: next, Unread: int(unread)}, nil
}

func (h *Notify) CountUnread(ctx context.Context, _ api.CountUnreadRequestObject) (api.CountUnreadResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	n, err := h.A.Q.CountUnreadNotifications(ctx, v.ID)
	return api.CountUnread200JSONResponse{Count: int(n)}, err
}

func (h *Notify) MarkNotificationsRead(ctx context.Context, req api.MarkNotificationsReadRequestObject) (api.MarkNotificationsReadResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body != nil && req.Body.Id != nil {
		_, err = h.A.Q.MarkNotificationRead(ctx, dbgen.MarkNotificationReadParams{ID: *req.Body.Id, UserID: v.ID})
	} else {
		_, err = h.A.Q.MarkNotificationsRead(ctx, v.ID)
	}
	if err != nil {
		return nil, err
	}
	DefaultHub.Publish(v.ID)
	return api.MarkNotificationsRead204Response{}, nil
}

// sseStream writes the unread count whenever it changes, polling as a fallback
// for notifications created by other processes (the worker, the bot).
type sseStream struct {
	a    *app.App
	user int64
}

func (s sseStream) VisitStreamNotificationsResponse(w http.ResponseWriter) error {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return fmt.Errorf("streaming unsupported")
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	ctx := httpx.ContextOf(w)
	ch, unsubscribe := DefaultHub.Subscribe(s.user)
	defer unsubscribe()

	poll := time.NewTicker(15 * time.Second)
	keepAlive := time.NewTicker(25 * time.Second)
	defer poll.Stop()
	defer keepAlive.Stop()

	last := int32(-1)
	send := func() error {
		n, err := s.a.Q.CountUnreadNotifications(ctx, s.user)
		if err != nil {
			return err
		}
		if n != last {
			last = n
			if _, err := fmt.Fprintf(w, "event: unread\ndata: %d\n\n", n); err != nil {
				return err
			}
			flusher.Flush()
		}
		return nil
	}
	if err := send(); err != nil {
		return nil
	}
	timeout := time.After(30 * time.Minute) // browsers reconnect on their own
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-timeout:
			return nil
		case <-ch:
			if send() != nil {
				return nil
			}
		case <-poll.C:
			if send() != nil {
				return nil
			}
		case <-keepAlive.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return nil
			}
			flusher.Flush()
		}
	}
}

func (h *Notify) StreamNotifications(ctx context.Context, _ api.StreamNotificationsRequestObject) (api.StreamNotificationsResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	return sseStream{a: h.A, user: v.ID}, nil
}
