// Package testdb gives integration tests a real, migrated Postgres database.
package testdb

import (
	"context"
	"database/sql"
	neturl "net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver for goose
	"github.com/pressly/goose/v3"

	"github.com/buildwithuz/buildwith/apps/api/db"
)

var (
	prepareOnce sync.Once
	prepared    string
	prepareErr  error
)

// Pool returns a pool on a migrated database with every table empty.
//
// go test runs packages in parallel, so each package gets its own database,
// derived from BUILDWITH_TEST_DATABASE_URL and created on first use. Tests are
// skipped when the variable is unset, so `go test ./...` works without Docker;
// CI always sets it.
func Pool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	base := os.Getenv("BUILDWITH_TEST_DATABASE_URL")
	if base == "" {
		t.Skip("BUILDWITH_TEST_DATABASE_URL not set; skipping database test")
	}
	prepareOnce.Do(func() { prepared, prepareErr = prepare(base) })
	if prepareErr != nil {
		t.Fatalf("test database: %v", prepareErr)
	}
	url := prepared
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := truncate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	return pool
}

// prepare creates (if needed) and migrates this package's own database.
func prepare(base string) (string, error) {
	u, err := neturl.Parse(base)
	if err != nil {
		return "", err
	}
	wd, _ := os.Getwd()
	name := strings.TrimPrefix(u.Path, "/") + "_" + nonWord.ReplaceAllString(filepath.Base(wd), "_")
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, base)
	if err != nil {
		return "", err
	}
	defer admin.Close(ctx)
	var exists bool
	if err := admin.QueryRow(ctx, "select exists (select 1 from pg_database where datname = $1)", name).Scan(&exists); err != nil {
		return "", err
	}
	if !exists {
		if _, err := admin.Exec(ctx, "create database "+pgx.Identifier{name}.Sanitize()); err != nil {
			return "", err
		}
	}
	u.Path = "/" + name
	return u.String(), migrate(u.String())
}

var nonWord = regexp.MustCompile(`[^a-z0-9_]+`)

func migrate(url string) error {
	sqlDB, err := sql.Open("pgx", url)
	if err != nil {
		return err
	}
	defer sqlDB.Close()
	goose.SetBaseFS(db.Migrations)
	goose.SetLogger(goose.NopLogger())
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	return goose.Up(sqlDB, "migrations")
}

func truncate(ctx context.Context, pool *pgxpool.Pool) error {
	rows, err := pool.Query(ctx, `select tablename from pg_tables
		where schemaname = 'public' and tablename <> 'goose_db_version'`)
	if err != nil {
		return err
	}
	var names []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return err
		}
		names = append(names, `"`+n+`"`)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_, err = pool.Exec(ctx, "truncate "+strings.Join(names, ", ")+" restart identity cascade")
	return err
}
