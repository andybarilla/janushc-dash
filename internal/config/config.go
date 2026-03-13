package config

import (
	"fmt"
	"os"
	"time"
)

type Config struct {
	Port                string
	DatabaseURL         string
	JWTSecret           string
	JWTExpiry           time.Duration
	RefreshTokenExpiry  time.Duration
	CORSOrigin          string
	AthenaClientID      string
	AthenaClientSecret  string
	AthenaBaseURL       string
	AthenaPracticeID    string
	AWSRegion           string
	BedrockModelID      string
}

func Load() (*Config, error) {
	jwtExpiry, err := time.ParseDuration(getEnv("JWT_EXPIRY", "15m"))
	if err != nil {
		return nil, fmt.Errorf("invalid JWT_EXPIRY: %w", err)
	}
	refreshExpiry, err := time.ParseDuration(getEnv("REFRESH_TOKEN_EXPIRY", "168h"))
	if err != nil {
		return nil, fmt.Errorf("invalid REFRESH_TOKEN_EXPIRY: %w", err)
	}

	dbURL, err := requireEnv("DATABASE_URL")
	if err != nil {
		return nil, err
	}
	jwtSecret, err := requireEnv("JWT_SECRET")
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		Port:               getEnv("PORT", "8080"),
		DatabaseURL:        dbURL,
		JWTSecret:          jwtSecret,
		JWTExpiry:          jwtExpiry,
		RefreshTokenExpiry: refreshExpiry,
		CORSOrigin:         getEnv("CORS_ORIGIN", "http://localhost:3000"),
		AthenaClientID:     getEnv("ATHENA_CLIENT_ID", ""),
		AthenaClientSecret: getEnv("ATHENA_CLIENT_SECRET", ""),
		AthenaBaseURL:      getEnv("ATHENA_BASE_URL", "https://api.preview.platform.athenahealth.com"),
		AthenaPracticeID:   getEnv("ATHENA_PRACTICE_ID", "195900"),
		AWSRegion:          getEnv("AWS_REGION", "us-east-1"),
		BedrockModelID:     getEnv("AWS_BEDROCK_MODEL_ID", "anthropic.claude-sonnet-4-20250514"),
	}
	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func requireEnv(key string) (string, error) {
	v := os.Getenv(key)
	if v == "" {
		return "", fmt.Errorf("required environment variable %s is not set", key)
	}
	return v, nil
}
