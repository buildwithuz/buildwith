// Package testdb gives integration tests a real, migrated Postgres database.
package testdb

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver for goose
	"github.com/pressly/goose/v3"

	"github.com/buildwithuz/buildwith/apps/api/db"
)

var migrateOnce sync.Once
var migrateErr error

// Pool returns a pool on BUILDWITH_TEST_DATABASE_URL with every table empty.
// Tests are skipped when the variable is unset, so `go test ./...` still works
// without Docker; CI always sets it.
func Pool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("BUILDWITH_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("BUILDWITH_TEST_DATABASE_URL not set; skipping database test")
	}
	migrateOnce.Do(func() { migrateErr = migrate(url) })
	if migrateErr != nil {
		t.Fatalf("migrate: %v", migrateErr)
	}
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
