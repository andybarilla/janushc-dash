package auth

import (
	"testing"
	"time"
)

func TestCreateAndValidateAccessToken(t *testing.T) {
	secret := "test-secret"
	expiry := 15 * time.Minute

	token, err := CreateAccessToken("user-123", "tenant-456", "physician", secret, expiry)
	if err != nil {
		t.Fatalf("unexpected error creating token: %v", err)
	}

	claims, err := ValidateAccessToken(token, secret)
	if err != nil {
		t.Fatalf("unexpected error validating token: %v", err)
	}

	if claims.UserID != "user-123" {
		t.Errorf("expected user ID user-123, got %s", claims.UserID)
	}
	if claims.TenantID != "tenant-456" {
		t.Errorf("expected tenant ID tenant-456, got %s", claims.TenantID)
	}
	if claims.Role != "physician" {
		t.Errorf("expected role physician, got %s", claims.Role)
	}
}

func TestExpiredTokenFails(t *testing.T) {
	secret := "test-secret"
	token, _ := CreateAccessToken("user-123", "tenant-456", "physician", secret, -1*time.Minute)

	_, err := ValidateAccessToken(token, secret)
	if err == nil {
		t.Fatal("expected error for expired token")
	}
}

func TestWrongSecretFails(t *testing.T) {
	token, _ := CreateAccessToken("user-123", "tenant-456", "physician", "secret-1", 15*time.Minute)

	_, err := ValidateAccessToken(token, "secret-2")
	if err == nil {
		t.Fatal("expected error for wrong secret")
	}
}
