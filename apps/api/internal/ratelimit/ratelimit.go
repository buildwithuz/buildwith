// Package ratelimit enforces fixed-window limits stored in Postgres, so limits
// hold across restarts and across every process on the server.
package ratelimit

import (
	"context"
	"fmt"
	"time"

	"github.com/buildwithuz/buildwith/apps/api/internal/clock"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
)

type Limiter struct {
	q     dbgen.Querier
	clock clock.Clock
}

func New(q dbgen.Querier, c clock.Clock) *Limiter { return &Limiter{q: q, clock: c} }

// Rule is a limit on one action.
type Rule struct {
	Name   string
	Limit  int
	Window time.Duration
}

// Allow counts one use of rule for subject and reports whether it is within
// the limit, and if not, how many seconds until the window resets.
func (l *Limiter) Allow(ctx context.Context, rule Rule, subject string) (bool, int, error) {
	now := l.clock.Now()
	start := now.Truncate(rule.Window)
	n, err := l.q.BumpRateCounter(ctx, dbgen.BumpRateCounterParams{
		Key:         fmt.Sprintf("%s:%s", rule.Name, subject),
		WindowStart: start,
	})
	if err != nil {
		return false, 0, err
	}
	if int(n) > rule.Limit {
		return false, int(start.Add(rule.Window).Sub(now).Seconds()) + 1, nil
	}
	return true, 0, nil
}

const day = 24 * time.Hour

// NewAccountAge is how long an account counts as new.
const NewAccountAge = 7 * day

// Per-day limits. New accounts get the tight ones; see the community guidelines.
var (
	LinksNew     = Rule{"links:new", 2, day}
	Links        = Rule{"links", 20, day}
	NotesNew     = Rule{"notes:new", 20, day}
	Notes        = Rule{"notes", 300, day}
	ArticlesNew  = Rule{"articles:new", 1, day}
	Articles     = Rule{"articles", 10, day}
	CommentsNew  = Rule{"comments:new", 10, day}
	Comments     = Rule{"comments", 300, day}
	CommentBurst = Rule{"comments:burst", 5, time.Minute}
	Uploads      = Rule{"uploads", 60, day}
	Votes        = Rule{"votes", 600, time.Hour}
	Reports      = Rule{"reports", 30, day}
	SignIn       = Rule{"signin", 30, 10 * time.Minute}
	Previews     = Rule{"previews", 120, time.Minute}
)

// For picks the new-account rule when the account is younger than a week.
func For(created, now time.Time, normal, newAccount Rule) Rule {
	if now.Sub(created) < NewAccountAge {
		return newAccount
	}
	return normal
}
