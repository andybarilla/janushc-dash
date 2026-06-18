package transcriptimport

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	_ "time/tzdata"
)

var ErrRecorderTimezoneUnavailable = errors.New("recorder timezone unavailable")

var loadLocation = time.LoadLocation

var (
	recorderFilenamePattern = regexp.MustCompile(`^([A-Z][a-z]+) ([0-9]{1,2}) at ([0-9]{1,2})-([0-9]{2}) ([AP]M)\.txt$`)
	recorderSlugPattern     = regexp.MustCompile(`^([a-z]+)-([0-9]{1,2})-at-([0-9]{1,2})-([0-9]{2})-([ap]m)$`)
)

func ParseGoogleRecorderTimestamp(filename string, now time.Time) (time.Time, bool, error) {
	matches := recorderFilenamePattern.FindStringSubmatch(filename)
	if matches == nil {
		return time.Time{}, false, nil
	}

	return parseRecorderTimestampParts(matches[1], matches[2], matches[3], matches[4], matches[5], now)
}

func ParseGoogleRecorderTimestampSlug(encounterID string, prefix string, now time.Time) (time.Time, bool, error) {
	if !strings.HasPrefix(encounterID, prefix) {
		return time.Time{}, false, nil
	}

	slug := strings.TrimPrefix(encounterID, prefix)
	matches := recorderSlugPattern.FindStringSubmatch(slug)
	if matches == nil {
		return time.Time{}, false, nil
	}

	month := strings.ToUpper(matches[1][:1]) + matches[1][1:]
	ampm := strings.ToUpper(matches[5])
	return parseRecorderTimestampParts(month, matches[2], matches[3], matches[4], ampm, now)
}

func parseRecorderTimestampParts(month, day, hour, minute, ampm string, now time.Time) (time.Time, bool, error) {
	text := fmt.Sprintf("%s %s %s-%s %s %d", month, day, hour, minute, ampm, now.Year())
	parsed, ok := parseRecorderTimestampText(text)
	if !ok {
		return time.Time{}, false, nil
	}

	location, err := loadLocation("America/Denver")
	if err != nil {
		return time.Time{}, false, fmt.Errorf("%w: America/Denver: %v", ErrRecorderTimezoneUnavailable, err)
	}

	return time.Date(parsed.Year(), parsed.Month(), parsed.Day(), parsed.Hour(), parsed.Minute(), 0, 0, location), true, nil
}

func parseRecorderTimestampText(text string) (time.Time, bool) {
	for _, layout := range []string{"January 2 3-04 PM 2006", "Jan 2 3-04 PM 2006"} {
		parsed, err := time.Parse(layout, text)
		if err == nil {
			return parsed, true
		}
	}

	return time.Time{}, false
}
