package transcribe

import (
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/transcribestreaming/types"
)

func TestAppendMedicalAlternativeTranscript_WithSpeakerLabels(t *testing.T) {
	alt := types.MedicalAlternative{
		Items: []types.MedicalItem{
			{Content: strPtr("How"), Speaker: strPtr("spk_0"), Type: types.ItemTypePronunciation},
			{Content: strPtr("are"), Speaker: strPtr("spk_0"), Type: types.ItemTypePronunciation},
			{Content: strPtr("you"), Speaker: strPtr("spk_0"), Type: types.ItemTypePronunciation},
			{Content: strPtr("?"), Type: types.ItemTypePunctuation},
			{Content: strPtr("Fine"), Speaker: strPtr("spk_1"), Type: types.ItemTypePronunciation},
			{Content: strPtr("."), Type: types.ItemTypePunctuation},
		},
	}

	var b strings.Builder
	appendMedicalAlternativeTranscript(&b, alt)

	want := "Speaker 0: How are you?\nSpeaker 1: Fine."
	if got := b.String(); got != want {
		t.Fatalf("unexpected transcript:\nwant: %q\n got: %q", want, got)
	}
}

func TestAppendMedicalAlternativeTranscript_FallbackTranscript(t *testing.T) {
	text := "One plain transcript segment."
	alt := types.MedicalAlternative{Transcript: &text}

	var b strings.Builder
	appendMedicalAlternativeTranscript(&b, alt)

	if got := b.String(); got != text {
		t.Fatalf("unexpected transcript: %q", got)
	}
}

func strPtr(s string) *string { return &s }
