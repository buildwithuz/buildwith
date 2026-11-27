// Command seed fills a development database with a small, believable community.
// It refuses to run against a database that already has users, and in production.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/markdown"
	"github.com/buildwithuz/buildwith/apps/api/internal/rank"
	"github.com/buildwithuz/buildwith/apps/api/internal/slug"
	"github.com/buildwithuz/buildwith/apps/api/internal/urlx"
)

type person struct {
	username, name, role, company, city, bio string
	karma                                    int32
	mod, openToWork                          bool
	stack                                    []string
}

var people = []person{
	{"aziz", "Aziz Karimov", "Backend engineer", "Uzum", "Toshkent", "Go, Postgres va kechki choy.", 420, false, false, []string{"Go", "PostgreSQL", "Kafka"}},
	{"malika", "Malika Yusupova", "Frontend engineer", "EPAM", "Samarqand", "Interfeyslar va ochiq kod haqida yozaman.", 310, false, true, []string{"TypeScript", "React", "CSS"}},
	{"moderator", "Moderator", "Community moderator", "buildwith.uz", "Toshkent", "Qoidalar: /guidelines", 900, true, false, nil},
	{"jasur", "Jasur Tursunov", "SRE", "Payme", "Toshkent", "Kubernetes ishlamasa — men aybdorman.", 180, false, false, []string{"Kubernetes", "Terraform", "Go"}},
	{"dilnoza", "Dilnoza Rashidova", "ML engineer", "", "Remote", "Oʻzbek tili uchun NLP.", 260, false, true, []string{"Python", "PyTorch"}},
	{"bekzod", "Bekzod Aliyev", "Mobile developer", "Click", "Toshkent", "Flutter va Kotlin.", 75, false, false, []string{"Kotlin", "Flutter"}},
	{"nodira", "Nodira Ergasheva", "Student", "TUIT", "Toshkent", "Birinchi ishimni qidiryapman.", 12, false, true, []string{"Java", "SQL"}},
	{"sardor", "Sardor Qodirov", "CTO", "Startup", "Buxoro", "Kichik jamoa, katta orzular.", 150, false, false, []string{"Rust", "Go"}},
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "seed:", err)
		os.Exit(1)
	}
}

func run() error {
	if os.Getenv("BUILDWITH_ENV") == "production" {
		return fmt.Errorf("refusing to seed a production database")
	}
	url := os.Getenv("BUILDWITH_DATABASE_URL")
	if url == "" {
		return fmt.Errorf("BUILDWITH_DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := app.Connect(ctx, url)
	if err != nil {
		return err
	}
	defer pool.Close()

	var n int
	if err := pool.QueryRow(ctx, "select count(*) from users").Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		fmt.Println("seed: database already has users, nothing to do (use pnpm db:reset)")
		return nil
	}
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error { return seed(ctx, dbgen.New(tx), tx) })
}

func seed(ctx context.Context, q *dbgen.Queries, tx pgx.Tx) error {
	now := time.Now().UTC()
	ago := func(d time.Duration) time.Time { return now.Add(-d) }
	ids := map[string]int64{}

	for i, p := range people {
		u, err := q.CreateUser(ctx, dbgen.CreateUserParams{Username: p.username, DisplayName: p.name, Lang: "uz"})
		if err != nil {
			return err
		}
		ids[p.username] = u.ID
		readme := fmt.Sprintf("## Salom, men %s 👋\n\n%s\n\n- 🔭 %s\n- 📍 %s", p.name, p.bio, p.role, p.city)
		if _, err := q.UpdateProfile(ctx, dbgen.UpdateProfileParams{ID: u.ID, DisplayName: p.name, Bio: p.bio,
			RoleTitle: p.role, Company: p.company, Location: p.city, OpenToWork: p.openToWork,
			Accent: []string{"lapis", "turquoise", "saffron", "plum", "moss"}[i%5]}); err != nil {
			return err
		}
		if err := q.UpdateReadme(ctx, dbgen.UpdateReadmeParams{ID: u.ID, ReadmeMd: readme,
			ReadmeHtml: markdown.Render(readme, markdown.Options{Profile: markdown.Article}).HTML}); err != nil {
			return err
		}
		if _, err := q.CreateIdentity(ctx, dbgen.CreateIdentityParams{UserID: u.ID, Provider: "dev", Subject: p.username, Handle: p.username}); err != nil {
			return err
		}
		for j, s := range p.stack {
			if err := q.AddUserStack(ctx, dbgen.AddUserStackParams{UserID: u.ID, Name: s, Sort: int16(j)}); err != nil {
				return err
			}
		}
		if p.mod {
			if err := q.SetModerator(ctx, dbgen.SetModeratorParams{ID: u.ID, IsModerator: true}); err != nil {
				return err
			}
			_ = q.GrantBadge(ctx, dbgen.GrantBadgeParams{UserID: u.ID, Kind: "moderator"})
		}
		_ = q.GrantBadge(ctx, dbgen.GrantBadgeParams{UserID: u.ID, Kind: "early"})
		// Seeded accounts are a month old so new-account limits don't get in the way.
		if _, err := tx.Exec(ctx, "update users set created_at = $2, karma = $3 where id = $1", u.ID, ago(30*24*time.Hour), p.karma); err != nil {
			return err
		}
	}

	follow := func(a, b string) error {
		_, err := q.Follow(ctx, dbgen.FollowParams{FollowerID: ids[a], FolloweeID: ids[b]})
		return err
	}
	for _, pair := range [][2]string{{"aziz", "malika"}, {"aziz", "jasur"}, {"malika", "aziz"}, {"malika", "dilnoza"},
		{"jasur", "aziz"}, {"dilnoza", "malika"}, {"bekzod", "aziz"}, {"nodira", "aziz"}, {"nodira", "malika"},
		{"sardor", "jasur"}, {"sardor", "dilnoza"}} {
		if err := follow(pair[0], pair[1]); err != nil {
			return err
		}
	}

	tagIDs := map[string]int64{}
	tag := func(s string) (int64, error) {
		if id, ok := tagIDs[s]; ok {
			return id, nil
		}
		t, err := q.UpsertTag(ctx, dbgen.UpsertTagParams{Slug: s, Name: s})
		tagIDs[s] = t.ID
		return t.ID, err
	}

	type post struct {
		author, kind, title, url, body string
		tags                           []string
		age                            time.Duration
		voters                         []string
		answers                        [][2]string // author, body
	}
	posts := []post{
		{"aziz", "ask", "Go'da xatolarni qanday qayta ishlaysiz: errors.Join yoki oʻz turingiz?", "",
			"Katta servisda `errors.Join` ishlatib koʻrdim, lekin loglarda oʻqish qiyinlashdi. Sizda qanday?",
			[]string{"go"}, 3 * time.Hour, []string{"malika", "jasur", "sardor", "bekzod"},
			[][2]string{{"jasur", "Biz sentinel xatolar + `%w` bilan oʻrab chiqamiz. Loglarda `slog` atributlari yordam beradi."},
				{"sardor", "Oʻz turimiz bor: `type Error struct{Code, Op string; Err error}`. Monitoringda kod boʻyicha guruhlash oson."}}},
		{"malika", "link", "React Server Components: bir yillik tajriba", "https://example.com/rsc-one-year", "",
			[]string{"react", "frontend"}, 5 * time.Hour, []string{"aziz", "dilnoza", "nodira"}, nil},
		{"dilnoza", "show", "Koʻrsat: oʻzbek tili uchun ochiq tokenizer", "https://github.com/example/uz-tokenizer",
			"Lotin va kirill matnlarini bir xil tokenlarga ajratadi. Fikr-mulohazalaringizni kutaman!",
			[]string{"nlp", "python", "ochiq-kod"}, 9 * time.Hour, []string{"aziz", "malika", "sardor", "jasur", "bekzod"},
			[][2]string{{"aziz", "Zoʻr! Benchmarklar bormi?"}, {"dilnoza", "Ha, README da. Keyingi haftada yangilayman."}}},
		{"nodira", "ask", "Junior uchun birinchi ish: portfolio yoki LeetCode?", "",
			"Universitetni bitiryapman. Vaqtimni nimaga koʻproq sarflash kerak?",
			[]string{"karyera"}, 26 * time.Hour, []string{"aziz", "malika", "sardor"},
			[][2]string{{"malika", "Bitta jiddiy loyiha 50 ta masaladan yaxshiroq. README va testlar bilan."},
				{"sardor", "Biz yollaganda GitHub ni koʻramiz. Kichik, lekin tugallangan narsalar."},
				{"aziz", "Ikkalasi ham, lekin 70/30 loyiha foydasiga."}}},
		{"jasur", "link", "Postgres 17 da yangi nima bor", "https://www.postgresql.org/about/news/",
			"", []string{"postgresql"}, 30 * time.Hour, []string{"aziz", "sardor"}, nil},
		{"sardor", "text", "Toshkentda Go meetup: kim bor?", "",
			"Oyiga bir marta yigʻilishni taklif qilaman. Joy topsak boʻladi.", []string{"go", "meetup"}, 50 * time.Hour,
			[]string{"aziz", "jasur"}, [][2]string{{"jasur", "Men bor! Payme ofisida joy topishimiz mumkin."}}},
	}
	for _, p := range posts {
		arg := dbgen.CreateLinkParams{AuthorID: ids[p.author], Kind: p.kind, Title: p.title, Slug: slug.Make(p.title, 60)}
		if p.url != "" {
			c, err := urlx.Canonicalize(p.url)
			if err != nil {
				return err
			}
			arg.Url, arg.UrlCanonical, arg.UrlHash, arg.Domain = &c.URL, &c.Key, c.Hash, c.Domain
		}
		if p.body != "" {
			arg.BodyMd, arg.BodyHtml = p.body, markdown.Render(p.body, markdown.Options{Profile: markdown.Comment}).HTML
		}
		l, err := q.CreateLink(ctx, arg)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "update links set created_at = $2 where id = $1", l.ID, ago(p.age)); err != nil {
			return err
		}
		for _, t := range p.tags {
			id, err := tag(t)
			if err != nil {
				return err
			}
			if err := q.AddLinkTag(ctx, dbgen.AddLinkTagParams{LinkID: l.ID, TagID: id}); err != nil {
				return err
			}
		}
		for _, v := range p.voters {
			if err := q.CastVote(ctx, dbgen.CastVoteParams{SubjectType: "link", SubjectID: l.ID, UserID: ids[v], Value: 1}); err != nil {
				return err
			}
		}
		var parent *int64
		for i, a := range p.answers {
			c, err := q.CreateComment(ctx, dbgen.CreateCommentParams{SubjectType: "link", SubjectID: l.ID,
				AuthorID: ids[a[0]], ParentID: parent, BodyMd: a[1],
				BodyHtml: markdown.Render(a[1], markdown.Options{Profile: markdown.Comment}).HTML})
			if err != nil {
				return err
			}
			// In a two-comment discussion the second replies to the first; answers to a
			// question stay top level so they can be ranked against each other.
			if i == 0 && len(p.answers) == 2 && p.kind != "ask" {
				parent = &c.ID
			} else {
				parent = nil
			}
			if i == 0 && p.kind == "ask" {
				for _, v := range p.voters[:min(2, len(p.voters))] {
					if v != a[0] {
						_ = q.CastVote(ctx, dbgen.CastVoteParams{SubjectType: "comment", SubjectID: c.ID, UserID: ids[v], Value: 1})
					}
				}
			}
		}
		score := rank.Score(rank.Item{Points: 1 + len(p.voters), Comments: len(p.answers), Created: ago(p.age), DomainMultiplier: 1}, now)
		if err := q.SetLinkScore(ctx, dbgen.SetLinkScoreParams{ID: l.ID, Score: score}); err != nil {
			return err
		}
	}

	type note struct {
		author, body string
		age          time.Duration
		likers       []string
		code         [2]string
	}
	notesData := []note{
		{"malika", "Bugun birinchi marta `:has()` selektorini production da ishlatdim. JavaScript siz accordion 🎉", 40 * time.Minute, []string{"aziz", "nodira", "dilnoza"}, [2]string{}},
		{"aziz", "Kichik maslahat: Postgres da `FOR UPDATE SKIP LOCKED` bilan oddiy navbat Redis siz ham yaxshi ishlaydi.", 2 * time.Hour, []string{"jasur", "sardor", "malika", "bekzod"},
			[2]string{"sql", "update jobs set locked_at = now()\nwhere id in (\n  select id from jobs where locked_at is null\n  order by run_at limit 10\n  for update skip locked\n) returning *;"}},
		{"nodira", "Bugun 3-intervyu edi. Asabiylashdim, lekin oxirigacha yetdim. Natijani kutyapman 🤞", 3 * time.Hour, []string{"malika", "aziz", "sardor", "jasur", "dilnoza"}, [2]string{}},
		{"jasur", "Kecha soat 3 da alert keldi. Sabab: disk 100%. Loglar rotatsiyasi oʻchib qolgan ekan. Saboq: logrotate ni ham monitoring qiling.", 7 * time.Hour, []string{"aziz", "sardor"}, [2]string{}},
		{"dilnoza", "@malika tokenizer uchun demo sahifa qilib berasizmi? Men backend ni tayyorlayman 🙏", 8 * time.Hour, []string{"malika"}, [2]string{}},
		{"bekzod", "Flutter 4 ga oʻtdik. Build vaqti 40% qisqardi. #flutter", 20 * time.Hour, []string{"aziz"}, [2]string{}},
		{"sardor", "Startapda birinchi yil: eng katta xato — juda erta mikroservislar. Monolit bilan boshlang.", 28 * time.Hour, []string{"aziz", "jasur", "malika"}, [2]string{}},
	}
	for _, n := range notesData {
		arg := dbgen.CreateNoteParams{AuthorID: ids[n.author], BodyMd: n.body, ReplyPolicy: "everyone",
			BodyHtml: markdown.Render(n.body, markdown.Options{Profile: markdown.Note, NoFollow: false}).HTML}
		if n.code[1] != "" {
			arg.CodeLang, arg.CodeBody, arg.CodeHtml = n.code[0], n.code[1], markdown.Highlight(n.code[1], n.code[0])
		}
		created, err := q.CreateNote(ctx, arg)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "update notes set created_at = $2 where id = $1", created.ID, ago(n.age)); err != nil {
			return err
		}
		for _, l := range n.likers {
			if _, err := q.LikeNote(ctx, dbgen.LikeNoteParams{NoteID: created.ID, UserID: ids[l]}); err != nil {
				return err
			}
		}
		if n.author == "nodira" {
			for _, r := range [][2]string{{"malika", "Omad! Natija qanday boʻlishidan qatʼiy nazar — tajriba qoʻshildi 💪"},
				{"aziz", "Qaysi kompaniya? Savollar qanday edi?"}} {
				body := r[1]
				if _, err := q.CreateNote(ctx, dbgen.CreateNoteParams{AuthorID: ids[r[0]], BodyMd: body, ReplyPolicy: "everyone",
					BodyHtml:  markdown.Render(body, markdown.Options{Profile: markdown.Note}).HTML,
					ReplyToID: &created.ID, RootID: &created.ID}); err != nil {
					return err
				}
			}
		}
	}

	body := "## Nega Postgres navbati?\n\nKoʻp jamoalar birinchi kundan Redis yoki RabbitMQ qoʻshadi. " +
		"Kichik va oʻrta loyihalar uchun Postgres oʻzi yetarli.\n\n```sql\nselect * from jobs for update skip locked;\n```\n\n" +
		"## Qachon yetmaydi?\n\nSekundiga minglab vazifalar boʻlganda. Ungacha — bitta kamroq servis.\n\n" +
		"> [!TIP]\n> Avval oʻlchang, keyin murakkablashtiring."
	r := markdown.Render(body, markdown.Options{Profile: markdown.Article})
	toc, _ := json.Marshal(r.TOC)
	a, err := q.CreateArticle(ctx, dbgen.CreateArticleParams{AuthorID: ids["aziz"], Slug: "postgres-navbat", Title: "Postgres — sizning birinchi navbatingiz"})
	if err != nil {
		return err
	}
	if _, err := q.SaveArticleDraft(ctx, dbgen.SaveArticleDraftParams{ID: a.ID, Title: a.Title,
		Subtitle: "Redis qoʻshishdan oldin oʻylab koʻring", BodyMd: body, BodyHtml: r.HTML, Toc: toc, Lang: "uz",
		ReadingMinutes: int16(r.ReadingMinutes()), Slug: a.Slug}); err != nil {
		return err
	}
	if _, err := q.PublishArticle(ctx, a.ID); err != nil {
		return err
	}
	if id, err := tag("postgresql"); err == nil {
		_ = q.AddArticleTag(ctx, dbgen.AddArticleTagParams{ArticleID: a.ID, TagID: id})
	}
	_ = q.GrantBadge(ctx, dbgen.GrantBadgeParams{UserID: ids["aziz"], Kind: "author"})

	fmt.Printf("seed: %d users, %d posts, %d notes, 1 article\n", len(people), len(posts), len(notesData))
	return nil
}
