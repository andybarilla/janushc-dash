package database

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/sqlite3"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgtype"
	_ "github.com/mattn/go-sqlite3"
)

const (
	sqliteTimestampTenantID  = "f4909dfe-f082-41fa-9019-63f150cd1c90"
	sqliteTimestampUserID    = "31d45421-5ba9-4c9f-b47d-8b5f992261c3"
	sqliteTimestampSessionID = "7cadf00d-5ba9-4c9f-b47d-8b5f992261c3"
)

func TestMigratedSQLiteCurrentTimestampScans(t *testing.T) {
	t.Run("tenants", func(t *testing.T) {
		db := openMigratedSQLiteDB(t)
		defer db.Close()

		_, err := New(db).CreateTenant(context.Background(), CreateTenantParams{
			Name:             "Timestamp Test Tenant",
			AthenaPracticeID: pgtype.Text{String: "timestamp-test", Valid: true},
		})
		if err != nil {
			t.Fatalf("create tenant: %v", err)
		}
	})

	t.Run("users", func(t *testing.T) {
		db := openMigratedSQLiteDB(t)
		defer db.Close()
		seedTenant(t, db)

		user, err := New(db).CreateTenantUser(context.Background(), CreateTenantUserParams{
			TenantID: mustPgUUID(t, sqliteTimestampTenantID),
			LOWER:    "timestamp@janushc.com",
			Role:     "physician",
			Name:     "Andy Barilla",
		})
		if err != nil {
			t.Fatalf("create tenant user: %v", err)
		}
		if !user.CreatedAt.Valid {
			t.Fatalf("created_at was not scanned")
		}

		users, err := New(db).ListUsersByTenant(context.Background(), mustPgUUID(t, sqliteTimestampTenantID))
		if err != nil {
			t.Fatalf("list users by tenant: %v", err)
		}
		if len(users) != 1 || !users[0].CreatedAt.Valid {
			t.Fatalf("expected one user with created_at, got %#v", users)
		}
	})

	t.Run("scribe sessions", func(t *testing.T) {
		db := openMigratedSQLiteDB(t)
		defer db.Close()
		seedTenantUser(t, db)

		created, err := New(db).CreateScribeSession(context.Background(), CreateScribeSessionParams{
			TenantID:      mustPgUUID(t, sqliteTimestampTenantID),
			UserID:        mustPgUUID(t, sqliteTimestampUserID),
			PatientID:     "patient-1",
			EncounterID:   "encounter-1",
			AppointmentID: "appointment-1",
			DepartmentID:  "department-1",
			Label:         "Follow-up",
		})
		if err != nil {
			t.Fatalf("create scribe session: %v", err)
		}
		if !created.CreatedAt.Valid {
			t.Fatalf("created_at was not scanned")
		}

		sessions, err := New(db).ListScribeSessions(context.Background(), mustPgUUID(t, sqliteTimestampTenantID))
		if err != nil {
			t.Fatalf("list scribe sessions: %v", err)
		}
		if len(sessions) != 1 || !sessions[0].CreatedAt.Valid {
			t.Fatalf("expected one session with created_at, got %#v", sessions)
		}

		got, err := New(db).GetScribeSession(context.Background(), GetScribeSessionParams{
			ID:       created.ID,
			TenantID: mustPgUUID(t, sqliteTimestampTenantID),
		})
		if err != nil {
			t.Fatalf("get scribe session: %v", err)
		}
		if !got.CreatedAt.Valid {
			t.Fatalf("created_at was not scanned")
		}
	})

	t.Run("scribe sessions with imported RFC3339 timestamps", func(t *testing.T) {
		db := openMigratedSQLiteDB(t)
		defer db.Close()
		seedTenantUserSession(t, db)

		_, err := db.Exec(`
			UPDATE scribe_sessions
			SET status = 'complete', completed_at = '2026-05-21T19:44:37.424907Z'
			WHERE id = ?1`, sqliteTimestampSessionID)
		if err != nil {
			t.Fatalf("set imported timestamp: %v", err)
		}

		sessions, err := New(db).ListScribeSessions(context.Background(), mustPgUUID(t, sqliteTimestampTenantID))
		if err != nil {
			t.Fatalf("list scribe sessions: %v", err)
		}
		if len(sessions) != 1 || !sessions[0].CompletedAt.Valid {
			t.Fatalf("expected one session with completed_at, got %#v", sessions)
		}
	})

	t.Run("scribe events", func(t *testing.T) {
		db := openMigratedSQLiteDB(t)
		defer db.Close()
		seedTenantUserSession(t, db)

		if err := New(db).RecordSectionApproval(context.Background(), RecordSectionApprovalParams{
			SessionID: mustPgUUID(t, sqliteTimestampSessionID),
			Section:   "hpi",
			Action:    "approved",
			UserID:    mustPgUUID(t, sqliteTimestampUserID),
		}); err != nil {
			t.Fatalf("record section approval: %v", err)
		}
		states, err := New(db).GetSessionSectionStates(context.Background(), mustPgUUID(t, sqliteTimestampSessionID))
		if err != nil {
			t.Fatalf("get section states: %v", err)
		}
		if len(states) != 1 || !states[0].At.Valid {
			t.Fatalf("expected one section state with at, got %#v", states)
		}

		if err := New(db).RecordSectionEdit(context.Background(), RecordSectionEditParams{
			SessionID: mustPgUUID(t, sqliteTimestampSessionID),
			Section:   "hpi",
			Content:   pgtype.JSONB(`{"text":"updated"}`),
			EditedBy:  mustPgUUID(t, sqliteTimestampUserID),
		}); err != nil {
			t.Fatalf("record section edit: %v", err)
		}
		edits, err := New(db).GetSessionSectionEdits(context.Background(), mustPgUUID(t, sqliteTimestampSessionID))
		if err != nil {
			t.Fatalf("get section edits: %v", err)
		}
		if len(edits) != 1 || !edits[0].At.Valid {
			t.Fatalf("expected one section edit with at, got %#v", edits)
		}
	})

	t.Run("scribe feedback", func(t *testing.T) {
		db := openMigratedSQLiteDB(t)
		defer db.Close()
		seedTenantUserSession(t, db)

		created, err := New(db).CreateFeedback(context.Background(), CreateFeedbackParams{
			SessionID: mustPgUUID(t, sqliteTimestampSessionID),
			Section:   "overall",
			Category:  "comment",
			Body:      "Looks good",
			UserID:    mustPgUUID(t, sqliteTimestampUserID),
		})
		if err != nil {
			t.Fatalf("create feedback: %v", err)
		}
		if !created.At.Valid {
			t.Fatalf("at was not scanned")
		}

		feedback, err := New(db).GetSessionFeedback(context.Background(), mustPgUUID(t, sqliteTimestampSessionID))
		if err != nil {
			t.Fatalf("get session feedback: %v", err)
		}
		if len(feedback) != 1 || !feedback[0].At.Valid {
			t.Fatalf("expected one feedback row with at, got %#v", feedback)
		}
	})
}

func openMigratedSQLiteDB(t *testing.T) *sql.DB {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "test.db")
	m, err := migrate.New("file://../../migrations", "sqlite3://"+dbPath)
	if err != nil {
		t.Fatalf("create migrator: %v", err)
	}
	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		t.Fatalf("run migrations: %v", err)
	}
	if sourceErr, databaseErr := m.Close(); sourceErr != nil || databaseErr != nil {
		t.Fatalf("close migrator: source=%v database=%v", sourceErr, databaseErr)
	}

	db, err := sql.Open("sqlite3", dbPath+"?_foreign_keys=on")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		db.Close()
		t.Fatalf("enable foreign keys: %v", err)
	}
	return db
}

func seedTenantUserSession(t *testing.T, db *sql.DB) {
	t.Helper()
	seedTenantUser(t, db)
	_, err := db.Exec(`
		INSERT INTO scribe_sessions (id, tenant_id, user_id, patient_id, encounter_id, appointment_id, department_id, label, status)
		VALUES (?1, ?2, ?3, 'patient-1', 'encounter-1', 'appointment-1', 'department-1', 'Follow-up', 'recording')`,
		sqliteTimestampSessionID, sqliteTimestampTenantID, sqliteTimestampUserID)
	if err != nil {
		t.Fatalf("seed scribe session: %v", err)
	}
}

func seedTenantUser(t *testing.T, db *sql.DB) {
	t.Helper()
	seedTenant(t, db)
	_, err := db.Exec(`
		INSERT INTO users (id, tenant_id, email, password_hash, role, name)
		VALUES (?1, ?2, 'timestamp@janushc.com', '', 'physician', 'Timestamp User')`,
		sqliteTimestampUserID, sqliteTimestampTenantID)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
}

func seedTenant(t *testing.T, db *sql.DB) {
	t.Helper()
	_, err := db.Exec(`INSERT INTO tenants (id, name, athena_practice_id) VALUES (?1, 'Timestamp Test Tenant', 'timestamp-test')`, sqliteTimestampTenantID)
	if err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
}

func mustPgUUID(t *testing.T, value string) pgtype.UUID {
	t.Helper()
	var id pgtype.UUID
	if err := id.Scan(value); err != nil {
		t.Fatalf("scan uuid %q: %v", value, err)
	}
	return id
}
