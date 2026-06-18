package users

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgtype"
	_ "github.com/mattn/go-sqlite3"

	"github.com/andybarilla/janushc-dash/internal/auth"
	"github.com/andybarilla/janushc-dash/internal/database"
)

const testTenantID = "11111111-1111-1111-1111-111111111111"
const testUserID = "22222222-2222-2222-2222-222222222222"
const createdUserID = "33333333-3333-3333-3333-333333333333"

type recordingDB struct {
	*sql.DB
	queryArgs    []interface{}
	queryRowArgs []interface{}
}

func (db *recordingDB) QueryContext(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error) {
	db.queryArgs = args
	return db.DB.QueryContext(ctx, query, args...)
}

func (db *recordingDB) QueryRowContext(ctx context.Context, query string, args ...interface{}) *sql.Row {
	db.queryRowArgs = args
	return db.DB.QueryRowContext(ctx, query, args...)
}

func TestHandleCreateValidRequestNormalizesEmailAndTrimsName(t *testing.T) {
	tenantUUID := mustUUID(t, testTenantID)
	db := openUsersHandlerTestDB(t)
	defer db.Close()
	handler := NewHandler(database.New(db), "JANUSHC.COM ")

	body := `{"email":"  JANE@JANUSHC.COM  ","name":"  Jane User  ","role":"staff","tenant_id":"99999999-9999-9999-9999-999999999999"}`
	response := httptest.NewRecorder()
	handler.HandleCreate(response, requestWithClaims(http.MethodPost, "/api/users", body))

	if response.Code != http.StatusCreated {
		t.Fatalf("expected status %d, got %d: %s", http.StatusCreated, response.Code, response.Body.String())
	}
	if len(db.queryRowArgs) != 4 {
		t.Fatalf("expected 4 query args, got %d", len(db.queryRowArgs))
	}
	if got := db.queryRowArgs[0].(pgtype.UUID); got != tenantUUID {
		t.Fatalf("expected tenant from claims, got %#v", got)
	}
	if got := db.queryRowArgs[1].(string); got != "jane@janushc.com" {
		t.Fatalf("expected normalized email, got %q", got)
	}
	if got := db.queryRowArgs[2].(string); got != "staff" {
		t.Fatalf("expected role, got %q", got)
	}
	if got := db.queryRowArgs[3].(string); got != "Jane User" {
		t.Fatalf("expected trimmed name, got %q", got)
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	assertSafeUserResponse(t, payload)
	if payload["id"] != createdUserID || payload["email"] != "jane@janushc.com" || payload["name"] != "Jane User" || payload["role"] != "staff" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestHandleCreateRejectsDisplayNameEmail(t *testing.T) {
	response, db := performCreate(t, "janushc.com", `{"email":"Jane <jane@janushc.com>","name":"Jane User","role":"staff"}`)

	assertStatus(t, response, http.StatusBadRequest)
	assertCreateNotCalled(t, db)
}

func TestHandleCreateRejectsWrongDomainWhenConfigured(t *testing.T) {
	response, db := performCreate(t, " janushc.com ", `{"email":"jane@example.com","name":"Jane User","role":"staff"}`)

	assertStatus(t, response, http.StatusBadRequest)
	if got := strings.TrimSpace(response.Body.String()); got != "email domain is not allowed" {
		t.Fatalf("expected domain error, got %q", got)
	}
	assertCreateNotCalled(t, db)
}

func TestHandleCreateAllowsAnyDomainWhenConfigEmpty(t *testing.T) {
	response, db := performCreate(t, "", `{"email":"Jane@Example.com","name":"Jane User","role":"staff"}`)

	assertStatus(t, response, http.StatusCreated)
	if got := db.queryRowArgs[1].(string); got != "jane@example.com" {
		t.Fatalf("expected normalized email, got %q", got)
	}
}

func TestHandleCreateRejectsSyntacticallyInvalidEmail(t *testing.T) {
	response, db := performCreate(t, "janushc.com", `{"email":"not-an-email","name":"Jane User","role":"staff"}`)

	assertStatus(t, response, http.StatusBadRequest)
	assertCreateNotCalled(t, db)
}

func TestHandleCreateRejectsInvalidRole(t *testing.T) {
	response, db := performCreate(t, "janushc.com", `{"email":"jane@janushc.com","name":"Jane User","role":"owner"}`)

	assertStatus(t, response, http.StatusBadRequest)
	assertCreateNotCalled(t, db)
}

func TestHandleCreateRejectsEmptyName(t *testing.T) {
	response, db := performCreate(t, "janushc.com", `{"email":"jane@janushc.com","name":"   ","role":"staff"}`)

	assertStatus(t, response, http.StatusBadRequest)
	assertCreateNotCalled(t, db)
}

func TestHandleCreateRejectsEmptyEmail(t *testing.T) {
	response, db := performCreate(t, "janushc.com", `{"email":"   ","name":"Jane User","role":"staff"}`)

	assertStatus(t, response, http.StatusBadRequest)
	assertCreateNotCalled(t, db)
}

func TestHandleCreateDuplicateEmailReturnsConflict(t *testing.T) {
	db := openUsersHandlerTestDB(t)
	defer db.Close()
	seedHandlerTestUser(t, db, "jane@janushc.com")
	handler := NewHandler(database.New(db), "janushc.com")
	response := httptest.NewRecorder()

	handler.HandleCreate(response, requestWithClaims(http.MethodPost, "/api/users", `{"email":"jane@janushc.com","name":"Jane User","role":"staff"}`))

	assertStatus(t, response, http.StatusConflict)
	if got := strings.TrimSpace(response.Body.String()); got != "user already exists" {
		t.Fatalf("expected duplicate error, got %q", got)
	}
}

func TestHandleCreateRejectsNilClaims(t *testing.T) {
	db := openUsersHandlerTestDB(t)
	defer db.Close()
	handler := NewHandler(database.New(db), "janushc.com")
	response := httptest.NewRecorder()

	handler.HandleCreate(response, requestWithClaimsValue(http.MethodPost, "/api/users", `{"email":"jane@janushc.com","name":"Jane User","role":"staff"}`, nil))

	assertStatus(t, response, http.StatusUnauthorized)
	assertCreateNotCalled(t, db)
}

func TestHandleCreateRejectsInvalidTenantContext(t *testing.T) {
	db := openUsersHandlerTestDB(t)
	defer db.Close()
	handler := NewHandler(database.New(db), "janushc.com")
	response := httptest.NewRecorder()
	claims := &auth.Claims{UserID: testUserID, TenantID: "not-a-uuid", Role: "admin"}

	handler.HandleCreate(response, requestWithClaimsValue(http.MethodPost, "/api/users", `{"email":"jane@janushc.com","name":"Jane User","role":"staff"}`, claims))

	assertStatus(t, response, http.StatusBadRequest)
	assertCreateNotCalled(t, db)
}

func TestHandleListRejectsNilClaims(t *testing.T) {
	db := openUsersHandlerTestDB(t)
	defer db.Close()
	handler := NewHandler(database.New(db), "janushc.com")
	response := httptest.NewRecorder()

	handler.HandleList(response, requestWithClaimsValue(http.MethodGet, "/api/users", "", nil))

	assertStatus(t, response, http.StatusUnauthorized)
	assertListNotCalled(t, db)
}

func TestHandleListRejectsInvalidTenantContext(t *testing.T) {
	db := openUsersHandlerTestDB(t)
	defer db.Close()
	handler := NewHandler(database.New(db), "janushc.com")
	response := httptest.NewRecorder()
	claims := &auth.Claims{UserID: testUserID, TenantID: "not-a-uuid", Role: "admin"}

	handler.HandleList(response, requestWithClaimsValue(http.MethodGet, "/api/users", "", claims))

	assertStatus(t, response, http.StatusBadRequest)
	assertListNotCalled(t, db)
}

func TestHandleListReturnsOnlySafeUserFields(t *testing.T) {
	tenantUUID := mustUUID(t, testTenantID)
	db := openUsersHandlerTestDB(t)
	defer db.Close()
	seedHandlerTestUser(t, db, "jane@janushc.com")
	handler := NewHandler(database.New(db), "janushc.com")
	response := httptest.NewRecorder()

	handler.HandleList(response, requestWithClaims(http.MethodGet, "/api/users", ""))

	assertStatus(t, response, http.StatusOK)
	if len(db.queryArgs) != 1 || db.queryArgs[0].(pgtype.UUID) != tenantUUID {
		t.Fatalf("expected tenant query arg from claims, got %#v", db.queryArgs)
	}
	var payload []map[string]interface{}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload) != 1 {
		t.Fatalf("expected one user, got %d", len(payload))
	}
	assertSafeUserResponse(t, payload[0])
	if payload[0]["email"] != "jane@janushc.com" {
		t.Fatalf("unexpected payload: %#v", payload[0])
	}
}

func performCreate(t *testing.T, allowedDomain string, body string) (*httptest.ResponseRecorder, *recordingDB) {
	t.Helper()
	db := openUsersHandlerTestDB(t)
	t.Cleanup(func() { db.Close() })
	handler := NewHandler(database.New(db), allowedDomain)
	response := httptest.NewRecorder()
	handler.HandleCreate(response, requestWithClaims(http.MethodPost, "/api/users", body))
	return response, db
}

func openUsersHandlerTestDB(t *testing.T) *recordingDB {
	t.Helper()

	sqlDB, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}

	_, err = sqlDB.Exec(`
		CREATE TABLE users (
			id UUID PRIMARY KEY DEFAULT '33333333-3333-3333-3333-333333333333',
			tenant_id UUID NOT NULL,
			email TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL DEFAULT '',
			role TEXT NOT NULL,
			name TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT '2026-05-14 12:30:00+00:00',
			updated_at TIMESTAMPTZ NOT NULL DEFAULT '2026-05-14 12:30:00+00:00'
		);
	`)
	if err != nil {
		sqlDB.Close()
		t.Fatalf("create sqlite users schema: %v", err)
	}

	return &recordingDB{DB: sqlDB}
}

func seedHandlerTestUser(t *testing.T, db *recordingDB, email string) {
	t.Helper()

	_, err := db.ExecContext(context.Background(), `
		INSERT INTO users (id, tenant_id, email, password_hash, role, name, created_at, updated_at)
		VALUES (?1, ?2, ?3, '', 'staff', 'Jane User', '2026-05-14 12:30:00+00:00', '2026-05-14 12:30:00+00:00')
	`, createdUserID, testTenantID, email)
	if err != nil {
		t.Fatalf("seed sqlite user: %v", err)
	}
}

func requestWithClaims(method string, target string, body string) *http.Request {
	claims := &auth.Claims{UserID: testUserID, TenantID: testTenantID, Role: "admin"}
	return requestWithClaimsValue(method, target, body, claims)
}

func requestWithClaimsValue(method string, target string, body string, claims *auth.Claims) *http.Request {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	return request.WithContext(auth.NewContext(request.Context(), claims))
}

func mustUUID(t *testing.T, value string) pgtype.UUID {
	t.Helper()
	uuid := pgtype.UUID{}
	if err := uuid.Scan(value); err != nil {
		t.Fatalf("parse uuid %q: %v", value, err)
	}
	return uuid
}

func assertStatus(t *testing.T, response *httptest.ResponseRecorder, want int) {
	t.Helper()
	if response.Code != want {
		t.Fatalf("expected status %d, got %d: %s", want, response.Code, response.Body.String())
	}
}

func assertCreateNotCalled(t *testing.T, db *recordingDB) {
	t.Helper()
	if len(db.queryRowArgs) != 0 {
		t.Fatalf("expected create not to be called, got args %#v", db.queryRowArgs)
	}
}

func assertListNotCalled(t *testing.T, db *recordingDB) {
	t.Helper()
	if len(db.queryArgs) != 0 {
		t.Fatalf("expected list not to be called, got args %#v", db.queryArgs)
	}
}

func assertSafeUserResponse(t *testing.T, payload map[string]interface{}) {
	t.Helper()
	for _, field := range []string{"id", "email", "name", "role", "created_at"} {
		if _, ok := payload[field]; !ok {
			t.Fatalf("expected response field %q in %#v", field, payload)
		}
	}
	for _, field := range []string{"password_hash", "mfa_secret", "mfa_enabled", "tenant_id"} {
		if _, ok := payload[field]; ok {
			t.Fatalf("unexpected unsafe field %q in %#v", field, payload)
		}
	}
}
