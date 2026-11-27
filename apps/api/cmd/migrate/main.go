// Command migrate applies the embedded goose migrations, so production images
// can migrate without the Go toolchain or the migration files on disk.
//
//	migrate [up|status|version]   (default: up)
package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/signal"
	"syscall"

	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"

	"github.com/buildwithuz/buildwith/apps/api/db"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "migrate:", err)
		os.Exit(1)
	}
}

func run() error {
	url := os.Getenv("BUILDWITH_DATABASE_URL")
	if url == "" {
		return errors.New("BUILDWITH_DATABASE_URL is not set")
	}
	cmd := "up"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	sqlDB, err := sql.Open("pgx", url)
	if err != nil {
		return err
	}
	defer sqlDB.Close()

	migrations, err := fs.Sub(db.Migrations, "migrations")
	if err != nil {
		return err
	}
	// The advisory lock keeps two overlapping deploys from migrating at once.
	locker, err := lock.NewPostgresSessionLocker()
	if err != nil {
		return err
	}
	p, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations, goose.WithSessionLocker(locker))
	if err != nil {
		return err
	}

	switch cmd {
	case "up":
		results, err := p.Up(ctx)
		for _, r := range results {
			fmt.Println(r)
		}
		if err != nil {
			return err
		}
		v, err := p.GetDBVersion(ctx)
		if err != nil {
			return err
		}
		fmt.Printf("migrate: %d applied, database at version %d\n", len(results), v)
	case "status":
		statuses, err := p.Status(ctx)
		if err != nil {
			return err
		}
		for _, s := range statuses {
			applied := "pending"
			if s.State == goose.StateApplied {
				applied = s.AppliedAt.UTC().Format("2006-01-02 15:04:05Z")
			}
			fmt.Printf("%-22s %s\n", applied, s.Source.Path)
		}
	case "version":
		v, err := p.GetDBVersion(ctx)
		if err != nil {
			return err
		}
		fmt.Println(v)
	default:
		return fmt.Errorf("unknown command %q (want up, status or version)", cmd)
	}
	return nil
}
