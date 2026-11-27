package worker

import (
	"context"
	"testing"
	"time"

	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/clock"
	"github.com/buildwithuz/buildwith/apps/api/internal/config"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/jobs"
	"github.com/buildwithuz/buildwith/apps/api/internal/testdb"
)

func setup(t *testing.T) (*Worker, *dbgen.Queries, dbgen.User) {
	pool := testdb.Pool(t)
	a := app.New(config.Config{Env: "development", PublicOrigin: "http://localhost:5173", MediaDir: t.TempDir()}, pool, clock.System())
	u, err := a.Q.CreateUser(context.Background(), dbgen.CreateUserParams{Username: "aziz", DisplayName: "Aziz", Lang: "uz"})
	if err != nil {
		t.Fatal(err)
	}
	return New(a), a.Q, u
}

func TestRankWritesScores(t *testing.T) {
	w, q, u := setup(t)
	ctx := context.Background()
	strong, _ := q.CreateLink(ctx, dbgen.CreateLinkParams{AuthorID: u.ID, Kind: "ask", Title: "Kuchli savol", Slug: "a"})
	weak, _ := q.CreateLink(ctx, dbgen.CreateLinkParams{AuthorID: u.ID, Kind: "ask", Title: "Kuchsiz savol", Slug: "b"})
	for i := range 5 {
		v, _ := q.CreateUser(ctx, dbgen.CreateUserParams{Username: "voter" + string(rune('a'+i)), Lang: "uz"})
		_ = q.CastVote(ctx, dbgen.CastVoteParams{SubjectType: "link", SubjectID: strong.ID, UserID: v.ID, Value: 1})
	}
	if err := w.Rank(ctx); err != nil {
		t.Fatal(err)
	}
	s, _ := q.GetLink(ctx, strong.ID)
	k, _ := q.GetLink(ctx, weak.ID)
	if s.Link.Score <= 0 || s.Link.Score <= k.Link.Score {
		t.Fatalf("scores: strong %v weak %v", s.Link.Score, k.Link.Score)
	}
}

func TestScheduledArticlesGoLive(t *testing.T) {
	w, q, u := setup(t)
	ctx := context.Background()
	a, _ := q.CreateArticle(ctx, dbgen.CreateArticleParams{AuthorID: u.ID, Slug: "x", Title: "Rejalashtirilgan"})
	past := time.Now().Add(-time.Minute)
	if _, err := q.ScheduleArticle(ctx, dbgen.ScheduleArticleParams{ID: a.ID, ScheduledAt: &past}); err != nil {
		t.Fatal(err)
	}
	if err := w.PublishScheduled(ctx); err != nil {
		t.Fatal(err)
	}
	got, _ := q.GetArticle(ctx, a.ID)
	if got.Article.Status != "published" || got.Article.PublishedAt == nil {
		t.Fatalf("status %s", got.Article.Status)
	}
}

func TestMonthlyThreadsAreIdempotent(t *testing.T) {
	w, q, u := setup(t)
	ctx := context.Background()
	_ = q.SetModerator(ctx, dbgen.SetModeratorParams{ID: u.ID, IsModerator: true})
	for range 3 {
		if err := w.MonthlyThreads(ctx); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := q.ListLatestMonthlyThreads(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 4 {
		t.Fatalf("want 4 threads, got %d", len(rows))
	}
}

func TestQueueRunsAndRetries(t *testing.T) {
	w, q, u := setup(t)
	ctx := context.Background()
	if err := jobs.Enqueue(ctx, q, jobs.RecomputeKarma, map[string]int64{"user_id": u.ID}, time.Now()); err != nil {
		t.Fatal(err)
	}
	// Identical pending jobs collapse into one.
	_ = jobs.Enqueue(ctx, q, jobs.RecomputeKarma, map[string]int64{"user_id": u.ID}, time.Now())
	n, err := w.DrainOnce(ctx)
	if err != nil || n != 1 {
		t.Fatalf("drained %d, err %v", n, err)
	}
	if n, _ := w.DrainOnce(ctx); n != 0 {
		t.Fatalf("queue should be empty, ran %d", n)
	}

	// A failing job is rescheduled with backoff rather than lost.
	_ = jobs.Enqueue(ctx, q, jobs.RecomputeKarma, "not an object", time.Now())
	if _, err := w.DrainOnce(ctx); err != nil {
		t.Fatal(err)
	}
	var attempts int
	var runAt time.Time
	if err := w.A.Pool.QueryRow(ctx, "select attempts, run_at from jobs").Scan(&attempts, &runAt); err != nil {
		t.Fatal(err)
	}
	if attempts != 1 || !runAt.After(time.Now()) {
		t.Fatalf("attempts %d run_at %v", attempts, runAt)
	}
}
