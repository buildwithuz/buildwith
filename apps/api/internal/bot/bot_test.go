package bot

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/buildwithuz/buildwith/apps/api/internal/clock"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/ratelimit"
	"github.com/buildwithuz/buildwith/apps/api/internal/telegram"
	"github.com/buildwithuz/buildwith/apps/api/internal/testdb"
)

const (
	group  = int64(-100500)
	person = int64(4242)
)

type call struct {
	method          string
	chat, from, msg int64
	replyTo         int64
	text            string
}

// fakeTG records calls and hands out increasing message ids.
type fakeTG struct {
	calls   []call
	next    int64
	failFor map[int64]bool // chats a copy to fails (the person blocked the bot)
}

func (f *fakeTG) id() int64 { f.next++; return 1000 + f.next }

func (f *fakeTG) SendText(_ context.Context, chat int64, text string, replyTo int64) (int64, error) {
	f.calls = append(f.calls, call{method: "send", chat: chat, text: text, replyTo: replyTo})
	return f.id(), nil
}

func (f *fakeTG) Copy(_ context.Context, to, from, msg, replyTo int64) (int64, error) {
	if f.failFor[to] {
		return 0, errors.New("Forbidden: bot was blocked by the user")
	}
	f.calls = append(f.calls, call{method: "copy", chat: to, from: from, msg: msg, replyTo: replyTo})
	return f.id(), nil
}

func (f *fakeTG) React(_ context.Context, chat, msg int64, emoji string) error {
	f.calls = append(f.calls, call{method: "react", chat: chat, msg: msg, text: emoji})
	return nil
}

func (f *fakeTG) find(method string, chat int64) []call {
	var out []call
	for _, c := range f.calls {
		if c.method == method && c.chat == chat {
			out = append(out, c)
		}
	}
	return out
}

func setup(t *testing.T, support int64) (*Bot, *fakeTG, *dbgen.Queries) {
	pool := testdb.Pool(t)
	q := dbgen.New(pool)
	tg := &fakeTG{failFor: map[int64]bool{}}
	return &Bot{TG: tg, Q: q, Limiter: ratelimit.New(q, clock.System()), SupportChat: support}, tg, q
}

func private(id int64, text string) telegram.Update {
	return telegram.Update{Message: &telegram.Message{
		ID: id, Text: text, Chat: telegram.Chat{ID: person, Type: "private"},
		From: &telegram.User{ID: person, FirstName: "Nodira", Username: "nodira_tg", LanguageCode: "en"},
	}}
}

func inGroup(id int64, text string, replyTo int64) telegram.Update {
	m := &telegram.Message{ID: id, Text: text, Chat: telegram.Chat{ID: group, Type: "supergroup"},
		From: &telegram.User{ID: 7, FirstName: "Aziz"}}
	if replyTo != 0 {
		m.ReplyTo = &telegram.Message{ID: replyTo}
	}
	return telegram.Update{Message: m}
}

func TestSupportRoundTrip(t *testing.T) {
	b, tg, _ := setup(t, group)
	ctx := context.Background()

	b.Handle(ctx, private(11, "Profil rasmim yuklanmayapti"))

	headers := tg.find("send", group)
	copies := tg.find("copy", group)
	if len(headers) != 1 || len(copies) != 1 {
		t.Fatalf("want a header and a copy in the group, got %+v", tg.calls)
	}
	if !strings.Contains(headers[0].text, "@nodira_tg") || !strings.Contains(headers[0].text, "tg:4242") {
		t.Fatalf("header should say who wrote it: %q", headers[0].text)
	}
	if copies[0].from != person || copies[0].msg != 11 {
		t.Fatalf("copy should take the original message (keeps photos and files): %+v", copies[0])
	}
	if r := tg.find("react", person); len(r) != 1 || r[0].text != "👀" {
		t.Fatalf("the person should see that the team has it: %+v", tg.calls)
	}

	// A maintainer replies to the copied message; the reply reaches the person.
	copiedID := int64(1002)
	b.Handle(ctx, inGroup(50, "Rasm 5 MB dan kichik boʻlsin", copiedID))
	back := tg.find("copy", person)
	if len(back) != 1 || back[0].from != group || back[0].msg != 50 {
		t.Fatalf("reply should be copied back to the person: %+v", tg.calls)
	}
	if r := tg.find("react", group); len(r) != 1 || r[0].text != "👍" {
		t.Fatalf("the maintainer should see it was delivered: %+v", tg.calls)
	}

	// Replying to the header works too.
	b.Handle(ctx, inGroup(51, "Yana bir narsa", 1001))
	if got := len(tg.find("copy", person)); got != 2 {
		t.Fatalf("reply to the header should also be delivered, got %d copies", got)
	}
}

func TestTeamChatterStaysInTheGroup(t *testing.T) {
	b, tg, _ := setup(t, group)
	ctx := context.Background()
	b.Handle(ctx, inGroup(60, "Kim bugun navbatchi?", 0))
	b.Handle(ctx, inGroup(61, "Men", 60)) // a reply, but not to a support message
	if len(tg.calls) != 0 {
		t.Fatalf("nothing should leave the group: %+v", tg.calls)
	}
}

func TestUndeliveredReplyIsReported(t *testing.T) {
	b, tg, _ := setup(t, group)
	ctx := context.Background()
	b.Handle(ctx, private(11, "salom"))
	tg.failFor[person] = true
	b.Handle(ctx, inGroup(50, "javob", 1002))
	warn := tg.find("send", group)
	if len(warn) != 2 || !strings.Contains(warn[1].text, "⚠️") || warn[1].replyTo != 50 {
		t.Fatalf("the team should hear the reply wasn't delivered: %+v", tg.calls)
	}
}

func TestSupportWithoutAGroupPointsElsewhere(t *testing.T) {
	b, tg, _ := setup(t, 0)
	b.Handle(context.Background(), private(11, "salom"))
	msgs := tg.find("send", person)
	if len(msgs) != 1 || !strings.Contains(msgs[0].text, "github.com/buildwithuz/buildwith/discussions") {
		t.Fatalf("without a support group, point to Discussions: %+v", tg.calls)
	}
}

func TestSupportIsRateLimited(t *testing.T) {
	b, tg, _ := setup(t, group)
	ctx := context.Background()
	for i := range SupportMessages.Limit + 1 {
		b.Handle(ctx, private(int64(100+i), "spam"))
	}
	if got := len(tg.find("copy", group)); got != SupportMessages.Limit {
		t.Fatalf("want %d messages through, got %d", SupportMessages.Limit, got)
	}
	last := tg.find("send", person)
	if len(last) != 1 {
		t.Fatalf("the person should be told to slow down once: %+v", last)
	}
}

func TestStartLinksAndStopForgets(t *testing.T) {
	b, tg, q := setup(t, group)
	ctx := context.Background()

	// Not signed in with Telegram: a welcome that explains support and sign-in.
	b.Handle(ctx, private(1, "/start"))
	if m := tg.find("send", person); len(m) != 1 || !strings.Contains(m[0].text, "support bot") {
		t.Fatalf("unknown user welcome: %+v", m)
	}

	u, err := q.CreateUser(ctx, dbgen.CreateUserParams{Username: "nodira", Lang: "en"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := q.CreateIdentity(ctx, dbgen.CreateIdentityParams{UserID: u.ID, Provider: "telegram", Subject: "4242"}); err != nil {
		t.Fatal(err)
	}
	b.Handle(ctx, private(2, "/start"))
	link, err := q.GetTelegramByUser(ctx, u.ID)
	if err != nil || link.ChatID != person || !link.Notify {
		t.Fatalf("start should link the chat: %+v %v", link, err)
	}

	// A linked person's support message names their profile for the team.
	b.Handle(ctx, private(3, "savol"))
	if h := tg.find("send", group); len(h) != 1 || !strings.Contains(h[0].text, "buildwith.uz/@nodira") {
		t.Fatalf("header should link the profile: %+v", h)
	}

	b.Handle(ctx, private(4, "/stop"))
	if _, err := q.GetTelegramByUser(ctx, u.ID); err == nil {
		t.Fatal("/stop must delete the chat id")
	}
}

func TestBotsAndOtherChatsAreIgnored(t *testing.T) {
	b, tg, _ := setup(t, group)
	u := private(1, "hi")
	u.Message.From.IsBot = true
	b.Handle(context.Background(), u)
	other := private(2, "hi")
	other.Message.Chat = telegram.Chat{ID: -42, Type: "group"}
	b.Handle(context.Background(), other)
	if len(tg.calls) != 0 {
		t.Fatalf("want no calls, got %+v", tg.calls)
	}
}

func TestIDCommandHelpsSetUpTheGroup(t *testing.T) {
	b, tg, _ := setup(t, 0)
	u := inGroup(1, "/id@buildwith_bot", 0)
	b.Handle(context.Background(), u)
	got := tg.find("send", group)
	if len(got) != 1 || got[0].text != "-100500" {
		t.Fatalf("want the group id, got %+v", tg.calls)
	}
}

func TestCommand(t *testing.T) {
	for in, want := range map[string]string{
		"/start": "/start", "/start payload": "/start", "/help@buildwith_bot": "/help", "salom": "", "": "",
	} {
		if got := command(in); got != want {
			t.Errorf("command(%q) = %q, want %q", in, got, want)
		}
	}
}
