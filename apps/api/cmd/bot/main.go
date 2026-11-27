// Command bot runs the buildwith.uz Telegram bot: account linking for
// notifications (which the worker sends) and the support inbox. See internal/bot.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/bot"
	"github.com/buildwithuz/buildwith/apps/api/internal/clock"
	"github.com/buildwithuz/buildwith/apps/api/internal/config"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/fetch"
	"github.com/buildwithuz/buildwith/apps/api/internal/ratelimit"
	"github.com/buildwithuz/buildwith/apps/api/internal/server"
	"github.com/buildwithuz/buildwith/apps/api/internal/telegram"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "bot:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	slog.SetDefault(server.Logger(!cfg.Development()))
	if !cfg.Telegram.Configured() {
		return errors.New("BUILDWITH_TELEGRAM_BOT_TOKEN is not set")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, err := app.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	q := dbgen.New(pool)
	// Long polling holds the request open for 25 s, so this client waits longer.
	tg := telegram.New(cfg.Telegram.BotToken, fetch.New(fetch.Options{Timeout: 40 * time.Second}))
	b := &bot.Bot{TG: tg, Q: q, Limiter: ratelimit.New(q, clock.System()), SupportChat: cfg.Telegram.SupportChat}

	slog.Info("bot polling", "support", cfg.Telegram.SupportChat != 0)
	var offset int64
	for ctx.Err() == nil {
		updates, err := tg.Updates(ctx, offset)
		if err != nil {
			if ctx.Err() == nil {
				slog.Warn("getUpdates", "err", err)
				time.Sleep(3 * time.Second)
			}
			continue
		}
		for _, u := range updates {
			offset = u.ID + 1
			b.Handle(ctx, u)
		}
	}
	return nil
}
