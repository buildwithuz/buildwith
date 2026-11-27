package media

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func encodePNG(t *testing.T, w, h int, alpha bool) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			a := uint8(255)
			if alpha && x < w/2 {
				a = 0
			}
			img.Set(x, y, color.NRGBA{R: uint8(x), G: uint8(y), B: 120, A: a})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestAvatarIsCroppedSquareJPEG(t *testing.T) {
	im, err := Process(bytes.NewReader(encodePNG(t, 900, 600, false)), Avatar)
	if err != nil {
		t.Fatal(err)
	}
	if im.Width != 400 || im.Height != 400 || im.Mime != "image/jpeg" {
		t.Fatalf("got %dx%d %s", im.Width, im.Height, im.Mime)
	}
	if _, err := jpeg.Decode(bytes.NewReader(im.Data)); err != nil {
		t.Fatalf("output is not a valid JPEG: %v", err)
	}
}

func TestNoteKeepsAlphaAsPNGAndFits(t *testing.T) {
	im, err := Process(bytes.NewReader(encodePNG(t, 3000, 1000, true)), Note)
	if err != nil {
		t.Fatal(err)
	}
	if im.Width != 2000 || im.Height != 666 || im.Mime != "image/png" {
		t.Fatalf("got %dx%d %s", im.Width, im.Height, im.Mime)
	}
}

func TestRejects(t *testing.T) {
	if _, err := Process(bytes.NewReader([]byte("<svg onload=alert(1)>")), Note); !errors.Is(err, ErrUnsupported) {
		t.Errorf("svg: want ErrUnsupported, got %v", err)
	}
	if _, err := Process(bytes.NewReader(encodePNG(t, 8, 8, false)), Note); !errors.Is(err, ErrDimensions) {
		t.Errorf("tiny: want ErrDimensions, got %v", err)
	}
	big := bytes.Repeat([]byte{0}, int(MaxBytes(Avatar))+1)
	if _, err := Process(bytes.NewReader(big), Avatar); !errors.Is(err, ErrTooLarge) {
		t.Errorf("big: want ErrTooLarge, got %v", err)
	}
}

func TestReencodingStripsTrailingData(t *testing.T) {
	// Bytes appended after a valid image (a classic polyglot trick) must not survive.
	payload := append(encodePNG(t, 64, 64, false), []byte("<?php system($_GET[0]); ?>")...)
	im, err := Process(bytes.NewReader(payload), Note)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(im.Data, []byte("<?php")) {
		t.Fatal("trailing payload survived re-encoding")
	}
}

func TestDiskStoreIsContentAddressed(t *testing.T) {
	dir := t.TempDir()
	im, err := Process(bytes.NewReader(encodePNG(t, 64, 64, false)), Note)
	if err != nil {
		t.Fatal(err)
	}
	s := DiskStore{Dir: dir}
	for range 2 {
		if err := s.Put(context.Background(), im.Name(), im.Data); err != nil {
			t.Fatal(err)
		}
	}
	got, err := os.ReadFile(filepath.Join(dir, im.Name()))
	if err != nil || !bytes.Equal(got, im.Data) {
		t.Fatalf("stored file mismatch: %v", err)
	}
}
