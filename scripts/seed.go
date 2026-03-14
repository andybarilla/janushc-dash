//go:build ignore

package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/andybarilla/emrai/internal/auth"
)

func main() {
	_ = godotenv.Load()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://emrai:emrai@localhost:5432/emrai?sslmode=disable"
	}

	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	ctx := context.Background()

	// Create tenant
	var tenantID string
	err = pool.QueryRow(ctx,
		`INSERT INTO tenants (name, athena_practice_id)
		 VALUES ('Dev Practice', '195900')
		 ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
		 RETURNING id`,
	).Scan(&tenantID)
	if err != nil {
		log.Fatalf("create tenant: %v", err)
	}
	fmt.Printf("Tenant ID: %s\n", tenantID)

	// Create physician user
	hash, _ := auth.HashPassword("password123")
	_, err = pool.Exec(ctx,
		`INSERT INTO users (tenant_id, email, password_hash, role, name)
		 VALUES ($1, 'doctor@example.com', $2, 'physician', 'Dr. Example')
		 ON CONFLICT (tenant_id, email) DO NOTHING`,
		tenantID, hash,
	)
	if err != nil {
		log.Fatalf("create user: %v", err)
	}
	fmt.Println("User: doctor@example.com / password123")

	// Create protocols
	_, err = pool.Exec(ctx,
		`INSERT INTO protocols (tenant_id, name, procedure_name, standard_dosage, max_lab_age_days, requires_established_patient)
		 VALUES
		   ($1, 'Standard Testosterone Pellet', 'Testosterone Pellet', '200mg', 90, true),
		   ($1, 'Standard Estradiol Injection', 'Estradiol Injection', '20mg', 90, true)
		 ON CONFLICT (tenant_id, name) DO NOTHING`,
		tenantID,
	)
	if err != nil {
		log.Fatalf("create protocols: %v", err)
	}
	fmt.Println("Protocols created")

	// Create sample approval items
	_, err = pool.Exec(ctx,
		`INSERT INTO approval_items (tenant_id, emr_order_id, patient_id, patient_name, procedure_name, dosage, staff_name, order_date, flagged, flag_reasons, status)
		 VALUES
		   ($1, 'ORD-001', 'PAT-001', 'Jane Doe', 'Testosterone Pellet', '200mg', 'Sarah', '2026-03-13', false, null, 'pending'),
		   ($1, 'ORD-002', 'PAT-002', 'Alex Martinez', 'Estradiol Injection', '20mg', 'Sarah', '2026-03-13', false, null, 'pending'),
		   ($1, 'ORD-003', 'PAT-003', 'Pat Robinson', 'Testosterone Pellet', '250mg', 'Kim', '2026-03-13', true, '["dosage differs from standard (250mg vs 200mg)"]', 'needs_review'),
		   ($1, 'ORD-004', 'PAT-004', 'Maria Santos', 'Estradiol Injection', '20mg', 'Sarah', '2026-03-13', false, null, 'pending')
		 ON CONFLICT (tenant_id, emr_order_id) DO NOTHING`,
		tenantID,
	)
	if err != nil {
		log.Fatalf("create sample items: %v", err)
	}

	fmt.Println("Sample approval items created")
	fmt.Printf("\nSet this in your .env or frontend:\n")
	fmt.Printf("  NEXT_PUBLIC_TENANT_ID=%s\n", tenantID)
}
