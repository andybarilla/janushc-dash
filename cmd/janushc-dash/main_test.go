package main

import "testing"

func TestFormatDuplicateNormalizedEmails(t *testing.T) {
	duplicates := []duplicateNormalizedEmail{
		{normalizedEmail: "admin@example.com", userCount: 2},
		{normalizedEmail: "staff@example.com", userCount: 3},
	}

	got := formatDuplicateNormalizedEmails(duplicates)
	want := "admin@example.com (2 users), staff@example.com (3 users)"
	if got != want {
		t.Fatalf("formatDuplicateNormalizedEmails() = %q, want %q", got, want)
	}
}
