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

func TestExtractBatchTranscriptDurationSecondsReturnsMaxPronunciationEndTime(t *testing.T) {
	data := []byte(`{"results":{"items":[
		{"type":"pronunciation","start_time":"0.00","end_time":"1.25","alternatives":[{"content":"hello"}]},
		{"type":"pronunciation","start_time":"1.30","end_time":"2.75","alternatives":[{"content":"there"}]},
		{"type":"pronunciation","start_time":"2.80","end_time":"2.50","alternatives":[{"content":"again"}]}
	]}}`)

	got, ok, err := ExtractBatchTranscriptDurationSeconds(data)
	if err != nil {
		t.Fatalf("ExtractBatchTranscriptDurationSeconds returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected duration to be found")
	}
	if got != 2.75 {
		t.Fatalf("got %v", got)
	}
}

func TestExtractBatchTranscriptDurationSecondsIgnoresPunctuation(t *testing.T) {
	data := []byte(`{"results":{"items":[
		{"type":"pronunciation","start_time":"0.00","end_time":"1.25","alternatives":[{"content":"hello"}]},
		{"type":"punctuation","end_time":"9.99","alternatives":[{"content":"."}]}
	]}}`)

	got, ok, err := ExtractBatchTranscriptDurationSeconds(data)
	if err != nil {
		t.Fatalf("ExtractBatchTranscriptDurationSeconds returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected duration to be found")
	}
	if got != 1.25 {
		t.Fatalf("got %v", got)
	}
}

func TestExtractBatchTranscriptDurationSecondsIgnoresMalformedEndTime(t *testing.T) {
	data := []byte(`{"results":{"items":[
		{"type":"pronunciation","start_time":"0.00","end_time":"bad","alternatives":[{"content":"hello"}]},
		{"type":"pronunciation","start_time":"1.30","end_time":"2.75","alternatives":[{"content":"there"}]}
	]}}`)

	got, ok, err := ExtractBatchTranscriptDurationSeconds(data)
	if err != nil {
		t.Fatalf("ExtractBatchTranscriptDurationSeconds returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected duration to be found")
	}
	if got != 2.75 {
		t.Fatalf("got %v", got)
	}
}

func TestExtractBatchTranscriptDurationSecondsReturnsFalseWithoutDuration(t *testing.T) {
	data := []byte(`{"results":{"items":[
		{"type":"pronunciation","start_time":"0.00","alternatives":[{"content":"hello"}]},
		{"type":"punctuation","alternatives":[{"content":"."}]},
		{"type":"pronunciation","start_time":"1.30","end_time":"bad","alternatives":[{"content":"there"}]}
	]}}`)

	got, ok, err := ExtractBatchTranscriptDurationSeconds(data)
	if err != nil {
		t.Fatalf("ExtractBatchTranscriptDurationSeconds returned error: %v", err)
	}
	if ok {
		t.Fatal("expected duration not to be found")
	}
	if got != 0 {
		t.Fatalf("got %v", got)
	}
}

func TestExtractBatchTranscriptDurationSecondsReturnsErrorForInvalidJSON(t *testing.T) {
	_, ok, err := ExtractBatchTranscriptDurationSeconds([]byte(`{"results":`))
	if err == nil {
		t.Fatal("expected error")
	}
	if ok {
		t.Fatal("expected duration not to be found")
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
