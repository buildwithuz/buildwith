// Package present turns database rows into API objects. Every function works on
// a batch and loads related data (badges, tags, media, the viewer's votes) with
// one query per kind, so list endpoints never issue a query per row.
package present

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/buildwithuz/buildwith/apps/api/internal/api"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/media"
)

// P presents rows for one viewer (nil when signed out).
type P struct {
	Q      *dbgen.Queries
	Viewer *dbgen.User
}

func New(q *dbgen.Queries, viewer *dbgen.User) *P { return &P{Q: q, Viewer: viewer} }

func (p *P) viewerPtr() *int64 {
	if p.Viewer == nil {
		return nil
	}
	return &p.Viewer.ID
}

func (p *P) isViewer(id int64) bool { return p.Viewer != nil && p.Viewer.ID == id }

func (p *P) isMod() bool { return p.Viewer != nil && (p.Viewer.IsModerator || p.Viewer.IsAdmin) }

// MediaURL is the public path of a stored file; Caddy serves /media/ directly.
func MediaURL(m dbgen.Media) string {
	return "/media/" + media.NameFor(m.Sha256, media.ExtFor(m.Mime))
}

func Media(m dbgen.Media) api.Media {
	return api.Media{Id: m.ID, Url: MediaURL(m), Width: int(m.Width), Height: int(m.Height), Mime: m.Mime}
}

func (p *P) mediaByID(ctx context.Context, ids []int64) (map[int64]dbgen.Media, error) {
	out := map[int64]dbgen.Media{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := p.Q.ListMediaByIDs(ctx, uniq(ids))
	if err != nil {
		return nil, err
	}
	for _, m := range rows {
		out[m.ID] = m
	}
	return out, nil
}

// Users presents a batch of users, keyed by id.
func (p *P) Users(ctx context.Context, users []dbgen.User) (map[int64]api.User, error) {
	out := make(map[int64]api.User, len(users))
	if len(users) == 0 {
		return out, nil
	}
	ids := make([]int64, 0, len(users))
	var mediaIDs []int64
	for _, u := range users {
		ids = append(ids, u.ID)
		if u.AvatarMedia != nil {
			mediaIDs = append(mediaIDs, *u.AvatarMedia)
		}
		if u.BannerMedia != nil {
			mediaIDs = append(mediaIDs, *u.BannerMedia)
		}
	}
	badges, err := p.Q.ListBadgesForUsers(ctx, uniq(ids))
	if err != nil {
		return nil, err
	}
	byUser := map[int64][]api.Badge{}
	for _, b := range badges {
		bb := api.Badge{Kind: api.BadgeKind(b.Kind)}
		if b.Detail != "" {
			bb.Detail = ptr(b.Detail)
		}
		byUser[b.UserID] = append(byUser[b.UserID], bb)
	}
	mediaMap, err := p.mediaByID(ctx, mediaIDs)
	if err != nil {
		return nil, err
	}
	for _, u := range users {
		au := userBase(u)
		if b := byUser[u.ID]; len(b) > 0 {
			au.Badges = &b
		} else {
			au.Badges = &[]api.Badge{}
		}
		if u.AvatarMedia != nil {
			if m, ok := mediaMap[*u.AvatarMedia]; ok {
				au.AvatarUrl = ptr(MediaURL(m))
			}
		}
		if u.BannerMedia != nil {
			if m, ok := mediaMap[*u.BannerMedia]; ok {
				au.BannerUrl = ptr(MediaURL(m))
			}
		}
		if p.isViewer(u.ID) {
			lang, script, theme := api.Lang(u.Lang), api.Script(u.Script), api.Theme(u.Theme)
			au.Lang, au.Script, au.Theme = &lang, &script, &theme
		}
		out[u.ID] = au
	}
	return out, nil
}

// User presents one user.
func (p *P) User(ctx context.Context, u dbgen.User) (api.User, error) {
	m, err := p.Users(ctx, []dbgen.User{u})
	if err != nil {
		return api.User{}, err
	}
	return m[u.ID], nil
}

// UserList presents users in order.
func (p *P) UserList(ctx context.Context, users []dbgen.User) ([]api.User, error) {
	m, err := p.Users(ctx, users)
	if err != nil {
		return nil, err
	}
	out := make([]api.User, 0, len(users))
	for _, u := range users {
		out = append(out, m[u.ID])
	}
	return out, nil
}

func userBase(u dbgen.User) api.User {
	au := api.User{
		Id:          u.ID,
		Username:    u.Username,
		DisplayName: u.DisplayName,
		Karma:       int(u.Karma),
		IsModerator: u.IsModerator,
		Accent:      api.Accent(u.Accent),
		CreatedAt:   u.CreatedAt,
		OpenToWork:  ptr(u.OpenToWork),
	}
	if au.DisplayName == "" {
		au.DisplayName = u.Username
	}
	au.Bio = nonEmpty(u.Bio)
	au.Pronouns = nonEmpty(u.Pronouns)
	au.RoleTitle = nonEmpty(u.RoleTitle)
	au.Company = nonEmpty(u.Company)
	au.Location = nonEmpty(u.Location)
	return au
}

// ---- links -----------------------------------------------------------------

type LinkRow struct {
	Link dbgen.Link
	User dbgen.User
}

func LinkPath(l dbgen.Link) string {
	if l.Slug == "" {
		return fmt.Sprintf("/l/%d", l.ID)
	}
	return fmt.Sprintf("/l/%d/%s", l.ID, l.Slug)
}

func (p *P) Links(ctx context.Context, rows []LinkRow) ([]api.Link, error) {
	if len(rows) == 0 {
		return []api.Link{}, nil
	}
	ids := make([]int64, len(rows))
	users := make([]dbgen.User, len(rows))
	for i, r := range rows {
		ids[i], users[i] = r.Link.ID, r.User
	}
	um, err := p.Users(ctx, users)
	if err != nil {
		return nil, err
	}
	tagRows, err := p.Q.ListTagsForLinks(ctx, ids)
	if err != nil {
		return nil, err
	}
	tags := map[int64][]api.Tag{}
	for _, t := range tagRows {
		tags[t.LinkID] = append(tags[t.LinkID], api.Tag{Slug: t.Slug, Name: t.Name})
	}
	votes, err := p.votes(ctx, "link", ids)
	if err != nil {
		return nil, err
	}
	out := make([]api.Link, len(rows))
	for i, r := range rows {
		l := r.Link
		al := api.Link{
			Id:           l.ID,
			Kind:         api.LinkKind(l.Kind),
			Title:        l.Title,
			Slug:         l.Slug,
			Path:         LinkPath(l),
			Url:          l.Url,
			Domain:       nonEmpty(l.Domain),
			BodyMd:       ptr(l.BodyMd),
			BodyHtml:     ptr(l.BodyHtml),
			Author:       um[r.User.ID],
			Tags:         orEmpty(tags[l.ID]),
			Points:       int(l.Points),
			CommentCount: int(l.CommentCount),
			ViewerVote:   api.VoteValue(votes[l.ID]),
			CanEdit:      ptr(p.isViewer(l.AuthorID)),
			Killed:       ptr(l.KilledAt != nil),
			CreatedAt:    l.CreatedAt,
			EditedAt:     l.EditedAt,
		}
		out[i] = al
	}
	return out, nil
}

func (p *P) votes(ctx context.Context, subject string, ids []int64) (map[int64]int, error) {
	out := map[int64]int{}
	if p.Viewer == nil || len(ids) == 0 {
		return out, nil
	}
	rows, err := p.Q.ListVotesForSubjects(ctx, dbgen.ListVotesForSubjectsParams{
		SubjectType: subject, Ids: ids, UserID: p.Viewer.ID,
	})
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.SubjectID] = int(r.Value)
	}
	return out, nil
}

// ---- comments ----------------------------------------------------------------

func (p *P) Comments(ctx context.Context, rows []dbgen.ListCommentsForSubjectRow) ([]api.Comment, error) {
	users := make([]dbgen.User, len(rows))
	for i, r := range rows {
		users[i] = r.User
	}
	um, err := p.Users(ctx, users)
	if err != nil {
		return nil, err
	}
	out := make([]api.Comment, 0, len(rows))
	for _, r := range rows {
		c := r.Comment
		ac := api.Comment{
			Id:         c.ID,
			ParentId:   c.ParentID,
			Depth:      int(c.Depth),
			Author:     um[r.User.ID],
			BodyHtml:   c.BodyHtml,
			Points:     int(c.Points),
			ViewerVote: api.VoteValue(r.ViewerVote),
			CanEdit:    ptr(p.isViewer(c.AuthorID) && c.DeletedAt == nil),
			Collapsed:  ptr(r.CollapsedHidden || r.CollapsedMuted),
			Deleted:    ptr(c.DeletedAt != nil),
			Killed:     ptr(c.KilledAt != nil),
			CreatedAt:  c.CreatedAt,
			EditedAt:   c.EditedAt,
		}
		// Every comment keeps its place so replies still make sense. A deleted one
		// loses its words and author; a killed one keeps its words only for
		// moderators; one from a blocked or muted author arrives folded and empty.
		// A muted word only folds it.
		switch {
		case c.DeletedAt != nil:
			ac.BodyHtml = ""
			ac.Author = api.User{Accent: api.Lapis, CreatedAt: c.CreatedAt}
		case c.KilledAt != nil && !p.isMod():
			ac.BodyHtml = ""
		case r.CollapsedHidden:
			ac.BodyHtml = ""
		default:
			if p.isViewer(c.AuthorID) {
				ac.BodyMd = ptr(c.BodyMd)
			}
		}
		out = append(out, ac)
	}
	return out, nil
}

// CommentOne presents a single freshly written comment.
func (p *P) CommentOne(ctx context.Context, c dbgen.Comment, author dbgen.User) (api.Comment, error) {
	cs, err := p.Comments(ctx, []dbgen.ListCommentsForSubjectRow{{Comment: c, User: author}})
	if err != nil {
		return api.Comment{}, err
	}
	return cs[0], nil
}

// ---- notes -------------------------------------------------------------------

type NoteRow struct {
	Note dbgen.Note
	User dbgen.User
}

func NotePath(username string, id int64) string { return fmt.Sprintf("/@%s/n/%d", username, id) }

// Notes presents notes with their media, previews, the viewer's state, and one
// level of quoted or reposted notes.
func (p *P) Notes(ctx context.Context, rows []NoteRow) ([]api.Note, error) {
	if len(rows) == 0 {
		return []api.Note{}, nil
	}
	// Load notes referenced by quotes and reposts, one level deep.
	var refIDs []int64
	for _, r := range rows {
		if r.Note.QuoteOfID != nil {
			refIDs = append(refIDs, *r.Note.QuoteOfID)
		}
		if r.Note.RepostOfID != nil {
			refIDs = append(refIDs, *r.Note.RepostOfID)
		}
	}
	refs := map[int64]api.Note{}
	if len(refIDs) > 0 {
		refRows, err := p.Q.ListNotesByIDs(ctx, dbgen.ListNotesByIDsParams{Ids: uniq(refIDs), ViewerID: p.viewerPtr()})
		if err != nil {
			return nil, err
		}
		var visible []NoteRow
		for _, r := range refRows {
			if r.Note.KilledAt == nil {
				visible = append(visible, NoteRow{Note: r.Note, User: r.User})
			}
		}
		presented, err := p.notesFlat(ctx, visible)
		if err != nil {
			return nil, err
		}
		for _, n := range presented {
			refs[n.Id] = n
		}
	}
	out, err := p.notesFlat(ctx, rows)
	if err != nil {
		return nil, err
	}
	for i, r := range rows {
		if r.Note.QuoteOfID != nil {
			if q, ok := refs[*r.Note.QuoteOfID]; ok {
				out[i].QuoteOf = &q
			}
		}
		if r.Note.RepostOfID != nil {
			if q, ok := refs[*r.Note.RepostOfID]; ok {
				out[i].RepostOf = &q
			}
		}
	}
	return out, nil
}

func (p *P) notesFlat(ctx context.Context, rows []NoteRow) ([]api.Note, error) {
	if len(rows) == 0 {
		return nil, nil
	}
	ids := make([]int64, len(rows))
	users := make([]dbgen.User, len(rows))
	var previewMedia []int64
	for i, r := range rows {
		ids[i], users[i] = r.Note.ID, r.User
		if r.Note.PreviewMedia != nil {
			previewMedia = append(previewMedia, *r.Note.PreviewMedia)
		}
	}
	um, err := p.Users(ctx, users)
	if err != nil {
		return nil, err
	}
	mediaRows, err := p.Q.ListNoteMedia(ctx, ids)
	if err != nil {
		return nil, err
	}
	nm := map[int64][]api.NoteMedia{}
	for _, m := range mediaRows {
		nm[m.NoteID] = append(nm[m.NoteID], api.NoteMedia{Alt: m.Alt, Media: Media(m.Media)})
	}
	pm, err := p.mediaByID(ctx, previewMedia)
	if err != nil {
		return nil, err
	}
	liked, bookmarked, reposted := map[int64]bool{}, map[int64]bool{}, map[int64]bool{}
	if p.Viewer != nil {
		l, err := p.Q.ListLikesForNotes(ctx, dbgen.ListLikesForNotesParams{Ids: ids, UserID: p.Viewer.ID})
		if err != nil {
			return nil, err
		}
		for _, id := range l {
			liked[id] = true
		}
		b, err := p.Q.ListBookmarksForNotes(ctx, dbgen.ListBookmarksForNotesParams{Ids: ids, UserID: p.Viewer.ID})
		if err != nil {
			return nil, err
		}
		for _, id := range b {
			bookmarked[id] = true
		}
		rp, err := p.Q.ListRepostsForNotes(ctx, dbgen.ListRepostsForNotesParams{Ids: ids, UserID: p.Viewer.ID})
		if err != nil {
			return nil, err
		}
		for _, id := range rp {
			if id != nil {
				reposted[*id] = true
			}
		}
	}

	out := make([]api.Note, len(rows))
	for i, r := range rows {
		n := r.Note
		an := api.Note{
			Id:             n.ID,
			Author:         um[r.User.ID],
			Path:           NotePath(r.User.Username, n.ID),
			BodyHtml:       n.BodyHtml,
			Media:          orEmpty(nm[n.ID]),
			ReplyToId:      n.ReplyToID,
			ReplyPolicy:    ptr(api.ReplyPolicy(n.ReplyPolicy)),
			LikeCount:      int(n.LikeCount),
			RepostCount:    int(n.RepostCount),
			QuoteCount:     ptr(int(n.QuoteCount)),
			ReplyCount:     int(n.ReplyCount),
			Liked:          ptr(liked[n.ID]),
			Bookmarked:     ptr(bookmarked[n.ID]),
			Reposted:       ptr(reposted[n.ID]),
			CanEdit:        ptr(p.isViewer(n.AuthorID)),
			Killed:         ptr(n.KilledAt != nil),
			PromotedLinkId: n.PromotedLinkID,
			CreatedAt:      n.CreatedAt,
			EditedAt:       n.EditedAt,
		}
		if p.isViewer(n.AuthorID) {
			an.BodyMd = ptr(n.BodyMd)
		}
		if n.CodeBody != "" {
			an.Code = &api.CodeBlock{Lang: n.CodeLang, Body: n.CodeBody, Html: n.CodeHtml}
		}
		if n.PreviewUrl != nil {
			pv := api.LinkPreview{Url: *n.PreviewUrl, Domain: n.PreviewDomain,
				Title: nonEmpty(n.PreviewTitle), Description: nonEmpty(n.PreviewDesc)}
			if n.PreviewMedia != nil {
				if m, ok := pm[*n.PreviewMedia]; ok {
					mm := Media(m)
					pv.Image = &mm
				}
			}
			an.Preview = &pv
		}
		out[i] = an
	}
	return out, nil
}

// ---- articles ----------------------------------------------------------------

type ArticleRow struct {
	Article dbgen.Article
	User    dbgen.User
}

func ArticlePath(username, slug string) string { return fmt.Sprintf("/@%s/%s", username, slug) }

// Articles presents articles. withBody includes the Markdown/HTML body and TOC,
// which lists leave out to stay small.
func (p *P) Articles(ctx context.Context, rows []ArticleRow, withBody bool) ([]api.Article, error) {
	if len(rows) == 0 {
		return []api.Article{}, nil
	}
	ids := make([]int64, len(rows))
	users := make([]dbgen.User, len(rows))
	var covers []int64
	seriesIDs := map[int64]bool{}
	for i, r := range rows {
		ids[i], users[i] = r.Article.ID, r.User
		if r.Article.CoverMedia != nil {
			covers = append(covers, *r.Article.CoverMedia)
		}
		if r.Article.SeriesID != nil {
			seriesIDs[*r.Article.SeriesID] = true
		}
	}
	um, err := p.Users(ctx, users)
	if err != nil {
		return nil, err
	}
	tagRows, err := p.Q.ListTagsForArticles(ctx, ids)
	if err != nil {
		return nil, err
	}
	tags := map[int64][]api.Tag{}
	for _, t := range tagRows {
		tags[t.ArticleID] = append(tags[t.ArticleID], api.Tag{Slug: t.Slug, Name: t.Name})
	}
	cm, err := p.mediaByID(ctx, covers)
	if err != nil {
		return nil, err
	}
	series := map[int64]api.Series{}
	for id := range seriesIDs {
		s, err := p.Q.GetSeries(ctx, id)
		if err != nil {
			continue
		}
		series[id] = SeriesOf(s)
	}
	votes, err := p.votes(ctx, "article", ids)
	if err != nil {
		return nil, err
	}

	out := make([]api.Article, len(rows))
	for i, r := range rows {
		a := r.Article
		aa := api.Article{
			Id:             a.ID,
			Title:          a.Title,
			Subtitle:       nonEmpty(a.Subtitle),
			Slug:           a.Slug,
			Path:           ArticlePath(r.User.Username, a.Slug),
			Author:         um[r.User.ID],
			Lang:           ptr(api.Lang(a.Lang)),
			CanonicalUrl:   a.CanonicalUrl,
			SeriesSort:     ptr(int(a.SeriesSort)),
			Status:         api.ArticleStatus(a.Status),
			Tags:           orEmpty(tags[a.ID]),
			Points:         int(a.Points),
			CommentCount:   int(a.CommentCount),
			ReadingMinutes: int(a.ReadingMinutes),
			ViewerVote:     ptr(api.VoteValue(votes[a.ID])),
			Featured:       ptr(a.FeaturedAt != nil),
			CanEdit:        ptr(p.isViewer(a.AuthorID)),
			Killed:         ptr(a.KilledAt != nil),
			PublishedAt:    a.PublishedAt,
			ScheduledAt:    a.ScheduledAt,
			CreatedAt:      a.CreatedAt,
			UpdatedAt:      ptr(a.UpdatedAt),
		}
		if a.CoverMedia != nil {
			if m, ok := cm[*a.CoverMedia]; ok {
				mm := Media(m)
				aa.Cover = &mm
			}
		}
		if a.SeriesID != nil {
			if s, ok := series[*a.SeriesID]; ok {
				aa.Series = &s
			}
		}
		if withBody {
			aa.BodyHtml = ptr(a.BodyHtml)
			var toc []api.TocEntry
			_ = json.Unmarshal(a.Toc, &toc)
			aa.Toc = ptr(orEmpty(toc))
			if p.isViewer(a.AuthorID) {
				aa.BodyMd = ptr(a.BodyMd)
			}
		}
		out[i] = aa
	}
	return out, nil
}

func SeriesOf(s dbgen.Series) api.Series {
	return api.Series{Id: s.ID, Slug: s.Slug, Title: s.Title, Description: nonEmpty(s.Description)}
}

func TagOf(t dbgen.Tag) api.Tag {
	return api.Tag{Slug: t.Slug, Name: t.Name, Description: nonEmpty(t.Description), PostCount: int(t.PostCount)}
}

// ---- helpers -----------------------------------------------------------------

func ptr[T any](v T) *T { return &v }

// Ptr is exported for handlers that build API objects by hand.
func Ptr[T any](v T) *T { return &v }

func nonEmpty(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return &s
}

func orEmpty[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

func uniq(ids []int64) []int64 {
	seen := make(map[int64]bool, len(ids))
	out := ids[:0:0]
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}
