package auth

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andybarilla/emrai/internal/database"
)

type Handler struct {
	queries   *database.Queries
	jwtSecret string
	jwtExpiry time.Duration
}

func NewHandler(queries *database.Queries, jwtSecret string, jwtExpiry time.Duration) *Handler {
	return &Handler{
		queries:   queries,
		jwtSecret: jwtSecret,
		jwtExpiry: jwtExpiry,
	}
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	TenantID string `json:"tenant_id"`
}

type loginResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
}

func (h *Handler) HandleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	tenantUUID := pgtype.UUID{}
	if err := tenantUUID.Scan(req.TenantID); err != nil {
		http.Error(w, "invalid tenant_id", http.StatusBadRequest)
		return
	}

	user, err := h.queries.GetUserByEmail(r.Context(), database.GetUserByEmailParams{
		TenantID: tenantUUID,
		Email:    req.Email,
	})
	if err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	if !CheckPassword(req.Password, user.PasswordHash) {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	userID := uuidToString(user.ID)
	tenantID := uuidToString(user.TenantID)

	token, err := CreateAccessToken(userID, tenantID, user.Role, h.jwtSecret, h.jwtExpiry)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(loginResponse{
		AccessToken: token,
		ExpiresIn:   int(h.jwtExpiry.Seconds()),
	})
}

func uuidToString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x", u.Bytes[0:4], u.Bytes[4:6], u.Bytes[6:8], u.Bytes[8:10], u.Bytes[10:16])
}
