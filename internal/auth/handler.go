package auth

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andybarilla/janushc-dash/internal/database"
)

type Handler struct {
	queries   *database.Queries
	google    *GoogleVerifier
	jwtSecret string
	jwtExpiry time.Duration
}

func NewHandler(queries *database.Queries, google *GoogleVerifier, jwtSecret string, jwtExpiry time.Duration) *Handler {
	return &Handler{
		queries:   queries,
		google:    google,
		jwtSecret: jwtSecret,
		jwtExpiry: jwtExpiry,
	}
}

type googleLoginRequest struct {
	IDToken string `json:"id_token"`
}

type loginResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
}

func (h *Handler) HandleGoogleLogin(w http.ResponseWriter, r *http.Request) {
	var req googleLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	info, err := h.google.Verify(req.IDToken)
	if err != nil {
		http.Error(w, "invalid google token: "+err.Error(), http.StatusUnauthorized)
		return
	}

	user, err := h.queries.GetUserByEmailOnly(r.Context(), info.Email)
	if err != nil {
		http.Error(w, "not registered", http.StatusForbidden)
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

type meResponse struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
	Role  string `json:"role"`
}

func (h *Handler) HandleMe(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFromContext(r.Context())
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	userUUID := pgtype.UUID{}
	if err := userUUID.Scan(claims.UserID); err != nil {
		http.Error(w, "invalid user context", http.StatusBadRequest)
		return
	}

	user, err := h.queries.GetUserByID(r.Context(), userUUID)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(meResponse{
		ID:    uuidToString(user.ID),
		Email: user.Email,
		Name:  user.Name,
		Role:  user.Role,
	})
}

func uuidToString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x", u.Bytes[0:4], u.Bytes[4:6], u.Bytes[6:8], u.Bytes[8:10], u.Bytes[10:16])
}
