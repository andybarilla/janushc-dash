package users

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andybarilla/janushc-dash/internal/auth"
	"github.com/andybarilla/janushc-dash/internal/database"
)

type Handler struct {
	queries             *database.Queries
	googleAllowedDomain string
}

func NewHandler(queries *database.Queries, googleAllowedDomain string) *Handler {
	return &Handler{
		queries:             queries,
		googleAllowedDomain: strings.ToLower(strings.TrimSpace(googleAllowedDomain)),
	}
}

type createUserRequest struct {
	Email string `json:"email"`
	Name  string `json:"name"`
	Role  string `json:"role"`
}

type userResponse struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	CreatedAt string `json:"created_at"`
}

func (h *Handler) HandleList(w http.ResponseWriter, r *http.Request) {
	tenantUUID, ok := tenantUUIDFromRequest(w, r)
	if !ok {
		return
	}

	users, err := h.queries.ListUsersByTenant(r.Context(), tenantUUID)
	if err != nil {
		http.Error(w, "failed to list users", http.StatusInternalServerError)
		return
	}

	response := make([]userResponse, 0, len(users))
	for _, user := range users {
		response = append(response, userResponse{
			ID:        uuidToString(user.ID),
			Email:     user.Email,
			Name:      user.Name,
			Role:      user.Role,
			CreatedAt: formatTimestamptz(user.CreatedAt),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (h *Handler) HandleCreate(w http.ResponseWriter, r *http.Request) {
	tenantUUID, ok := tenantUUIDFromRequest(w, r)
	if !ok {
		return
	}

	var req createUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	normalizedEmail, trimmedName, role, err := h.validateCreateRequest(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	user, err := h.queries.CreateTenantUser(r.Context(), database.CreateTenantUserParams{
		TenantID: tenantUUID,
		Lower:    normalizedEmail,
		Role:     role,
		Name:     trimmedName,
	})
	if err != nil {
		if isUniqueViolation(err) {
			http.Error(w, "user already exists", http.StatusConflict)
			return
		}
		http.Error(w, "failed to create user", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(userResponse{
		ID:        uuidToString(user.ID),
		Email:     user.Email,
		Name:      user.Name,
		Role:      user.Role,
		CreatedAt: formatTimestamptz(user.CreatedAt),
	})
}

func (h *Handler) validateCreateRequest(req createUserRequest) (string, string, string, error) {
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" {
		return "", "", "", errors.New("email required")
	}
	address, err := mail.ParseAddress(email)
	if err != nil || address.Address != email {
		return "", "", "", errors.New("invalid email")
	}
	if h.googleAllowedDomain != "" && !strings.HasSuffix(email, "@"+h.googleAllowedDomain) {
		return "", "", "", errors.New("email domain is not allowed")
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		return "", "", "", errors.New("name required")
	}

	role := strings.TrimSpace(req.Role)
	if role != "admin" && role != "physician" && role != "staff" {
		return "", "", "", errors.New("invalid role")
	}

	return email, name, role, nil
}

func tenantUUIDFromRequest(w http.ResponseWriter, r *http.Request) (pgtype.UUID, bool) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return pgtype.UUID{}, false
	}

	tenantUUID := pgtype.UUID{}
	if err := tenantUUID.Scan(claims.TenantID); err != nil {
		http.Error(w, "invalid tenant context", http.StatusBadRequest)
		return pgtype.UUID{}, false
	}
	return tenantUUID, true
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func formatTimestamptz(value pgtype.Timestamptz) string {
	if !value.Valid {
		return ""
	}
	return value.Time.UTC().Format(time.RFC3339)
}

func uuidToString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x", u.Bytes[0:4], u.Bytes[4:6], u.Bytes[6:8], u.Bytes[8:10], u.Bytes[10:16])
}
