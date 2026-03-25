package auth

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

const defaultTokenInfoURL = "https://oauth2.googleapis.com/tokeninfo"

type GoogleVerifier struct {
	clientID      string
	allowedDomain string
	tokenInfoURL  string
	httpClient    *http.Client
}

type GoogleTokenInfo struct {
	Email string
}

func NewGoogleVerifier(clientID, allowedDomain string) *GoogleVerifier {
	return &GoogleVerifier{
		clientID:      clientID,
		allowedDomain: allowedDomain,
		tokenInfoURL:  defaultTokenInfoURL,
		httpClient:    &http.Client{Timeout: 10 * time.Second},
	}
}

func (v *GoogleVerifier) Verify(idToken string) (*GoogleTokenInfo, error) {
	url := v.tokenInfoURL + "?id_token=" + idToken
	resp, err := v.httpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("google token verification request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("google token verification failed (status %d)", resp.StatusCode)
	}

	var claims struct {
		Aud           string `json:"aud"`
		Email         string `json:"email"`
		EmailVerified string `json:"email_verified"`
		HD            string `json:"hd"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&claims); err != nil {
		return nil, fmt.Errorf("decode google token: %w", err)
	}

	if claims.Aud != v.clientID {
		return nil, fmt.Errorf("token audience mismatch: got %s, want %s", claims.Aud, v.clientID)
	}
	if claims.EmailVerified != "true" {
		return nil, fmt.Errorf("email not verified")
	}
	if v.allowedDomain != "" && claims.HD != v.allowedDomain {
		return nil, fmt.Errorf("domain not allowed: got %q, want %q", claims.HD, v.allowedDomain)
	}

	return &GoogleTokenInfo{Email: claims.Email}, nil
}
