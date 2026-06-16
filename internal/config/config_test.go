package config

import "testing"

func TestLoadUsesValidBedrockDefault(t *testing.T) {
	t.Setenv("DATABASE_URL", "tmp/test.db")
	t.Setenv("JWT_SECRET", "test-secret")
	t.Setenv("AWS_BEDROCK_MODEL_ID", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.BedrockModelID != defaultBedrockModelID {
		t.Fatalf("BedrockModelID = %q, want %q", cfg.BedrockModelID, defaultBedrockModelID)
	}
}

func TestLoadUsesConfiguredBedrockModelID(t *testing.T) {
	t.Setenv("DATABASE_URL", "tmp/test.db")
	t.Setenv("JWT_SECRET", "test-secret")
	t.Setenv("AWS_BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-20250514-v1:0")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.BedrockModelID != "us.anthropic.claude-sonnet-4-20250514-v1:0" {
		t.Fatalf("BedrockModelID = %q", cfg.BedrockModelID)
	}
}
