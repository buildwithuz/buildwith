// Package app wires the dependencies every domain handler shares.
package app

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/buildwithuz/buildwith/apps/api/internal/clock"
	"github.com/buildwithuz/buildwith/apps/api/internal/config"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/fetch"
	"github.com/buildwithuz/buildwith/apps/api/internal/media"
	"github.com/buildwithuz/buildwith/apps/api/internal/ratelimit"
)

type App struct {
	Cfg     config.Config
	Pool    *pgxpool.Pool
	Q       *dbgen.Queries
	Clock   clock.Clock
	Limiter *ratelimit.Limiter
	Media   media.Store
	Fetch   *fetch.Client
	// Version is reported by /v1/health; set from the build.
	Version string
}

func New(cfg config.Config, pool *pgxpool.Pool, c clock.Clock) *App {
	q := dbgen.New(pool)
	return &App{
		Cfg:     cfg,
		Pool:    pool,
		Q:       q,
		Clock:   c,
		Limiter: ratelimit.New(q, c),
		Media:   media.DiskStore{Dir: cfg.MediaDir},
		Fetch:   fetch.New(fetch.Options{}),
		Version: "dev",
	}
}

// Connect opens the pool and checks the database answers.
func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("database url: %w", err)
	}
	cfg.MaxConns = 20
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("database: %w", err)
	}
	return pool, nil
}

// Tx runs fn in a transaction and commits if it returns nil.
func (a *App) Tx(ctx context.Context, fn func(q *dbgen.Queries) error) error {
	return pgx.BeginFunc(ctx, a.Pool, func(tx pgx.Tx) error { return fn(a.Q.WithTx(tx)) })
}
