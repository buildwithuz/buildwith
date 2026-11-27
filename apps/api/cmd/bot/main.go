// Command bot is the Telegram bot: /start links the chat to the buildwith.uz
// account that signed in with this Telegram user, /stop silences it.
// Notifications themselves are sent by the worker.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/config"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/fetch"
	"github.com/buildwithuz/buildwith/apps/api/internal/i18n"
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

	slog.Info("bot polling")
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
			if u.Message == nil || u.Message.Chat.Type != "private" {
				continue
			}
			reply := handle(ctx, q, u)
			if err := tg.Send(ctx, u.Message.Chat.ID, reply, "", ""); err != nil {
				slog.Warn("sendMessage", "err", err)
			}
		}
	}
	return nil
}

func lang(code string) string {
	switch {
	case strings.HasPrefix(code, "ru"):
		return "ru"
	case strings.HasPrefix(code, "en"):
		return "en"
	}
	return "uz"
}

func handle(ctx context.Context, q *dbgen.Queries, u telegram.Update) string {
	m := u.Message
	l := lang(m.From.LanguageCode)
	cmd := strings.Fields(m.Text + " ")[0]
	switch cmd {
	case "/start":
		user, err := q.GetUserByIdentity(ctx, dbgen.GetUserByIdentityParams{
			Provider: "telegram", Subject: strconv.FormatInt(m.From.ID, 10)})
		if err != nil {
			return i18n.T(l, "bot.start_unknown", nil)
		}
		if _, err := q.LinkTelegram(ctx, dbgen.LinkTelegramParams{UserID: user.ID, ChatID: m.Chat.ID, Handle: m.From.Username}); err != nil {
			slog.Error("link telegram", "err", err)
			return i18n.T(user.Lang, "bot.start_unknown", nil)
		}
		_ = q.SetTelegramNotify(ctx, dbgen.SetTelegramNotifyParams{UserID: user.ID, Notify: true})
		return i18n.T(user.Lang, "bot.start_linked", nil)
	case "/stop":
		if t, err := q.GetTelegramByChat(ctx, m.Chat.ID); err == nil {
			_ = q.SetTelegramNotify(ctx, dbgen.SetTelegramNotifyParams{UserID: t.UserID, Notify: false})
		}
		return i18n.T(l, "bot.stopped", nil)
	}
	return i18n.T(l, "bot.help", nil)
}
