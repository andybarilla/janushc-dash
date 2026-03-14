package athena

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientGetToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/v1/token" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"access_token":"test-token","expires_in":3600}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := NewClient(server.URL, "client-id", "client-secret")
	token, err := client.getToken()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if token != "test-token" {
		t.Errorf("expected test-token, got %s", token)
	}
}
