//go:build ignore

package main

import (
	"context"
	"database/sql"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/sqlite3"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	_ "github.com/jackc/pgx/v5/stdlib"
	_ "github.com/mattn/go-sqlite3"
)

var copyOrder = []string{
	"tenants",
	"users",
	"refresh_tokens",
	"audit_log",
	"protocols",
	"approval_batches",
	"approval_items",
	"scribe_sessions",
	"scribe_section_approvals",
	"scribe_section_edits",
	"scribe_feedback",
	"scribe_usage_events",
}

func main() {
	var sourceURL string
	var destPath string
	var force bool
	flag.StringVar(&sourceURL, "source", os.Getenv("SOURCE_DATABASE_URL"), "production Supabase/Postgres connection string")
	flag.StringVar(&destPath, "dest", "tmp/janushc-prod.db", "SQLite database path to write")
	flag.BoolVar(&force, "force", false, "replace dest if it already exists")
	flag.Parse()

	if sourceURL == "" {
		log.Fatal("set -source or SOURCE_DATABASE_URL to the Supabase/Postgres connection string")
	}
	if destPath == "" {
		log.Fatal("dest path is required")
	}
	if strings.HasPrefix(destPath, "sqlite://") || strings.HasPrefix(destPath, "sqlite3://") {
		log.Fatal("dest must be a filesystem path, not a sqlite:// URL")
	}
	if _, err := os.Stat(destPath); err == nil && !force {
		log.Fatalf("%s already exists; pass -force to replace it", destPath)
	}
	if force {
		if err := os.Remove(destPath); err != nil && !os.IsNotExist(err) {
			log.Fatalf("remove destination: %v", err)
		}
	}
	if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
		log.Fatalf("create destination directory: %v", err)
	}

	ctx := context.Background()
	source, err := sql.Open("pgx", sourceURL)
	if err != nil {
		log.Fatalf("open source: %v", err)
	}
	defer source.Close()
	if err := source.PingContext(ctx); err != nil {
		log.Fatalf("ping source: %v", err)
	}

	if err := migrateDestination(destPath); err != nil {
		log.Fatalf("migrate destination: %v", err)
	}

	dest, err := sql.Open("sqlite3", sqliteDSN(destPath))
	if err != nil {
		log.Fatalf("open destination: %v", err)
	}
	defer dest.Close()
	if _, err := dest.ExecContext(ctx, "PRAGMA foreign_keys = ON"); err != nil {
		log.Fatalf("enable foreign keys: %v", err)
	}

	if err := clearDestination(ctx, dest); err != nil {
		log.Fatalf("clear destination: %v", err)
	}

	for _, table := range copyOrder {
		copied, err := copyTable(ctx, source, dest, table)
		if err != nil {
			log.Fatalf("copy %s: %v", table, err)
		}
		log.Printf("copied %-28s %d rows", table, copied)
	}

	if err := verifyCounts(ctx, source, dest); err != nil {
		log.Fatalf("verify counts: %v", err)
	}
	log.Printf("migration complete: %s", destPath)
}

func migrateDestination(destPath string) error {
	m, err := migrate.New("file://migrations", "sqlite3://"+destPath)
	if err != nil {
		return err
	}
	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return err
	}
	return nil
}

func clearDestination(ctx context.Context, dest *sql.DB) error {
	if _, err := dest.ExecContext(ctx, "PRAGMA foreign_keys = OFF"); err != nil {
		return err
	}
	for i := len(copyOrder) - 1; i >= 0; i-- {
		if _, err := dest.ExecContext(ctx, "DELETE FROM "+quoteIdent(copyOrder[i])); err != nil {
			return fmt.Errorf("%s: %w", copyOrder[i], err)
		}
	}
	_, err := dest.ExecContext(ctx, "PRAGMA foreign_keys = ON")
	return err
}

func copyTable(ctx context.Context, source *sql.DB, dest *sql.DB, table string) (int, error) {
	exists, err := sourceTableExists(ctx, source, table)
	if err != nil {
		return 0, err
	}
	if !exists {
		return 0, nil
	}

	sourceTypes, err := sourceColumnTypes(ctx, source, table)
	if err != nil {
		return 0, err
	}
	columns, err := commonColumns(ctx, source, dest, table)
	if err != nil {
		return 0, err
	}
	if len(columns) == 0 {
		return 0, nil
	}

	selectSQL := "SELECT " + quoteIdentList(columns) + " FROM public." + quoteIdent(table)
	rows, err := source.QueryContext(ctx, selectSQL)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	insertSQL := "INSERT INTO " + quoteIdent(table) + " (" + quoteIdentList(columns) + ") VALUES (" + placeholders(len(columns)) + ")"
	tx, err := dest.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	stmt, err := tx.PrepareContext(ctx, insertSQL)
	if err != nil {
		_ = tx.Rollback()
		return 0, err
	}
	defer stmt.Close()

	count := 0
	for rows.Next() {
		values := make([]interface{}, len(columns))
		targets := make([]interface{}, len(columns))
		for i := range values {
			targets[i] = &values[i]
		}
		if err := rows.Scan(targets...); err != nil {
			_ = tx.Rollback()
			return 0, err
		}
		for i, column := range columns {
			values[i] = normalizeValue(values[i], sourceTypes[column])
		}
		if _, err := stmt.ExecContext(ctx, values...); err != nil {
			_ = tx.Rollback()
			return 0, err
		}
		count++
	}
	if err := rows.Err(); err != nil {
		_ = tx.Rollback()
		return 0, err
	}
	return count, tx.Commit()
}

func verifyCounts(ctx context.Context, source *sql.DB, dest *sql.DB) error {
	for _, table := range copyOrder {
		exists, err := sourceTableExists(ctx, source, table)
		if err != nil {
			return err
		}
		if !exists {
			continue
		}
		sourceCount, err := tableCount(ctx, source, "public."+quoteIdent(table))
		if err != nil {
			return err
		}
		destCount, err := tableCount(ctx, dest, quoteIdent(table))
		if err != nil {
			return err
		}
		if sourceCount != destCount {
			return fmt.Errorf("%s count mismatch: source=%d dest=%d", table, sourceCount, destCount)
		}
		log.Printf("verified %-26s %d rows", table, destCount)
	}
	return nil
}

func sourceTableExists(ctx context.Context, db *sql.DB, table string) (bool, error) {
	var exists bool
	err := db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = $1
		)`, table).Scan(&exists)
	return exists, err
}

func sourceColumnTypes(ctx context.Context, db *sql.DB, table string) (map[string]string, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT column_name, data_type
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = $1`, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	types := map[string]string{}
	for rows.Next() {
		var column, dataType string
		if err := rows.Scan(&column, &dataType); err != nil {
			return nil, err
		}
		types[column] = dataType
	}
	return types, rows.Err()
}

func commonColumns(ctx context.Context, source *sql.DB, dest *sql.DB, table string) ([]string, error) {
	sourceTypes, err := sourceColumnTypes(ctx, source, table)
	if err != nil {
		return nil, err
	}
	rows, err := dest.QueryContext(ctx, "PRAGMA table_info("+quoteIdent(table)+")")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type destColumn struct {
		cid  int
		name string
	}
	destColumns := []destColumn{}
	for rows.Next() {
		var cid int
		var name, dataType string
		var notNull int
		var defaultValue interface{}
		var pk int
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &pk); err != nil {
			return nil, err
		}
		if _, ok := sourceTypes[name]; ok {
			destColumns = append(destColumns, destColumn{cid: cid, name: name})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Slice(destColumns, func(i, j int) bool { return destColumns[i].cid < destColumns[j].cid })
	columns := make([]string, 0, len(destColumns))
	for _, column := range destColumns {
		columns = append(columns, column.name)
	}
	return columns, nil
}

func tableCount(ctx context.Context, db *sql.DB, tableExpr string) (int64, error) {
	var count int64
	err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+tableExpr).Scan(&count)
	return count, err
}

func normalizeValue(value interface{}, sourceType string) interface{} {
	if value == nil {
		return nil
	}
	switch v := value.(type) {
	case time.Time:
		return v.UTC().Format(time.RFC3339Nano)
	case []byte:
		if sourceType == "uuid" && len(v) == 16 {
			return formatUUIDBytes(v)
		}
		return string(v)
	case [16]byte:
		return formatUUIDBytes(v[:])
	case bool:
		if v {
			return 1
		}
		return 0
	default:
		return v
	}
}

func formatUUIDBytes(bytes []byte) string {
	encoded := hex.EncodeToString(bytes)
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32]
}

func sqliteDSN(path string) string {
	if !strings.Contains(path, "?") {
		return path + "?_foreign_keys=on"
	}
	return path + "&_foreign_keys=on"
}

func placeholders(count int) string {
	values := make([]string, count)
	for i := range values {
		values[i] = "?"
	}
	return strings.Join(values, ", ")
}

func quoteIdentList(columns []string) string {
	quoted := make([]string, len(columns))
	for i, column := range columns {
		quoted[i] = quoteIdent(column)
	}
	return strings.Join(quoted, ", ")
}

func quoteIdent(identifier string) string {
	return `"` + strings.ReplaceAll(identifier, `"`, `""`) + `"`
}
