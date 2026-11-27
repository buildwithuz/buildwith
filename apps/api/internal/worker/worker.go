// Package worker runs background work: periodic tasks (ranking, scheduled
// articles, monthly threads, Telegram digests, cleanup) and the job queue.
package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/clock"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/i18n"
	"github.com/buildwithuz/buildwith/apps/api/internal/jobs"
	"github.com/buildwithuz/buildwith/apps/api/internal/markdown"
	"github.com/buildwithuz/buildwith/apps/api/internal/media"
	"github.com/buildwithuz/buildwith/apps/api/internal/notify"
	"github.com/buildwithuz/buildwith/apps/api/internal/rank"
	"github.com/buildwithuz/buildwith/apps/api/internal/slug"
	"github.com/buildwithuz/buildwith/apps/api/internal/telegram"
	"github.com/buildwithuz/buildwith/apps/api/internal/urlx"
)

const (
	AutopostPoints = 15
	maxAttempts    = 6
)

type Worker struct {
	A    *app.App
	TG   *telegram.Client // nil when no bot token is configured
	name string
}

func New(a *app.App) *Worker {
	host, _ := os.Hostname()
	w := &Worker{A: a, name: fmt.Sprintf("%s:%d", host, os.Getpid())}
	if a.Cfg.Telegram.Configured() {
		w.TG = telegram.New(a.Cfg.Telegram.BotToken, a.Fetch)
	}
	return w
}

// Run blocks until ctx is cancelled.
func (w *Worker) Run(ctx context.Context) {
	every := func(d time.Duration, name string, f func(context.Context) error) {
		go func() {
			t := time.NewTicker(d)
			defer t.Stop()
			for {
				if err := f(ctx); err != nil && ctx.Err() == nil {
					slog.Error("periodic task failed", "task", name, "err", err)
				}
				select {
				case <-ctx.Done():
					return
				case <-t.C:
				}
			}
		}()
	}
	every(time.Minute, "rank", w.Rank)
	every(time.Minute, "scheduled_articles", w.PublishScheduled)
	every(time.Hour, "monthly_threads", w.MonthlyThreads)
	every(5*time.Minute, "telegram_channel", w.TelegramChannel)
	every(time.Hour, "cleanup", w.Cleanup)

	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for {
		n, err := w.DrainOnce(ctx)
		if err != nil && ctx.Err() == nil {
			slog.Error("job queue", "err", err)
		}
		if n > 0 {
			continue // more may be waiting
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// Rank recomputes scores for everything from the last week.
func (w *Worker) Rank(ctx context.Context) error {
	now := w.A.Clock.Now()
	links, err := w.A.Q.ListRankCandidates(ctx)
	if err != nil {
		return err
	}
	for _, l := range links {
		s := rank.Score(rank.Item{
			Points: int(l.Points), Comments: int(l.CommentCount), Flags: int(l.FlagCount), Created: l.CreatedAt,
			DomainMultiplier: l.DomainMultiplier, AuthorDomainPosts: int(l.AuthorDomainCount),
		}, now)
		if err := w.A.Q.SetLinkScore(ctx, dbgen.SetLinkScoreParams{ID: l.ID, Score: s}); err != nil {
			return err
		}
	}
	articles, err := w.A.Q.ListArticleScoreCandidates(ctx)
	if err != nil {
		return err
	}
	for _, a := range articles {
		if a.PublishedAt == nil {
			continue
		}
		s := rank.Score(rank.Item{
			Points: int(a.Points), Comments: int(a.CommentCount), Flags: int(a.FlagCount), Created: *a.PublishedAt,
			DomainMultiplier: 1, NewAuthorArticle: a.PublishedAt.Sub(a.AuthorCreated) < 7*24*time.Hour,
		}, now)
		if err := w.A.Q.SetArticleScore(ctx, dbgen.SetArticleScoreParams{ID: a.ID, Score: s}); err != nil {
			return err
		}
	}
	return nil
}

func (w *Worker) PublishScheduled(ctx context.Context) error {
	due, err := w.A.Q.ListDueScheduledArticles(ctx)
	if err != nil {
		return err
	}
	for _, a := range due {
		if _, err := w.A.Q.PublishDueArticle(ctx, a.ID); err != nil {
			return err
		}
		_ = w.A.Q.GrantBadge(ctx, dbgen.GrantBadgeParams{UserID: a.AuthorID, Kind: "author"})
	}
	return nil
}

var monthNames = map[string][]string{
	"uz": {"yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"},
}

// MonthlyThreads opens the four community threads on the first day of each
// month (Tashkent time). It is safe to run any number of times.
func (w *Worker) MonthlyThreads(ctx context.Context) error {
	now := w.A.Clock.Now().In(clock.Tashkent)
	author, err := w.A.Q.GetSystemAuthor(ctx)
	if err != nil {
		return nil // no moderator yet; nothing to post as
	}
	month := fmt.Sprintf("%s %d", monthNames["uz"][now.Month()-1], now.Year())
	for _, kind := range []string{"hiring", "looking", "freelance", "building"} {
		if _, err := w.A.Q.GetMonthlyThread(ctx, dbgen.GetMonthlyThreadParams{
			Kind: kind, Year: int16(now.Year()), Month: int16(now.Month())}); err == nil {
			continue
		}
		title := i18n.T("uz", "monthly."+kind, map[string]string{"month": month})
		body := i18n.T("uz", "monthly."+kind+"_body", nil)
		err := w.A.Tx(ctx, func(q *dbgen.Queries) error {
			l, err := q.CreateLink(ctx, dbgen.CreateLinkParams{AuthorID: author.ID, Kind: "ask", Title: title,
				Slug: slug.Make(title, 60), BodyMd: body,
				BodyHtml: markdown.Render(body, markdown.Options{Profile: markdown.Comment}).HTML})
			if err != nil {
				return err
			}
			tag, err := q.UpsertTag(ctx, dbgen.UpsertTagParams{Slug: "ishlar", Name: "ishlar"})
			if err != nil {
				return err
			}
			if err := q.AddLinkTag(ctx, dbgen.AddLinkTagParams{LinkID: l.ID, TagID: tag.ID}); err != nil {
				return err
			}
			return q.RegisterMonthlyThread(ctx, dbgen.RegisterMonthlyThreadParams{
				Kind: kind, Year: int16(now.Year()), Month: int16(now.Month()), LinkID: l.ID})
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// TelegramChannel posts strong links to the channel as they cross the
// threshold, and a top-10 digest every day at 20:00 Tashkent time.
func (w *Worker) TelegramChannel(ctx context.Context) error {
	if w.TG == nil || w.A.Cfg.Telegram.Channel == "" {
		return nil
	}
	ch := w.A.Cfg.Telegram.Channel
	origin := w.A.Cfg.PublicOrigin
	posts, err := w.A.Q.ListAutopostCandidates(ctx, AutopostPoints)
	if err != nil {
		return err
	}
	for _, p := range posts {
		n, err := w.A.Q.MarkTelegramPosted(ctx, dbgen.MarkTelegramPostedParams{SubjectType: "link", SubjectID: p.ID})
		if err != nil || n == 0 {
			continue
		}
		url := fmt.Sprintf("%s/l/%d/%s", origin, p.ID, p.Slug)
		text := i18n.T("uz", "bot.autopost", map[string]string{"title": p.Title, "points": fmt.Sprint(p.Points), "url": url})
		if err := w.TG.Send(ctx, ch, text, "", ""); err != nil {
			slog.Warn("telegram autopost", "err", err)
		}
	}

	now := w.A.Clock.Now().In(clock.Tashkent)
	if now.Hour() != 20 {
		return nil
	}
	day := int64(now.Year()*10000 + int(now.Month())*100 + now.Day())
	if n, err := w.A.Q.MarkTelegramPosted(ctx, dbgen.MarkTelegramPostedParams{SubjectType: "digest", SubjectID: day}); err != nil || n == 0 {
		return err
	}
	top, err := w.A.Q.ListTopLinksSince(ctx, dbgen.ListTopLinksSinceParams{Since: now.Add(-24 * time.Hour), PageLimit: 10})
	if err != nil || len(top) == 0 {
		return err
	}
	var b strings.Builder
	b.WriteString(i18n.T("uz", "bot.digest_title", nil) + "\n\n")
	for i, l := range top {
		fmt.Fprintf(&b, "%d. %s (%d)\n%s/l/%d/%s\n", i+1, l.Title, l.Points, origin, l.ID, l.Slug)
	}
	return w.TG.Send(ctx, ch, b.String(), "", "")
}

func (w *Worker) Cleanup(ctx context.Context) error {
	for _, f := range []func(context.Context) (int64, error){
		w.A.Q.DeleteExpiredSessions, w.A.Q.DeleteExpiredOAuthStates, w.A.Q.PruneRateCounters, w.A.Q.ReleaseStaleJobs,
	} {
		if _, err := f(ctx); err != nil {
			return err
		}
	}
	_, err := w.A.Q.DropExhaustedJobs(ctx, maxAttempts)
	return err
}

// DrainOnce claims and runs a batch of due jobs, returning how many it ran.
func (w *Worker) DrainOnce(ctx context.Context) (int, error) {
	batch, err := w.A.Q.ClaimJobs(ctx, dbgen.ClaimJobsParams{Worker: w.name, Batch: 20})
	if err != nil {
		return 0, err
	}
	for _, j := range batch {
		jctx, cancel := context.WithTimeout(ctx, time.Minute)
		err := w.handle(jctx, j)
		cancel()
		if err != nil {
			slog.Warn("job failed", "kind", j.Kind, "id", j.ID, "attempt", j.Attempts, "err", err)
			if ferr := w.A.Q.FailJob(ctx, dbgen.FailJobParams{ID: j.ID, LastError: err.Error()}); ferr != nil {
				return len(batch), ferr
			}
			continue
		}
		if err := w.A.Q.FinishJob(ctx, j.ID); err != nil {
			return len(batch), err
		}
	}
	return len(batch), nil
}

func (w *Worker) handle(ctx context.Context, j dbgen.Job) error {
	switch j.Kind {
	case jobs.RecomputeKarma:
		var p struct {
			UserID int64 `json:"user_id"`
		}
		if err := json.Unmarshal(j.Payload, &p); err != nil {
			return err
		}
		_, err := w.A.Q.RecomputeKarma(ctx, p.UserID)
		return err
	case jobs.NotePreview:
		return w.notePreview(ctx, j.Payload)
	case jobs.TelegramNotify:
		return w.telegramNotify(ctx, j.Payload)
	}
	slog.Warn("unknown job kind dropped", "kind", j.Kind)
	return nil
}

func (w *Worker) notePreview(ctx context.Context, payload []byte) error {
	var p struct {
		NoteID int64  `json:"note_id"`
		URL    string `json:"url"`
	}
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	c, err := urlx.Canonicalize(p.URL)
	if err != nil {
		return nil // not something we preview; done
	}
	page, err := w.A.Fetch.Preview(ctx, p.URL)
	if err != nil {
		return nil // the site is down or not HTML; a note without a card is fine
	}
	var mediaID *int64
	if page.Image != "" {
		if _, body, err := w.A.Fetch.Get(ctx, page.Image, "image/*"); err == nil {
			if img, err := media.Process(strings.NewReader(string(body)), media.Note); err == nil {
				if err := w.A.Media.Put(ctx, img.Name(), img.Data); err == nil {
					m, err := w.A.Q.CreateMedia(ctx, dbgen.CreateMediaParams{Sha256: img.SHA256, Kind: "note", Mime: img.Mime,
						Width: int32(img.Width), Height: int32(img.Height), Bytes: int32(len(img.Data))})
					if err == nil {
						mediaID = &m.ID
					}
				}
			}
		}
	}
	return w.A.Q.SetNotePreview(ctx, dbgen.SetNotePreviewParams{ID: p.NoteID, PreviewUrl: &p.URL,
		PreviewTitle: page.Title, PreviewDesc: page.Description, PreviewDomain: c.Domain, PreviewMedia: mediaID})
}

func (w *Worker) telegramNotify(ctx context.Context, payload []byte) error {
	if w.TG == nil {
		return nil
	}
	var p struct {
		UserID      int64  `json:"user_id"`
		Kind        string `json:"kind"`
		ActorID     int64  `json:"actor_id"`
		SubjectType string `json:"subject_type"`
		SubjectID   int64  `json:"subject_id"`
	}
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	rcpt, err := w.A.Q.ListTelegramRecipients(ctx, []int64{p.UserID})
	if err != nil || len(rcpt) == 0 {
		return err
	}
	actor := ""
	if u, err := w.A.Q.GetUser(ctx, p.ActorID); err == nil {
		actor = "@" + u.Username
	}
	href := notify.Href(dbgen.Notification{SubjectType: p.SubjectType, SubjectID: &p.SubjectID}, strings.TrimPrefix(actor, "@"))
	for _, r := range rcpt {
		text := i18n.T(r.Lang, "notify."+p.Kind, map[string]string{"actor": actor})
		if err := w.TG.Send(ctx, r.ChatID, text, i18n.T(r.Lang, "notify.open", nil), w.A.Cfg.PublicOrigin+href); err != nil {
			return err
		}
	}
	return nil
}
