// Package bot is the buildwith.uz Telegram bot. One bot does everything:
// /start links a chat for notifications (the worker sends them), and anything
// else written to it is a support message, copied into the maintainers'
// support group. A maintainer's reply there is copied back to the sender.
package bot

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/i18n"
	"github.com/buildwithuz/buildwith/apps/api/internal/ratelimit"
	"github.com/buildwithuz/buildwith/apps/api/internal/telegram"
)

// Telegram is the part of the Bot API the bot uses; tests substitute a fake.
type Telegram interface {
	SendText(ctx context.Context, chatID int64, text string, replyTo int64) (int64, error)
	Copy(ctx context.Context, toChat, fromChat, messageID, replyTo int64) (int64, error)
	React(ctx context.Context, chatID, messageID int64, emoji string) error
}

type Bot struct {
	TG Telegram
	Q  *dbgen.Queries
	// Limiter keeps one chat from flooding the support group.
	Limiter *ratelimit.Limiter
	// SupportChat is the maintainers' group; 0 means support is not set up.
	SupportChat int64
}

// SupportMessages limits what one person can send to the team.
var SupportMessages = ratelimit.Rule{Name: "support", Limit: 20, Window: time.Hour}

func lang(code string) string {
	switch {
	case strings.HasPrefix(code, "ru"):
		return "ru"
	case strings.HasPrefix(code, "en"):
		return "en"
	}
	return "uz"
}

// Handle processes one update. Errors are logged, not returned: one bad
// message must never stop the polling loop.
func (b *Bot) Handle(ctx context.Context, u telegram.Update) {
	m := u.Message
	if m == nil || m.From == nil || m.From.IsBot {
		return
	}
	switch {
	case m.Chat.Type != "private" && command(m.Text) == "/id":
		// Setting up the support group: the operator needs its id for the config.
		b.say(ctx, m.Chat.ID, strconv.FormatInt(m.Chat.ID, 10))
	case b.SupportChat != 0 && m.Chat.ID == b.SupportChat:
		b.fromTeam(ctx, m)
	case m.Chat.Type == "private":
		b.fromPerson(ctx, m)
	}
}

// command returns the bot command a message starts with, without any
// "@botname" suffix Telegram adds in groups: "/id@buildwith_bot x" → "/id".
func command(text string) string {
	if !strings.HasPrefix(text, "/") {
		return ""
	}
	c := strings.Fields(text)[0]
	if i := strings.IndexByte(c, '@'); i > 0 {
		c = c[:i]
	}
	return c
}

func (b *Bot) say(ctx context.Context, chat int64, text string) {
	if _, err := b.TG.SendText(ctx, chat, text, 0); err != nil {
		slog.WarnContext(ctx, "telegram send", "err", err)
	}
}

// account is the buildwith.uz user behind a Telegram user, if they signed in with Telegram.
func (b *Bot) account(ctx context.Context, tg *telegram.User) (*dbgen.User, bool) {
	u, err := b.Q.GetUserByIdentity(ctx, dbgen.GetUserByIdentityParams{
		Provider: "telegram", Subject: strconv.FormatInt(tg.ID, 10),
	})
	if err != nil {
		return nil, false
	}
	return &u, true
}

func (b *Bot) fromPerson(ctx context.Context, m *telegram.Message) {
	user, linked := b.account(ctx, m.From)
	l := lang(m.From.LanguageCode)
	if linked {
		l = user.Lang
	}
	switch command(m.Text) {
	case "/start":
		if !linked {
			b.say(ctx, m.Chat.ID, i18n.T(l, "bot.start_unknown", nil))
			return
		}
		if _, err := b.Q.LinkTelegram(ctx, dbgen.LinkTelegramParams{UserID: user.ID, ChatID: m.Chat.ID, Handle: m.From.Username}); err != nil {
			slog.ErrorContext(ctx, "link telegram", "err", err)
			b.say(ctx, m.Chat.ID, i18n.T(l, "bot.start_unknown", nil))
			return
		}
		_ = b.Q.SetTelegramNotify(ctx, dbgen.SetTelegramNotifyParams{UserID: user.ID, Notify: true})
		b.say(ctx, m.Chat.ID, i18n.T(l, "bot.start_linked", nil))
	case "/stop":
		// Forget the chat entirely, as the privacy page promises; /start links it again.
		if t, err := b.Q.GetTelegramByChat(ctx, m.Chat.ID); err == nil {
			_, _ = b.Q.UnlinkTelegram(ctx, t.UserID)
		}
		b.say(ctx, m.Chat.ID, i18n.T(l, "bot.stopped", nil))
	case "/help":
		b.say(ctx, m.Chat.ID, i18n.T(l, "bot.help", nil))
	default:
		if strings.HasPrefix(m.Text, "/") {
			b.say(ctx, m.Chat.ID, i18n.T(l, "bot.help", nil))
			return
		}
		b.toTeam(ctx, m, user, l)
	}
}

// toTeam copies a person's message into the support group, under a header that
// says who wrote it, and remembers both so a reply to either finds its way back.
func (b *Bot) toTeam(ctx context.Context, m *telegram.Message, user *dbgen.User, l string) {
	if b.SupportChat == 0 {
		b.say(ctx, m.Chat.ID, i18n.T(l, "bot.support_off", nil))
		return
	}
	ok, _, err := b.Limiter.Allow(ctx, SupportMessages, strconv.FormatInt(m.Chat.ID, 10))
	if err != nil {
		slog.ErrorContext(ctx, "support rate limit", "err", err)
		return
	}
	if !ok {
		b.say(ctx, m.Chat.ID, i18n.T(l, "bot.support_slow", nil))
		return
	}
	var userID *int64
	if user != nil {
		userID = &user.ID
	}
	header, err := b.TG.SendText(ctx, b.SupportChat, i18n.T("uz", "bot.support_header", map[string]string{"who": who(m.From, user)}), 0)
	if err != nil {
		slog.ErrorContext(ctx, "support header", "err", err)
		return
	}
	copied, err := b.TG.Copy(ctx, b.SupportChat, m.Chat.ID, m.ID, header)
	if err != nil {
		slog.ErrorContext(ctx, "support copy", "err", err)
		return
	}
	for _, id := range []int64{header, copied} {
		if err := b.Q.RecordSupportMessage(ctx, dbgen.RecordSupportMessageParams{
			GroupMessageID: id, UserChatID: m.Chat.ID, UserID: userID,
		}); err != nil {
			slog.ErrorContext(ctx, "support record", "err", err)
		}
	}
	// 👀 on their message: the team has it.
	if err := b.TG.React(ctx, m.Chat.ID, m.ID, "👀"); err != nil {
		slog.WarnContext(ctx, "support react", "err", err)
	}
}

// fromTeam relays a maintainer's reply back to the person it answers.
func (b *Bot) fromTeam(ctx context.Context, m *telegram.Message) {
	if c := command(m.Text); c == "/help" || c == "/start" {
		b.say(ctx, m.Chat.ID, i18n.T("uz", "bot.group_help", nil))
		return
	}
	if m.ReplyTo == nil {
		return // maintainers talking among themselves
	}
	to, err := b.Q.SupportSender(ctx, m.ReplyTo.ID)
	if err != nil {
		return // a reply to something that isn't a support message
	}
	if _, err := b.TG.Copy(ctx, to, m.Chat.ID, m.ID, 0); err != nil {
		slog.WarnContext(ctx, "support reply undelivered", "err", err)
		if _, err := b.TG.SendText(ctx, m.Chat.ID, i18n.T("uz", "bot.support_undelivered", nil), m.ID); err != nil {
			slog.WarnContext(ctx, "telegram send", "err", err)
		}
		return
	}
	if err := b.TG.React(ctx, m.Chat.ID, m.ID, "👍"); err != nil {
		slog.WarnContext(ctx, "support react", "err", err)
	}
}

// who describes a sender for the maintainers: name, Telegram handle and, when
// they signed in with Telegram, their buildwith.uz profile.
func who(tg *telegram.User, user *dbgen.User) string {
	parts := []string{strings.TrimSpace(tg.FirstName + " " + tg.LastName)}
	if tg.Username != "" {
		parts = append(parts, "@"+tg.Username)
	}
	if user != nil {
		parts = append(parts, fmt.Sprintf("buildwith.uz/@%s", user.Username))
	}
	parts = append(parts, fmt.Sprintf("tg:%d", tg.ID))
	out := parts[:0]
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, " · ")
}
