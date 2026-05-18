package config

import (
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

const defaultBedrockModelID = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"

type Config struct {
	Port                             string
	DatabaseURL                      string
	JWTSecret                        string
	JWTExpiry                        time.Duration
	RefreshTokenExpiry               time.Duration
	CORSOrigin                       string
	AthenaClientID                   string
	AthenaClientSecret               string
	AthenaBaseURL                    string
	AthenaPracticeID                 string
	AWSRegion                        string
	BedrockModelID                   string
	GoogleClientID                   string
	GoogleAllowedDomain              string
	ScribeAudioDir                   string
	AWSTranscribeBucket              string
	TranscribeMedicalUSDPerMinute    float64
	BedrockInputUSDPerMillionTokens  float64
	BedrockOutputUSDPerMillionTokens float64
}

func Load() (*Config, error) {
	// Load .env file if present (ignore error if not found)
	_ = godotenv.Load()

	jwtExpiry, err := time.ParseDuration(getEnv("JWT_EXPIRY", "8h"))
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
	transcribeMedicalUSDPerMinute, err := getEnvFloat("TRANSCRIBE_MEDICAL_USD_PER_MINUTE", 0.024)
	if err != nil {
		return nil, fmt.Errorf("invalid TRANSCRIBE_MEDICAL_USD_PER_MINUTE: %w", err)
	}
	bedrockInputUSDPerMillionTokens, err := getEnvFloat("BEDROCK_INPUT_USD_PER_MILLION_TOKENS", 3.00)
	if err != nil {
		return nil, fmt.Errorf("invalid BEDROCK_INPUT_USD_PER_MILLION_TOKENS: %w", err)
	}
	bedrockOutputUSDPerMillionTokens, err := getEnvFloat("BEDROCK_OUTPUT_USD_PER_MILLION_TOKENS", 15.00)
	if err != nil {
		return nil, fmt.Errorf("invalid BEDROCK_OUTPUT_USD_PER_MILLION_TOKENS: %w", err)
	}

	return &Config{
		Port:                             getEnv("PORT", "8080"),
		DatabaseURL:                      dbURL,
		JWTSecret:                        jwtSecret,
		JWTExpiry:                        jwtExpiry,
		RefreshTokenExpiry:               refreshExpiry,
		CORSOrigin:                       getEnv("CORS_ORIGIN", "http://localhost:3000"),
		AthenaClientID:                   getEnv("ATHENA_CLIENT_ID", ""),
		AthenaClientSecret:               getEnv("ATHENA_CLIENT_SECRET", ""),
		AthenaBaseURL:                    getEnv("ATHENA_BASE_URL", "https://api.preview.platform.athenahealth.com"),
		AthenaPracticeID:                 getEnv("ATHENA_PRACTICE_ID", "195900"),
		AWSRegion:                        getEnv("AWS_REGION", "us-east-1"),
		BedrockModelID:                   getEnv("AWS_BEDROCK_MODEL_ID", defaultBedrockModelID),
		GoogleClientID:                   getEnv("GOOGLE_CLIENT_ID", ""),
		GoogleAllowedDomain:              getEnv("GOOGLE_ALLOWED_DOMAIN", "janushc.com"),
		ScribeAudioDir:                   getEnv("SCRIBE_AUDIO_DIR", "tmp/scribe-audio"),
		AWSTranscribeBucket:              getEnv("AWS_TRANSCRIBE_BUCKET", ""),
		TranscribeMedicalUSDPerMinute:    transcribeMedicalUSDPerMinute,
		BedrockInputUSDPerMillionTokens:  bedrockInputUSDPerMillionTokens,
		BedrockOutputUSDPerMillionTokens: bedrockOutputUSDPerMillionTokens,
	}, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvFloat(key string, fallback float64) (float64, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	return strconv.ParseFloat(value, 64)
}

func requireEnv(key string) (string, error) {
	v := os.Getenv(key)
	if v == "" {
		return "", fmt.Errorf("required environment variable %s is not set", key)
	}
	return v, nil
}
