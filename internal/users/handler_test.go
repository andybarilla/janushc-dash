package users

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andybarilla/janushc-dash/internal/auth"
	"github.com/andybarilla/janushc-dash/internal/database"
)

const testTenantID = "11111111-1111-1111-1111-111111111111"
const testUserID = "22222222-2222-2222-2222-222222222222"
const createdUserID = "33333333-3333-3333-3333-333333333333"

type fakeDB struct {
	queryArgs    []interface{}
	queryRowArgs []interface{}
	row          pgx.Row
	rows         pgx.Rows
	queryErr     error
}

func (db *fakeDB) Exec(context.Context, string, ...interface{}) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}

func (db *fakeDB) Query(ctx context.Context, query string, args ...interface{}) (pgx.Rows, error) {
	db.queryArgs = args
	if db.queryErr != nil {
		return nil, db.queryErr
	}
	return db.rows, nil
}

func (db *fakeDB) QueryRow(ctx context.Context, query string, args ...interface{}) pgx.Row {
	db.queryRowArgs = args
	return db.row
}

type fakeRow struct {
	values []interface{}
	err    error
}

func (row *fakeRow) Scan(dest ...interface{}) error {
	if row.err != nil {
		return row.err
	}
	return scanValues(dest, row.values)
}

type fakeRows struct {
	values [][]interface{}
	index  int
	err    error
	closed bool
}

func newFakeRows(values [][]interface{}) *fakeRows {
	return &fakeRows{values: values, index: -1}
}

func (rows *fakeRows) Close() {
	rows.closed = true
}

func (rows *fakeRows) Err() error {
	return rows.err
}

func (rows *fakeRows) CommandTag() pgconn.CommandTag {
	return pgconn.CommandTag{}
}

func (rows *fakeRows) FieldDescriptions() []pgconn.FieldDescription {
	return nil
}

func (rows *fakeRows) Next() bool {
	if rows.index+1 >= len(rows.values) {
		rows.closed = true
		return false
	}
	rows.index++
	return true
}

func (rows *fakeRows) Scan(dest ...interface{}) error {
	return scanValues(dest, rows.values[rows.index])
}

func (rows *fakeRows) Values() ([]interface{}, error) {
	return rows.values[rows.index], nil
}

func (rows *fakeRows) RawValues() [][]byte {
	return nil
}

func (rows *fakeRows) Conn() *pgx.Conn {
	return nil
}

func scanValues(dest []interface{}, values []interface{}) error {
	if len(dest) != len(values) {
		return errors.New("scan destination count mismatch")
	}
	for i := range dest {
		switch target := dest[i].(type) {
		case *pgtype.UUID:
			value, ok := values[i].(pgtype.UUID)
			if !ok {
				return errors.New("expected pgtype.UUID")
			}
			*target = value
		case *pgtype.Timestamptz:
			value, ok := values[i].(pgtype.Timestamptz)
			if !ok {
				return errors.New("expected pgtype.Timestamptz")
			}
			*target = value
		case *string:
			value, ok := values[i].(string)
			if !ok {
				return errors.New("expected string")
			}
			*target = value
		default:
			return errors.New("unsupported scan destination")
		}
	}
	return nil
}

func TestHandleCreateValidRequestNormalizesEmailAndTrimsName(t *testing.T) {
	tenantUUID := mustUUID(t, testTenantID)
	createdUUID := mustUUID(t, createdUserID)
	createdAt := pgtype.Timestamptz{Time: time.Date(2026, 5, 14, 12, 30, 0, 0, time.UTC), Valid: true}
	db := &fakeDB{row: &fakeRow{values: []interface{}{
		createdUUID,
		tenantUUID,
		"jane@janushc.com",
		"staff",
		"Jane User",
		createdAt,
		createdAt,
	}}}
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
	db := &fakeDB{row: &fakeRow{err: &pgconn.PgError{Code: "23505"}}}
	handler := NewHandler(database.New(db), "janushc.com")
	response := httptest.NewRecorder()

	handler.HandleCreate(response, requestWithClaims(http.MethodPost, "/api/users", `{"email":"jane@janushc.com","name":"Jane User","role":"staff"}`))

	assertStatus(t, response, http.StatusConflict)
	if got := strings.TrimSpace(response.Body.String()); got != "user already exists" {
		t.Fatalf("expected duplicate error, got %q", got)
	}
}

func TestHandleListReturnsOnlySafeUserFields(t *testing.T) {
	tenantUUID := mustUUID(t, testTenantID)
	createdAt := pgtype.Timestamptz{Time: time.Date(2026, 5, 14, 12, 30, 0, 0, time.UTC), Valid: true}
	db := &fakeDB{rows: newFakeRows([][]interface{}{
		{mustUUID(t, createdUserID), tenantUUID, "jane@janushc.com", "staff", "Jane User", createdAt, createdAt},
	})}
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

func performCreate(t *testing.T, allowedDomain string, body string) (*httptest.ResponseRecorder, *fakeDB) {
	t.Helper()
	tenantUUID := mustUUID(t, testTenantID)
	createdUUID := mustUUID(t, createdUserID)
	createdAt := pgtype.Timestamptz{Time: time.Date(2026, 5, 14, 12, 30, 0, 0, time.UTC), Valid: true}
	db := &fakeDB{row: &fakeRow{values: []interface{}{
		createdUUID,
		tenantUUID,
		"jane@janushc.com",
		"staff",
		"Jane User",
		createdAt,
		createdAt,
	}}}
	handler := NewHandler(database.New(db), allowedDomain)
	response := httptest.NewRecorder()
	handler.HandleCreate(response, requestWithClaims(http.MethodPost, "/api/users", body))
	return response, db
}

func requestWithClaims(method string, target string, body string) *http.Request {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	claims := &auth.Claims{UserID: testUserID, TenantID: testTenantID, Role: "admin"}
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

func assertCreateNotCalled(t *testing.T, db *fakeDB) {
	t.Helper()
	if len(db.queryRowArgs) != 0 {
		t.Fatalf("expected create not to be called, got args %#v", db.queryRowArgs)
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
