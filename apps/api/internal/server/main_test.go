package server

import (
	"flag"
	"io"
	"log/slog"
	"os"
	"testing"
)

func TestMain(m *testing.M) {
	flag.Parse()
	// Request logs drown test output; -v brings them back.
	if !testing.Verbose() {
		slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	}
	os.Exit(m.Run())
}
