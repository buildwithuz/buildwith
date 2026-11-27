// Package media turns an untrusted upload into a safe image. Every file is fully
// decoded and re-encoded, which drops metadata (GPS, camera serials) and
// anything that is not pixels.
package media

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"os"
	"path/filepath"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp" // registers the WebP decoder
)

var (
	ErrTooLarge    = errors.New("media: file is too large")
	ErrUnsupported = errors.New("media: not a JPEG, PNG or WebP image")
	ErrDimensions  = errors.New("media: image dimensions are out of range")
)

// Kind decides the size limits and the output geometry.
type Kind string

const (
	Avatar  Kind = "avatar"
	Banner  Kind = "banner"
	Note    Kind = "note"
	Article Kind = "article"
	Cover   Kind = "cover"
)

type spec struct {
	maxBytes    int64
	cropW       int // when set, crop to exactly cropW x cropH
	cropH       int
	maxSide     int // otherwise fit within maxSide x maxSide
	jpegQuality int
}

var specs = map[Kind]spec{
	Avatar:  {maxBytes: 5 << 20, cropW: 400, cropH: 400, jpegQuality: 88},
	Banner:  {maxBytes: 8 << 20, cropW: 1500, cropH: 500, jpegQuality: 85},
	Note:    {maxBytes: 10 << 20, maxSide: 2000, jpegQuality: 85},
	Article: {maxBytes: 10 << 20, maxSide: 2000, jpegQuality: 85},
	Cover:   {maxBytes: 10 << 20, cropW: 1600, cropH: 840, jpegQuality: 85},
}

func ValidKind(k string) bool { _, ok := specs[Kind(k)]; return ok }

// MaxBytes is the upload limit for a kind.
func MaxBytes(k Kind) int64 { return specs[k].maxBytes }

// Image is a processed, re-encoded file ready to store.
type Image struct {
	Data   []byte
	Mime   string
	Ext    string
	Width  int
	Height int
	SHA256 []byte
}

// Name is the content-addressed path the file is stored and served under.
func (im Image) Name() string { return NameFor(im.SHA256, im.Ext) }

func NameFor(sum []byte, ext string) string {
	h := hex.EncodeToString(sum)
	return fmt.Sprintf("%s/%s/%s.%s", h[:2], h[2:4], h, ext)
}

// ExtFor maps a stored mime type to its extension.
func ExtFor(mime string) string {
	switch mime {
	case "image/png":
		return "png"
	case "image/webp":
		return "webp"
	}
	return "jpg"
}

const maxPixels = 40_000_000 // refuse decompression bombs before decoding

// Process reads at most the kind's limit from r, decodes, resizes and re-encodes.
func Process(r io.Reader, kind Kind) (Image, error) {
	sp, ok := specs[kind]
	if !ok {
		return Image{}, fmt.Errorf("media: unknown kind %q", kind)
	}
	raw, err := io.ReadAll(io.LimitReader(r, sp.maxBytes+1))
	if err != nil {
		return Image{}, err
	}
	if int64(len(raw)) > sp.maxBytes {
		return Image{}, ErrTooLarge
	}

	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return Image{}, ErrUnsupported
	}
	switch format {
	case "jpeg", "png", "webp":
	default:
		return Image{}, ErrUnsupported
	}
	if cfg.Width < 16 || cfg.Height < 16 || cfg.Width*cfg.Height > maxPixels {
		return Image{}, ErrDimensions
	}
	src, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return Image{}, ErrUnsupported
	}

	var out image.Image
	if sp.cropW > 0 {
		out = cropFill(src, sp.cropW, sp.cropH)
	} else {
		out = fit(src, sp.maxSide)
	}

	var buf bytes.Buffer
	im := Image{Width: out.Bounds().Dx(), Height: out.Bounds().Dy()}
	if hasAlpha(out) && kind != Banner && kind != Cover {
		enc := png.Encoder{CompressionLevel: png.BestCompression}
		if err := enc.Encode(&buf, out); err != nil {
			return Image{}, err
		}
		im.Mime, im.Ext = "image/png", "png"
	} else {
		if err := jpeg.Encode(&buf, flatten(out), &jpeg.Options{Quality: sp.jpegQuality}); err != nil {
			return Image{}, err
		}
		im.Mime, im.Ext = "image/jpeg", "jpg"
	}
	im.Data = buf.Bytes()
	sum := sha256.Sum256(im.Data)
	im.SHA256 = sum[:]
	return im, nil
}

func fit(src image.Image, maxSide int) image.Image {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= maxSide && h <= maxSide {
		dst := image.NewRGBA(image.Rect(0, 0, w, h))
		draw.Draw(dst, dst.Bounds(), src, b.Min, draw.Src)
		return dst
	}
	if w >= h {
		h = h * maxSide / w
		w = maxSide
	} else {
		w = w * maxSide / h
		h = maxSide
	}
	dst := image.NewRGBA(image.Rect(0, 0, max(1, w), max(1, h)))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, b, draw.Src, nil)
	return dst
}

// cropFill scales src to cover w x h and crops the centre.
func cropFill(src image.Image, w, h int) image.Image {
	b := src.Bounds()
	sw, sh := b.Dx(), b.Dy()
	// Choose the source rectangle with the target aspect ratio.
	var r image.Rectangle
	if sw*h > sh*w {
		cw := sh * w / h
		x := b.Min.X + (sw-cw)/2
		r = image.Rect(x, b.Min.Y, x+cw, b.Max.Y)
	} else {
		ch := sw * h / w
		y := b.Min.Y + (sh-ch)/2
		r = image.Rect(b.Min.X, y, b.Max.X, y+ch)
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, r, draw.Src, nil)
	return dst
}

func hasAlpha(img image.Image) bool {
	b := img.Bounds()
	// Sampling every pixel of a 2000 px image is fast enough and exact.
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			if _, _, _, a := img.At(x, y).RGBA(); a < 0xffff {
				return true
			}
		}
	}
	return false
}

// flatten composites onto white so JPEG never shows black where alpha was.
func flatten(img image.Image) image.Image {
	b := img.Bounds()
	dst := image.NewRGBA(b)
	draw.Draw(dst, b, &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.Draw(dst, b, img, b.Min, draw.Over)
	return dst
}

// Store keeps processed files. The default writes to a directory that the web
// server (Caddy in production) serves at /media/.
type Store interface {
	Put(ctx context.Context, name string, data []byte) error
}

type DiskStore struct{ Dir string }

func (d DiskStore) Put(_ context.Context, name string, data []byte) error {
	path := filepath.Join(d.Dir, filepath.FromSlash(name))
	if _, err := os.Stat(path); err == nil {
		return nil // content-addressed: same name, same bytes
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".upload-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
