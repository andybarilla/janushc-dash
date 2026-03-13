package auth

import "testing"

func TestHashPassword(t *testing.T) {
	hash, err := HashPassword("test-password")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if hash == "" {
		t.Fatal("hash should not be empty")
	}
	if hash == "test-password" {
		t.Fatal("hash should not equal plaintext")
	}
}

func TestCheckPassword(t *testing.T) {
	hash, _ := HashPassword("correct-password")

	if !CheckPassword("correct-password", hash) {
		t.Fatal("expected correct password to match")
	}
	if CheckPassword("wrong-password", hash) {
		t.Fatal("expected wrong password to not match")
	}
}
