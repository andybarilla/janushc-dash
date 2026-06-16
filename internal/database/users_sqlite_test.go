package database

import (
	"context"
	"database/sql"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	_ "github.com/mattn/go-sqlite3"
)

func TestGetUserByEmailOnlyFindsSQLiteUser(t *testing.T) {
	db := openUsersSQLiteDB(t)
	defer db.Close()

	user, err := New(db).GetUserByEmailOnly(context.Background(), "andy@janushc.com")
	if err != nil {
		t.Fatalf("get user by email only: %v", err)
	}
	if user.Email != "andy@janushc.com" {
		t.Fatalf("email = %q, want andy@janushc.com", user.Email)
	}
}

func TestGetUserByIDFindsSQLiteUser(t *testing.T) {
	db := openUsersSQLiteDB(t)
	defer db.Close()

	var userID pgtype.UUID
	if err := userID.Scan("31d45421-5ba9-4c9f-b47d-8b5f992261c3"); err != nil {
		t.Fatalf("scan user id: %v", err)
	}

	user, err := New(db).GetUserByID(context.Background(), userID)
	if err != nil {
		t.Fatalf("get user by id: %v", err)
	}
	if user.Email != "andy@janushc.com" {
		t.Fatalf("email = %q, want andy@janushc.com", user.Email)
	}
}

func openUsersSQLiteDB(t *testing.T) *sql.DB {
	t.Helper()

	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}

	_, err = db.Exec(`
		CREATE TABLE users (
			id UUID PRIMARY KEY,
			tenant_id UUID NOT NULL,
			email TEXT NOT NULL,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL,
			name TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL,
			updated_at TIMESTAMPTZ NOT NULL
		);
		INSERT INTO users (id, tenant_id, email, password_hash, role, name, created_at, updated_at)
		VALUES (
			'31d45421-5ba9-4c9f-b47d-8b5f992261c3',
			'f4909dfe-f082-41fa-9019-63f150cd1c90',
			'andy@janushc.com',
			'',
			'physician',
			'Andy Barilla',
			'2026-06-16 14:50:32',
			'2026-06-16 14:50:32'
		);
	`)
	if err != nil {
		db.Close()
		t.Fatalf("seed sqlite user: %v", err)
	}

	return db
}
