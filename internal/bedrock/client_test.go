package bedrock

import "testing"

func TestParseCompletionResultPreservesUsage(t *testing.T) {
	body := []byte(`{
		"content": [{"type": "text", "text": "{\"hpi\":\"ok\"}"}],
		"usage": {"input_tokens": 123, "output_tokens": 45}
	}`)

	result, err := parseCompletionResult(body, "anthropic.claude-test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Text != `{"hpi":"ok"}` {
		t.Fatalf("unexpected text: %s", result.Text)
	}
	if result.ModelID != "anthropic.claude-test" {
		t.Fatalf("unexpected model ID: %s", result.ModelID)
	}
	if result.InputTokens != 123 {
		t.Fatalf("unexpected input tokens: %d", result.InputTokens)
	}
	if result.OutputTokens != 45 {
		t.Fatalf("unexpected output tokens: %d", result.OutputTokens)
	}
}
