package transcriptimport

import (
	"errors"
	"testing"
	"time"
)

func TestParseGoogleRecorderTimestamp(t *testing.T) {
	now := time.Date(2026, time.June, 18, 12, 0, 0, 0, time.UTC)
	got, ok, err := ParseGoogleRecorderTimestamp("May 28 at 3-37 PM.txt", now)
	if err != nil {
		t.Fatalf("ParseGoogleRecorderTimestamp() error = %v", err)
	}
	if !ok {
		t.Fatal("ParseGoogleRecorderTimestamp() ok = false, want true")
	}
	loc, err := time.LoadLocation("America/Denver")
	if err != nil {
		t.Fatalf("load America/Denver: %v", err)
	}
	want := time.Date(2026, time.May, 28, 15, 37, 0, 0, loc)
	if !got.Equal(want) {
		t.Fatalf("ParseGoogleRecorderTimestamp() = %v, want %v", got, want)
	}
}

func TestParseGoogleRecorderTimestampNonMatch(t *testing.T) {
	got, ok, err := ParseGoogleRecorderTimestamp("regular-note.txt", time.Date(2026, time.June, 18, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("ParseGoogleRecorderTimestamp() error = %v", err)
	}
	if ok {
		t.Fatal("ParseGoogleRecorderTimestamp() ok = true, want false")
	}
	if !got.IsZero() {
		t.Fatalf("ParseGoogleRecorderTimestamp() = %v, want zero time", got)
	}
}

func TestParseGoogleRecorderTimestampParseFailureIsNonFatal(t *testing.T) {
	got, ok, err := ParseGoogleRecorderTimestamp("May 99 at 3-37 PM.txt", time.Date(2026, time.June, 18, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("ParseGoogleRecorderTimestamp() error = %v", err)
	}
	if ok {
		t.Fatal("ParseGoogleRecorderTimestamp() ok = true, want false")
	}
	if !got.IsZero() {
		t.Fatalf("ParseGoogleRecorderTimestamp() = %v, want zero time", got)
	}
}

func TestParseGoogleRecorderTimestampTimezoneUnavailable(t *testing.T) {
	originalLoadLocation := loadLocation
	t.Cleanup(func() { loadLocation = originalLoadLocation })
	sentinel := errors.New("tzdata missing")
	loadLocation = func(name string) (*time.Location, error) {
		if name != "America/Denver" {
			t.Fatalf("loadLocation() name = %q, want America/Denver", name)
		}
		return nil, sentinel
	}

	got, ok, err := ParseGoogleRecorderTimestamp("May 28 at 3-37 PM.txt", time.Date(2026, time.June, 18, 0, 0, 0, 0, time.UTC))
	if !errors.Is(err, ErrRecorderTimezoneUnavailable) {
		t.Fatalf("ParseGoogleRecorderTimestamp() error = %v, want ErrRecorderTimezoneUnavailable", err)
	}
	if ok {
		t.Fatal("ParseGoogleRecorderTimestamp() ok = true, want false")
	}
	if !got.IsZero() {
		t.Fatalf("ParseGoogleRecorderTimestamp() = %v, want zero time", got)
	}
}

func TestParseGoogleRecorderTimestampSlug(t *testing.T) {
	loc, err := time.LoadLocation("America/Denver")
	if err != nil {
		t.Fatalf("load America/Denver: %v", err)
	}

	tests := []struct {
		name        string
		encounterID string
		now         time.Time
		want        time.Time
	}{
		{
			name:        "may slug",
			encounterID: "demo-encounter-may-28-at-3-37-pm",
			now:         time.Date(2026, time.June, 18, 12, 0, 0, 0, time.UTC),
			want:        time.Date(2026, time.May, 28, 15, 37, 0, 0, loc),
		},
		{
			name:        "april abbreviation slug",
			encounterID: "demo-encounter-apr-14-at-1-26-pm",
			now:         time.Date(2026, time.June, 18, 12, 0, 0, 0, time.UTC),
			want:        time.Date(2026, time.April, 14, 13, 26, 0, 0, loc),
		},
		{
			name:        "june abbreviation slug",
			encounterID: "demo-encounter-jun-1-at-2-04-pm",
			now:         time.Date(2026, time.June, 18, 12, 0, 0, 0, time.UTC),
			want:        time.Date(2026, time.June, 1, 14, 4, 0, 0, loc),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok, err := ParseGoogleRecorderTimestampSlug(tt.encounterID, "demo-encounter-", tt.now)
			if err != nil {
				t.Fatalf("ParseGoogleRecorderTimestampSlug() error = %v", err)
			}
			if !ok {
				t.Fatal("ParseGoogleRecorderTimestampSlug() ok = false, want true")
			}
			if !got.Equal(tt.want) {
				t.Fatalf("ParseGoogleRecorderTimestampSlug() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestParseGoogleRecorderTimestampSlugTimezoneUnavailable(t *testing.T) {
	originalLoadLocation := loadLocation
	t.Cleanup(func() { loadLocation = originalLoadLocation })
	sentinel := errors.New("tzdata missing")
	loadLocation = func(name string) (*time.Location, error) {
		if name != "America/Denver" {
			t.Fatalf("loadLocation() name = %q, want America/Denver", name)
		}
		return nil, sentinel
	}

	got, ok, err := ParseGoogleRecorderTimestampSlug("demo-encounter-may-28-at-3-37-pm", "demo-encounter-", time.Date(2026, time.June, 18, 0, 0, 0, 0, time.UTC))
	if !errors.Is(err, ErrRecorderTimezoneUnavailable) {
		t.Fatalf("ParseGoogleRecorderTimestampSlug() error = %v, want ErrRecorderTimezoneUnavailable", err)
	}
	if ok {
		t.Fatal("ParseGoogleRecorderTimestampSlug() ok = true, want false")
	}
	if !got.IsZero() {
		t.Fatalf("ParseGoogleRecorderTimestampSlug() = %v, want zero time", got)
	}
}
