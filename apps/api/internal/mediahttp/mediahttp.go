// Package mediahttp exposes the image upload endpoint on top of package media.
package mediahttp

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/buildwithuz/buildwith/apps/api/internal/api"
	"github.com/buildwithuz/buildwith/apps/api/internal/app"
	"github.com/buildwithuz/buildwith/apps/api/internal/dbgen"
	"github.com/buildwithuz/buildwith/apps/api/internal/httpx"
	"github.com/buildwithuz/buildwith/apps/api/internal/markdown"
	"github.com/buildwithuz/buildwith/apps/api/internal/media"
	"github.com/buildwithuz/buildwith/apps/api/internal/present"
	"github.com/buildwithuz/buildwith/apps/api/internal/rank"
	"github.com/buildwithuz/buildwith/apps/api/internal/ratelimit"
	"github.com/buildwithuz/buildwith/apps/api/internal/translit"
)

type Media struct{ A *app.App }

func (h *Media) UploadMedia(ctx context.Context, req api.UploadMediaRequestObject) (api.UploadMediaResponseObject, error) {
	v, err := httpx.RequireActive(ctx)
	if err != nil {
		return nil, err
	}
	ok, retry, err := h.A.Limiter.Allow(ctx, ratelimit.Uploads, strconv.FormatInt(v.ID, 10))
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, httpx.RateLimited(retry)
	}

	var kind media.Kind
	var img media.Image
	got := false
	for {
		part, err := req.Body.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, httpx.BadRequest("could not read the upload")
		}
		switch part.FormName() {
		case "kind":
			b, _ := io.ReadAll(io.LimitReader(part, 32))
			if !media.ValidKind(string(b)) {
				return nil, httpx.Invalid("kind", "unknown kind")
			}
			kind = media.Kind(b)
		case "file":
			if kind == "" {
				return nil, httpx.Invalid("kind", "send kind before file")
			}
			img, err = media.Process(part, kind)
			switch {
			case errors.Is(err, media.ErrTooLarge):
				return nil, httpx.Coded(http.StatusRequestEntityTooLarge, api.ErrorCodeTooLarge, "the file is too large")
			case errors.Is(err, media.ErrUnsupported), errors.Is(err, media.ErrDimensions):
				return nil, httpx.Coded(http.StatusUnprocessableEntity, api.ErrorCodeUnsupportedMedia, err.Error())
			case err != nil:
				return nil, err
			}
			got = true
		}
		part.Close()
	}
	if !got {
		return nil, httpx.Invalid("file", "no file")
	}
	if err := h.A.Media.Put(ctx, img.Name(), img.Data); err != nil {
		return nil, err
	}
	m, err := h.A.Q.CreateMedia(ctx, dbgen.CreateMediaParams{
		OwnerID: &v.ID, Sha256: img.SHA256, Kind: string(kind), Mime: img.Mime,
		Width: int32(img.Width), Height: int32(img.Height), Bytes: int32(len(img.Data)),
	})
	if err != nil {
		return nil, err
	}
	return api.UploadMedia201JSONResponse(present.Media(m)), nil
}

// Preview renders Markdown with the same profile and link policy the post will
// get, so the editor's preview is exactly what readers will see.
func (h *Media) PreviewMarkdown(ctx context.Context, req api.PreviewMarkdownRequestObject) (api.PreviewMarkdownResponseObject, error) {
	v, err := httpx.RequireViewer(ctx)
	if err != nil {
		return nil, err
	}
	ok, retry, err := h.A.Limiter.Allow(ctx, ratelimit.Previews, strconv.FormatInt(v.ID, 10))
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, httpx.RateLimited(retry)
	}
	profile := markdown.Comment
	switch req.Body.Profile {
	case api.PreviewMarkdownJSONBodyProfileNote:
		profile = markdown.Note
	case api.PreviewMarkdownJSONBodyProfileArticle:
		profile = markdown.Article
	}
	r := markdown.Render(translit.Normalize(req.Body.BodyMd), markdown.Options{
		Profile: profile, NoFollow: int(v.Karma) < rank.KarmaForFollowLinks,
	})
	toc := make([]api.TocEntry, 0, len(r.TOC))
	for _, e := range r.TOC {
		toc = append(toc, api.TocEntry{Level: e.Level, Text: e.Text, Id: e.ID})
	}
	return api.PreviewMarkdown200JSONResponse{Html: r.HTML, ReadingMinutes: r.ReadingMinutes(), Toc: toc}, nil
}
