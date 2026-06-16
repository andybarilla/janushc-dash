//go:build ignore

package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/joho/godotenv"
	_ "github.com/mattn/go-sqlite3"
)

func main() {
	_ = godotenv.Load()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "tmp/janushc-dash.db"
	}

	db, err := sql.Open("sqlite3", sqliteDSN(dbURL))
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer db.Close()

	ctx := context.Background()
	if _, err := db.ExecContext(ctx, "PRAGMA foreign_keys = ON"); err != nil {
		log.Fatalf("enable foreign keys: %v", err)
	}

	var tenantID string
	err = db.QueryRowContext(ctx,
		`INSERT INTO tenants (name, athena_practice_id)
		 VALUES ('Janus Healthcare', '195900')
		 ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
		 RETURNING id`,
	).Scan(&tenantID)
	if err != nil {
		log.Fatalf("create tenant: %v", err)
	}
	fmt.Printf("Tenant ID: %s\n", tenantID)

	users := []struct {
		email string
		role  string
		name  string
	}{
		{"drcrance@janushc.com", "physician", "Courtney Crance"},
		{"sarah@janushc.com", "staff", "Sarah Thompson"},
		{"kim@janushc.com", "staff", "Kim Rodriguez"},
		{"alex@janushc.com", "staff", "Alex Chen"},
	}

	for _, u := range users {
		_, err = db.ExecContext(ctx,
			`INSERT INTO users (tenant_id, email, password_hash, role, name)
			 VALUES (?1, ?2, '', ?3, ?4)
			 ON CONFLICT (tenant_id, email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role`,
			tenantID, u.email, u.role, u.name,
		)
		if err != nil {
			log.Fatalf("create user %s: %v", u.email, err)
		}
		fmt.Printf("User: %s (%s) — %s\n", u.name, u.role, u.email)
	}

	_, err = db.ExecContext(ctx,
		`INSERT INTO protocols (tenant_id, name, procedure_name, standard_dosage, max_lab_age_days, requires_established_patient)
		 VALUES
		   (?1, 'Standard Testosterone Pellet', 'Testosterone Pellet', '200mg', 90, true),
		   (?1, 'Standard Estradiol Injection', 'Estradiol Injection', '20mg', 90, true)
		 ON CONFLICT (tenant_id, name) DO NOTHING`,
		tenantID,
	)
	if err != nil {
		log.Fatalf("create protocols: %v", err)
	}
	fmt.Println("Protocols created")
	fmt.Println("\nDone. Users can sign in with their @janushc.com Google accounts.")
}

func sqliteDSN(databaseURL string) string {
	dsn := strings.TrimPrefix(databaseURL, "sqlite3://")
	dsn = strings.TrimPrefix(dsn, "sqlite://")
	if !strings.Contains(dsn, "?") {
		dsn += "?_foreign_keys=on"
	} else if !strings.Contains(dsn, "_foreign_keys=") {
		dsn += "&_foreign_keys=on"
	}
	return dsn
}
