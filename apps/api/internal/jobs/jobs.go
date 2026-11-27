// Package jobs enqueues background work for cmd/worker.
package jobs

import (
	"context"
	"encoding/json"
	"time"

	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
)

const (
	NotePreview      = "note_preview"      // {"note_id"}
	TelegramNotify   = "telegram_notify"   // {"notification_id"} → bot delivers it
	RecomputeKarma   = "recompute_karma"   // {"user_id"}
	TelegramAutopost = "telegram_autopost" // {"link_id"} once a post crosses the threshold
	SyncRepos        = "sync_repos"        // {"user_id", "login"}
)

type Enqueuer interface {
	EnqueueJob(ctx context.Context, arg dbgen.EnqueueJobParams) error
}

// Enqueue schedules a job to run at or after runAt. Identical pending jobs are
// collapsed into one by a unique index.
func Enqueue(ctx context.Context, q Enqueuer, kind string, payload any, runAt time.Time) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return q.EnqueueJob(ctx, dbgen.EnqueueJobParams{Kind: kind, Payload: b, RunAt: runAt})
}
