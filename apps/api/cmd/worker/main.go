// Command worker runs ranking, scheduled publishing, monthly threads, Telegram
// delivery and the background job queue.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/clock"
	"github.com/buildwithuz/buildwith/apps/api/internal/config"
	"github.com/buildwithuz/buildwith/apps/api/internal/server"
	"github.com/buildwithuz/buildwith/apps/api/internal/worker"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "worker:", err)
		os.Exit(1)
	}
	slog.SetDefault(server.Logger(!cfg.Development()))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, err := app.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		fmt.Fprintln(os.Stderr, "worker:", err)
		os.Exit(1)
	}
	defer pool.Close()
	slog.Info("worker started", "telegram", cfg.Telegram.Configured())
	worker.New(app.New(cfg, pool, clock.System())).Run(ctx)
	slog.Info("worker stopped")
}
