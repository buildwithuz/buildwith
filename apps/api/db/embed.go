// Package db embeds the migrations so binaries and tests can apply them
// without the goose command.
package db

import "embed"

//go:embed migrations/*.sql
var Migrations embed.FS
