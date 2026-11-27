package fetch

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
)

func TestIsPublic(t *testing.T) {
	for addr, want := range map[string]bool{
		"8.8.8.8": true, "213.230.64.1": true, "2a00:1450::1": true,
		"127.0.0.1": false, "10.1.2.3": false, "172.16.0.1": false, "192.168.1.1": false,
		"169.254.169.254": false, "100.64.0.1": false, "0.0.0.0": false, "::1": false,
		"fe80::1": false, "fc00::1": false, "::ffff:127.0.0.1": false, "64:ff9b::a00:1": false,
	} {
		if got := IsPublic(netip.MustParseAddr(addr)); got != want {
			t.Errorf("IsPublic(%s) = %v, want %v", addr, got, want)
		}
	}
}

func TestRefusesLoopback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("secret"))
	}))
	defer srv.Close()

	_, _, err := New(Options{}).Get(context.Background(), srv.URL, "")
	if !errors.Is(err, ErrBlockedAddress) {
		t.Fatalf("want ErrBlockedAddress, got %v", err)
	}
}

func TestRefusesRedirectToLoopback(t *testing.T) {
	// A public-looking hop that redirects inward is caught at the second dial.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://127.0.0.1:1/", http.StatusFound)
	}))
	defer srv.Close()
	c := New(Options{})
	_, _, err := c.Get(context.Background(), srv.URL, "")
	if err == nil {
		t.Fatal("want an error")
	}
}

func TestPreview(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(`<html><head><title>Fallback</title>
			<meta property="og:title" content="  Real   title ">
			<meta name="description" content="About it">
			<meta property="og:image" content="/cover.png"></head><body>x</body></html>`))
	}))
	defer srv.Close()

	p, err := New(Options{allowPrivate: true}).Preview(context.Background(), srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	if p.Title != "Real title" || p.Description != "About it" || p.Image != srv.URL+"/cover.png" {
		t.Fatalf("got %+v", p)
	}
}

func TestParseHeadFallsBackToTitle(t *testing.T) {
	if got := ParseHead("<title>Only title</title>").Title; got != "Only title" {
		t.Fatalf("got %q", got)
	}
}
