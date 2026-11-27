package server

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestHealth(t *testing.T) {
	e := newEnv(t)
	var h struct{ Status string }
	e.anon().do("GET", "/v1/health", nil, &h, 200)
	if h.Status != "ok" {
		t.Fatalf("status %q", h.Status)
	}
}

func TestMutationsNeedCSRFAndSession(t *testing.T) {
	e := newEnv(t)
	e.user("aziz", 10, false)

	c := e.anon()
	c.csrf = ""
	if code := c.code("POST", "/v1/auth/dev-login", map[string]string{"username": "aziz"}, 403); code != "forbidden" {
		t.Fatalf("missing CSRF: code %q", code)
	}
	c = e.anon()
	if code := c.code("POST", "/v1/notes", map[string]string{"body_md": "salom"}, 401); code != "unauthorized" {
		t.Fatalf("no session: code %q", code)
	}
	a := e.as("aziz")
	a.csrf = "wrong"
	a.code("POST", "/v1/notes", map[string]string{"body_md": "salom"}, 403)
}

func TestDevLoginOnlyInDevelopment(t *testing.T) {
	e := newEnv(t)
	e.user("aziz", 10, false)
	e.a.Cfg.Env = "production"
	c := e.anon()
	c.code("POST", "/v1/auth/dev-login", map[string]string{"username": "aziz"}, 403)
}

func TestNotes(t *testing.T) {
	e := newEnv(t)
	e.user("aziz", 10, false)
	e.user("malika", 10, false)
	a, m := e.as("aziz"), e.as("malika")

	var n noteItem
	a.do("POST", "/v1/notes", map[string]any{"body_md": "Bugun deploy qildik 🚀 @malika #go"}, &n, 201)
	if !strings.Contains(n.BodyHTML, `href="/@malika"`) || !strings.Contains(n.BodyHTML, `href="/t/go"`) {
		t.Fatalf("mentions/tags not linked: %s", n.BodyHTML)
	}
	if code := a.code("POST", "/v1/notes", map[string]any{"body_md": strings.Repeat("a", 501)}, 422); code != "invalid" {
		t.Fatalf("long note: %q", code)
	}
	a.code("POST", "/v1/notes", map[string]any{"body_md": "   "}, 422)

	var reply noteItem
	m.do("POST", "/v1/notes", map[string]any{"body_md": "Tabriklayman!", "reply_to_id": n.ID}, &reply, 201)

	var st struct {
		LikeCount int  `json:"like_count"`
		Liked     bool `json:"liked"`
	}
	m.do("POST", fmt.Sprintf("/v1/notes/%d/like", n.ID), nil, &st, 200)
	m.do("POST", fmt.Sprintf("/v1/notes/%d/like", n.ID), nil, &st, 200) // idempotent
	if st.LikeCount != 1 || !st.Liked {
		t.Fatalf("like state %+v", st)
	}

	var thread struct {
		Note    noteItem   `json:"note"`
		Replies []noteItem `json:"replies"`
	}
	e.anon().do("GET", fmt.Sprintf("/v1/notes/%d/thread", n.ID), nil, &thread, 200)
	if len(thread.Replies) != 1 || thread.Replies[0].ID != reply.ID {
		t.Fatalf("thread replies %+v", thread.Replies)
	}

	// Replies stay out of the main list.
	var list page[noteItem]
	e.anon().do("GET", "/v1/notes", nil, &list, 200)
	if len(list.Items) != 1 {
		t.Fatalf("want 1 top-level note, got %d", len(list.Items))
	}

	var notif page[struct{ Kind string }]
	a.do("GET", "/v1/notifications", nil, &notif, 200)
	kinds := map[string]bool{}
	for _, it := range notif.Items {
		kinds[it.Kind] = true
	}
	if !kinds["reply"] || !kinds["like"] {
		t.Fatalf("aziz notifications %+v", notif.Items)
	}
}

func TestReplyPolicy(t *testing.T) {
	e := newEnv(t)
	e.user("aziz", 10, false)
	e.user("malika", 10, false)
	var n noteItem
	e.as("aziz").do("POST", "/v1/notes", map[string]any{"body_md": "faqat doʻstlar", "reply_policy": "following"}, &n, 201)
	if code := e.as("malika").code("POST", "/v1/notes", map[string]any{"body_md": "salom", "reply_to_id": n.ID}, 403); code != "reply_not_allowed" {
		t.Fatalf("got %q", code)
	}
	e.as("aziz").do("POST", "/v1/users/malika/follow", nil, nil, 200)
	e.as("malika").do("POST", "/v1/notes", map[string]any{"body_md": "salom", "reply_to_id": n.ID}, nil, 201)
}

func TestSavolBestAnswerRisesAndVotingRules(t *testing.T) {
	e := newEnv(t)
	e.user("nodira", 5, false)
	e.user("aziz", 10, false)
	e.user("malika", 10, false)
	e.user("jasur", 150, false)

	var q linkItem
	e.as("nodira").do("POST", "/v1/links", map[string]any{
		"kind": "ask", "title": "Qaysi kovorking yaxshi?", "body_md": "Tez internet kerak.",
	}, &q, 201) // no tags: questions are low friction

	var first, second idOnly
	e.as("aziz").do("POST", "/v1/comments", map[string]any{"subject_type": "link", "subject_id": q.ID, "body_md": "Birinchi javob"}, &first, 201)
	e.as("malika").do("POST", "/v1/comments", map[string]any{"subject_type": "link", "subject_id": q.ID, "body_md": "Ikkinchi javob"}, &second, 201)
	e.as("jasur").do("POST", "/v1/comments", map[string]any{"subject_type": "link", "subject_id": q.ID, "parent_id": first.ID, "body_md": "+1"}, nil, 201)

	vote := func(who string, id int64, v int, want int) string {
		return e.as(who).code("PUT", "/v1/votes", map[string]any{"subject_type": "comment", "subject_id": id, "value": v}, want)
	}
	vote("jasur", second.ID, 1, 200)
	vote("nodira", second.ID, 1, 200)
	if c := vote("malika", second.ID, 1, 403); c != "forbidden" {
		t.Fatalf("self vote: %q", c)
	}
	if c := vote("nodira", first.ID, -1, 403); c != "karma_too_low" {
		t.Fatalf("low-karma downvote: %q", c)
	}
	vote("jasur", first.ID, -1, 200) // 150 karma may downvote
	if c := e.as("aziz").code("PUT", "/v1/votes", map[string]any{"subject_type": "link", "subject_id": q.ID, "value": -1}, 422); c != "invalid" {
		t.Fatalf("downvoting a post: %q", c)
	}

	var best page[commentItem]
	e.anon().do("GET", fmt.Sprintf("/v1/comments?subject_type=link&subject_id=%d", q.ID), nil, &best, 200)
	if len(best.Items) != 3 || best.Items[0].ID != second.ID || best.Items[0].Points != 3 {
		t.Fatalf("best-first order wrong: %+v", best.Items)
	}
	if best.Items[1].ID != first.ID || best.Items[2].Depth != 1 {
		t.Fatalf("reply must stay under its parent: %+v", best.Items)
	}

	var newest page[commentItem]
	e.anon().do("GET", fmt.Sprintf("/v1/comments?subject_type=link&subject_id=%d&sort=new", q.ID), nil, &newest, 200)
	if newest.Items[0].ID != first.ID {
		t.Fatalf("sort=new should keep posting order: %+v", newest.Items)
	}
}

func TestLinkRulesDedupeLimitsAndHolds(t *testing.T) {
	e := newEnv(t)
	e.user("aziz", 10, false)
	e.user("yangi", 0, true)
	a := e.as("aziz")

	var l linkItem
	a.do("POST", "/v1/links", map[string]any{"kind": "link", "title": "Postgres yangiliklari", "url": "https://www.postgresql.org/about/news/", "tags": []string{"PostgreSQL"}}, &l, 201)
	var dup struct {
		Error    struct{ Code string } `json:"error"`
		Existing linkItem              `json:"existing"`
	}
	a.do("POST", "/v1/links", map[string]any{"kind": "link", "title": "Yana", "url": "http://postgresql.org/about/news?utm_source=tg"}, &dup, 409)
	if dup.Error.Code != "duplicate_url" || dup.Existing.ID != l.ID {
		t.Fatalf("dedupe: %+v", dup)
	}
	a.code("POST", "/v1/links", map[string]any{"kind": "text", "title": "Matn", "url": "https://x.uz/"}, 422)
	a.code("POST", "/v1/links", map[string]any{"kind": "link", "title": "IP", "url": "http://127.0.0.1/admin"}, 422)

	// A brand-new account posting an unseen domain is held for a moderator.
	y := e.as("yangi")
	var held linkItem
	y.do("POST", "/v1/links", map[string]any{"kind": "link", "title": "Mening blogim", "url": "https://my-new-blog.uz/post"}, &held, 201)
	var top page[linkItem]
	e.anon().do("GET", "/v1/links?sort=new", nil, &top, 200)
	for _, it := range top.Items {
		if it.ID == held.ID {
			t.Fatal("held link is public")
		}
	}
	y.do("GET", fmt.Sprintf("/v1/links/%d", held.ID), nil, nil, 200) // its author still sees it
	e.anon().do("GET", fmt.Sprintf("/v1/links/%d", held.ID), nil, nil, 404)

	// ...and gets the new-account daily limit of two links.
	y.do("POST", "/v1/links", map[string]any{"kind": "ask", "title": "Savol bir"}, nil, 201)
	if c := y.code("POST", "/v1/links", map[string]any{"kind": "ask", "title": "Savol ikki"}, 429); c != "new_account_limit" {
		t.Fatalf("new account limit: %q", c)
	}
}

func TestBlocksAreMutualAndEnforcedEverywhere(t *testing.T) {
	e := newEnv(t)
	e.user("aziz", 10, false)
	e.user("malika", 10, false)
	a, m := e.as("aziz"), e.as("malika")

	var an noteItem
	a.do("POST", "/v1/notes", map[string]any{"body_md": "aziz note"}, &an, 201)
	m.do("POST", "/v1/notes", map[string]any{"body_md": "malika note"}, nil, 201)
	var post linkItem
	a.do("POST", "/v1/links", map[string]any{"kind": "ask", "title": "aziz savoli"}, &post, 201)
	m.do("POST", "/v1/users/aziz/follow", nil, nil, 200)

	m.do("POST", "/v1/users/aziz/block", nil, nil, 200)

	var notes page[noteItem]
	m.do("GET", "/v1/notes", nil, &notes, 200)
	if authors(notes.Items)["aziz"] != 0 {
		t.Fatal("blocker still sees blocked user's notes")
	}
	a.do("GET", "/v1/notes", nil, &notes, 200)
	if authors(notes.Items)["malika"] != 0 {
		t.Fatal("blocked user still sees blocker's notes")
	}
	var links page[linkItem]
	m.do("GET", "/v1/links?sort=new", nil, &links, 200)
	if authors(links.Items)["aziz"] != 0 {
		t.Fatal("blocked user's posts are listed")
	}
	m.do("GET", fmt.Sprintf("/v1/links/%d", post.ID), nil, nil, 404)

	for _, c := range []struct{ method, path string }{
		{"POST", fmt.Sprintf("/v1/notes/%d/like", an.ID)},
		{"POST", "/v1/users/aziz/follow"},
	} {
		if code := m.code(c.method, c.path, nil, 403); code != "blocked" {
			t.Errorf("%s %s: %q", c.method, c.path, code)
		}
	}
	if code := m.code("POST", "/v1/notes", map[string]any{"body_md": "x", "reply_to_id": an.ID}, 403); code != "blocked" {
		t.Errorf("reply across block: %q", code)
	}
	if code := m.code("POST", "/v1/comments", map[string]any{"subject_type": "link", "subject_id": post.ID, "body_md": "x"}, 403); code != "blocked" {
		t.Errorf("comment across block: %q", code)
	}

	var timeline page[struct {
		Note *noteItem `json:"note"`
		Link *linkItem `json:"link"`
	}]
	m.do("GET", "/v1/timeline", nil, &timeline, 200)
	for _, it := range timeline.Items {
		if (it.Note != nil && it.Note.Author.Username == "aziz") || (it.Link != nil && it.Link.Author.Username == "aziz") {
			t.Fatal("blocked user's items reached the timeline")
		}
	}
	var rel struct{ Following bool }
	m.do("DELETE", "/v1/users/aziz/block", nil, &rel, 200)
	if rel.Following {
		t.Fatal("a block must end the follow")
	}
}

func TestMutesAreOneWayAndMutedWordsFold(t *testing.T) {
	e := newEnv(t)
	e.user("aziz", 10, false)
	e.user("malika", 10, false)
	a, m := e.as("aziz"), e.as("malika")
	a.do("POST", "/v1/notes", map[string]any{"body_md": "aziz gapirdi"}, nil, 201)
	m.do("POST", "/v1/notes", map[string]any{"body_md": "kripto haqida"}, nil, 201)

	m.do("POST", "/v1/users/aziz/mute", nil, nil, 200)
	var notes page[noteItem]
	m.do("GET", "/v1/notes", nil, &notes, 200)
	if authors(notes.Items)["aziz"] != 0 {
		t.Fatal("muted user visible to muter")
	}
	a.do("GET", "/v1/notes", nil, &notes, 200)
	if authors(notes.Items)["malika"] != 1 {
		t.Fatal("mute must not hide the muter from the muted")
	}
	// The muted can still interact; mutes are silent.
	a.do("POST", "/v1/users/malika/follow", nil, nil, 200)

	a.do("POST", "/v1/me/muted-words", map[string]string{"word": "Kripto"}, nil, 204)
	a.do("GET", "/v1/notes", nil, &notes, 200)
	if authors(notes.Items)["malika"] != 0 {
		t.Fatal("muted word should hide the note")
	}
}

func TestModerationIsPublicAndGuarded(t *testing.T) {
	e := newEnv(t)
	e.user("aziz", 10, false)
	e.user("malika", 10, false)
	e.mod("mod")
	var q linkItem
	e.as("aziz").do("POST", "/v1/links", map[string]any{"kind": "ask", "title": "Savol"}, &q, 201)
	var c idOnly
	e.as("malika").do("POST", "/v1/comments", map[string]any{"subject_type": "link", "subject_id": q.ID, "body_md": "spam spam"}, &c, 201)

	kill := map[string]any{"subject_type": "comment", "subject_id": c.ID, "killed": true, "reason": "Spam"}
	e.as("aziz").code("POST", "/v1/mod/kill", kill, 403)
	e.as("mod").do("POST", "/v1/mod/kill", kill, nil, 204)

	var thread page[commentItem]
	e.anon().do("GET", fmt.Sprintf("/v1/comments?subject_type=link&subject_id=%d", q.ID), nil, &thread, 200)
	if len(thread.Items) != 1 || thread.Items[0].BodyHTML != "" {
		t.Fatalf("killed comment must keep its place but lose its words: %+v", thread.Items)
	}
	var log page[struct{ Action, Reason string }]
	e.anon().do("GET", "/v1/modlog", nil, &log, 200)
	if len(log.Items) != 1 || log.Items[0].Action != "kill" || log.Items[0].Reason != "Spam" {
		t.Fatalf("modlog %+v", log.Items)
	}
	e.as("mod").code("POST", "/v1/mod/kill", map[string]any{"subject_type": "comment", "subject_id": c.ID, "killed": false, "reason": "x"}, 422)
}

func TestSearchMatchesEverySpellingAndScript(t *testing.T) {
	e := newEnv(t)
	e.user("dilnoza", 10, false)
	e.as("dilnoza").do("POST", "/v1/links", map[string]any{"kind": "ask", "title": "Oʻzbek tili uchun tokenizer kerak"}, nil, 201)
	e.as("dilnoza").do("POST", "/v1/notes", map[string]any{"body_md": "Тошкентда митап бор"}, nil, 201)
	for _, q := range []string{"ozbek", "o'zbek", "oʻzbek", "ЎЗБЕК"} {
		var r struct{ Links []linkItem }
		e.anon().do("GET", "/v1/search?q="+urlQuery(q), nil, &r, 200)
		if len(r.Links) != 1 {
			t.Errorf("search %q: %d links", q, len(r.Links))
		}
	}
	var r struct{ Notes []noteItem }
	e.anon().do("GET", "/v1/search?q=toshkentda", nil, &r, 200)
	if len(r.Notes) != 1 {
		t.Errorf("Latin query should find Cyrillic note, got %d", len(r.Notes))
	}
}

func TestArticlesDraftsArePrivateUntilPublished(t *testing.T) {
	e := newEnv(t)
	e.user("aziz", 10, false)
	e.user("malika", 10, false)
	a := e.as("aziz")
	var art struct {
		ID   int64  `json:"id"`
		Slug string `json:"slug"`
		Path string `json:"path"`
	}
	a.do("POST", "/v1/articles", map[string]any{"title": "Postgres navbat"}, &art, 201)
	a.do("PUT", fmt.Sprintf("/v1/articles/%d", art.ID), map[string]any{
		"title": "Postgres navbat", "slug": "postgres-navbat", "body_md": "## Kirish\n\nMatn.", "tags": []string{"postgresql"},
	}, nil, 200)
	e.as("malika").do("GET", fmt.Sprintf("/v1/articles/%d", art.ID), nil, nil, 404)
	e.anon().do("GET", "/v1/articles/by-slug?author=aziz&slug=postgres-navbat", nil, nil, 404)

	var pub struct {
		Status string
		Toc    []struct{ ID string }
	}
	a.do("POST", fmt.Sprintf("/v1/articles/%d/publish", art.ID), map[string]any{}, &pub, 200)
	if pub.Status != "published" || len(pub.Toc) != 1 || pub.Toc[0].ID != "kirish" {
		t.Fatalf("publish: %+v", pub)
	}
	e.anon().do("GET", "/v1/articles/by-slug?author=aziz&slug=postgres-navbat", nil, nil, 200)

	var versions page[struct{ N int }]
	a.do("GET", fmt.Sprintf("/v1/articles/%d/versions", art.ID), nil, &versions, 200)
	if len(versions.Items) != 1 {
		t.Fatalf("versions %+v", versions.Items)
	}
	e.as("malika").do("GET", fmt.Sprintf("/v1/articles/%d/versions", art.ID), nil, nil, 403)
}

func TestDeleteAccountAnonymizes(t *testing.T) {
	e := newEnv(t)
	u := e.user("aziz", 10, false)
	a := e.as("aziz")
	a.do("POST", "/v1/notes", map[string]any{"body_md": "xayr"}, nil, 201)
	a.do("DELETE", "/v1/users/me", nil, nil, 204)
	e.anon().do("GET", "/v1/users/aziz", nil, nil, 404)
	got, err := e.a.Q.GetUser(context.Background(), u.ID)
	if err == nil {
		t.Fatalf("deleted user still readable: %+v", got)
	}
	var n int
	_ = e.a.Pool.QueryRow(context.Background(), "select count(*) from sessions where user_id = $1", u.ID).Scan(&n)
	if n != 0 {
		t.Fatal("sessions survived deletion")
	}
	a.code("GET", "/v1/notifications", nil, 401)
}

func urlQuery(s string) string {
	return strings.NewReplacer(" ", "%20", "'", "%27").Replace(s)
}
