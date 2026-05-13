package transcribe

import "testing"

func TestExtractBatchTranscriptTextWithSpeakerLabels(t *testing.T) {
	data := []byte(`{
		"results": {
			"transcripts": [{"transcript": "hello there. how are you?"}],
			"speaker_labels": {
				"segments": [{"items": [
					{"start_time": "0.00", "end_time": "0.50", "speaker_label": "spk_0"},
					{"start_time": "0.60", "end_time": "1.10", "speaker_label": "spk_0"},
					{"start_time": "1.20", "end_time": "1.70", "speaker_label": "spk_1"},
					{"start_time": "1.80", "end_time": "2.30", "speaker_label": "spk_1"}
				]}]
			},
			"items": [
				{"type": "pronunciation", "start_time": "0.00", "alternatives": [{"content": "hello"}]},
				{"type": "pronunciation", "start_time": "0.60", "alternatives": [{"content": "there"}]},
				{"type": "punctuation", "alternatives": [{"content": "."}]},
				{"type": "pronunciation", "start_time": "1.20", "alternatives": [{"content": "how"}]},
				{"type": "pronunciation", "start_time": "1.80", "alternatives": [{"content": "are"}]},
				{"type": "pronunciation", "start_time": "2.40", "speaker_label": "spk_1", "alternatives": [{"content": "you"}]},
				{"type": "punctuation", "alternatives": [{"content": "?"}]}
			]
		}
	}`)

	got, err := ExtractBatchTranscriptText(data)
	if err != nil {
		t.Fatalf("ExtractBatchTranscriptText returned error: %v", err)
	}
	want := "Speaker 0: hello there.\nSpeaker 1: how are you?"
	if got != want {
		t.Fatalf("transcript mismatch\nwant: %q\n got: %q", want, got)
	}
}

func TestExtractBatchTranscriptTextFallsBackToPlainTranscript(t *testing.T) {
	data := []byte(`{"results":{"transcripts":[{"transcript":"plain transcript"}]}}`)

	got, err := ExtractBatchTranscriptText(data)
	if err != nil {
		t.Fatalf("ExtractBatchTranscriptText returned error: %v", err)
	}
	if got != "plain transcript" {
		t.Fatalf("got %q", got)
	}
}

func TestMediaFormatForExtension(t *testing.T) {
	got, err := MediaFormatForExtension(".m4a")
	if err != nil {
		t.Fatalf("MediaFormatForExtension returned error: %v", err)
	}
	if string(got) != "m4a" {
		t.Fatalf("got %q", got)
	}
}
