package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestVerifyGoogleToken_Valid(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{
			"aud": "test-client-id", "email": "doctor@janushc.com",
			"email_verified": "true", "hd": "janushc.com",
		})
	}))
	defer srv.Close()

	v := &GoogleVerifier{clientID: "test-client-id", allowedDomain: "janushc.com", tokenInfoURL: srv.URL, httpClient: srv.Client()}
	info, err := v.Verify("fake-token")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if info.Email != "doctor@janushc.com" {
		t.Errorf("expected doctor@janushc.com, got %s", info.Email)
	}
}

func TestVerifyGoogleToken_WrongDomain(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{
			"aud": "test-client-id", "email": "user@gmail.com",
			"email_verified": "true", "hd": "",
		})
	}))
	defer srv.Close()

	v := &GoogleVerifier{clientID: "test-client-id", allowedDomain: "janushc.com", tokenInfoURL: srv.URL, httpClient: srv.Client()}
	_, err := v.Verify("fake-token")
	if err == nil {
		t.Fatal("expected error for wrong domain")
	}
}

func TestVerifyGoogleToken_WrongAudience(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{
			"aud": "wrong-client-id", "email": "doctor@janushc.com",
			"email_verified": "true", "hd": "janushc.com",
		})
	}))
	defer srv.Close()

	v := &GoogleVerifier{clientID: "test-client-id", allowedDomain: "janushc.com", tokenInfoURL: srv.URL, httpClient: srv.Client()}
	_, err := v.Verify("fake-token")
	if err == nil {
		t.Fatal("expected error for wrong audience")
	}
}
