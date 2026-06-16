package scribe

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"strconv"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andybarilla/janushc-dash/internal/database"
)

type usageEventCreator interface {
	CreateScribeUsageEvent(ctx context.Context, arg database.CreateScribeUsageEventParams) (database.ScribeUsageEvent, error)
}

type usageSummaryGetter interface {
	GetScribeUsageSummaryForSession(ctx context.Context, sessionID pgtype.UUID) (database.GetScribeUsageSummaryForSessionRow, error)
}

type TranscriptionCostEstimate struct {
	AudioDurationSeconds    float64
	BillableDurationSeconds int32
	EstimatedCostMicros     int64
}

type LLMCostEstimate struct {
	InputTokens         int32
	OutputTokens        int32
	TotalTokens         int32
	EstimatedCostMicros int64
}

func CalculateTranscriptionCost(audioDurationSeconds float64, usdPerMinute float64) TranscriptionCostEstimate {
	if audioDurationSeconds <= 0 || usdPerMinute <= 0 {
		return TranscriptionCostEstimate{AudioDurationSeconds: audioDurationSeconds}
	}

	billableDurationSeconds := int32(math.Ceil(audioDurationSeconds))
	estimatedCostMicros := int64(math.Round((float64(billableDurationSeconds) / 60.0) * usdPerMinute * 1_000_000.0))

	return TranscriptionCostEstimate{
		AudioDurationSeconds:    audioDurationSeconds,
		BillableDurationSeconds: billableDurationSeconds,
		EstimatedCostMicros:     estimatedCostMicros,
	}
}

func CalculateLLMCost(inputTokens int32, outputTokens int32, inputUSDPerMillion float64, outputUSDPerMillion float64) LLMCostEstimate {
	inputMicros := int64(math.Round((float64(inputTokens) / 1_000_000.0) * inputUSDPerMillion * 1_000_000.0))
	outputMicros := int64(math.Round((float64(outputTokens) / 1_000_000.0) * outputUSDPerMillion * 1_000_000.0))

	return LLMCostEstimate{
		InputTokens:         inputTokens,
		OutputTokens:        outputTokens,
		TotalTokens:         inputTokens + outputTokens,
		EstimatedCostMicros: inputMicros + outputMicros,
	}
}

func recordTranscriptionUsageEvent(ctx context.Context, q usageEventCreator, sessionID pgtype.UUID, jobName string, audioDurationSeconds float64, hasDuration bool, usdPerMinute float64) error {
	rateSnapshot, err := json.Marshal(map[string]string{"usd_per_minute": strconv.FormatFloat(usdPerMinute, 'f', -1, 64)})
	if err != nil {
		return err
	}
	metadata := []byte(`{}`)
	params := database.CreateScribeUsageEventParams{
		SessionID:           sessionID,
		EventType:           "transcription",
		Provider:            "aws_transcribe_medical",
		Operation:           "medical_batch_transcription",
		ExternalJobID:       pgtype.Text{String: jobName, Valid: jobName != ""},
		EstimatedCostMicros: 0,
		Currency:            "USD",
		PricingSource:       "configured_rate",
		RateSnapshot:        rateSnapshot,
		Metadata:            metadata,
	}
	if hasDuration {
		estimate := CalculateTranscriptionCost(audioDurationSeconds, usdPerMinute)
		if err := params.AudioDurationSeconds.Scan(fmt.Sprintf("%.3f", estimate.AudioDurationSeconds)); err != nil {
			return err
		}
		params.BillableDurationSeconds = pgtype.Int4{Int32: estimate.BillableDurationSeconds, Valid: true}
		params.EstimatedCostMicros = estimate.EstimatedCostMicros
	} else {
		params.Metadata = []byte(`{"warning":"duration_unavailable"}`)
	}
	_, err = q.CreateScribeUsageEvent(ctx, params)
	return err
}

func recordLLMUsageEvent(ctx context.Context, q usageEventCreator, sessionID pgtype.UUID, usage LLMUsage, inputUSDPerMillion float64, outputUSDPerMillion float64) error {
	rateSnapshot, err := json.Marshal(map[string]string{
		"input_usd_per_million_tokens":  strconv.FormatFloat(inputUSDPerMillion, 'f', -1, 64),
		"output_usd_per_million_tokens": strconv.FormatFloat(outputUSDPerMillion, 'f', -1, 64),
	})
	if err != nil {
		return err
	}
	estimate := CalculateLLMCost(usage.InputTokens, usage.OutputTokens, inputUSDPerMillion, outputUSDPerMillion)
	_, err = q.CreateScribeUsageEvent(ctx, database.CreateScribeUsageEventParams{
		SessionID:           sessionID,
		EventType:           "llm",
		Provider:            "aws_bedrock_anthropic",
		Operation:           "scribe_extraction",
		ModelID:             pgtype.Text{String: usage.ModelID, Valid: usage.ModelID != ""},
		InputTokens:         pgtype.Int4{Int32: estimate.InputTokens, Valid: true},
		OutputTokens:        pgtype.Int4{Int32: estimate.OutputTokens, Valid: true},
		TotalTokens:         pgtype.Int4{Int32: estimate.TotalTokens, Valid: true},
		EstimatedCostMicros: estimate.EstimatedCostMicros,
		Currency:            "USD",
		PricingSource:       "configured_rate",
		RateSnapshot:        rateSnapshot,
		Metadata:            []byte(`{}`),
	})
	return err
}

func CostBasis(totalEvents int32, actualEvents int32) string {
	if totalEvents > 0 && actualEvents == totalEvents {
		return "actual"
	}
	if actualEvents > 0 {
		return "mixed"
	}
	return "estimated"
}

func loadUsageSummaryResponse(ctx context.Context, q usageSummaryGetter, sessionID pgtype.UUID) *usageSummaryResponse {
	row, err := q.GetScribeUsageSummaryForSession(ctx, sessionID)
	if err != nil {
		log.Printf("scribe usage summary load error for session %s: %v", uuidToString(sessionID), err)
		return nil
	}
	return toUsageSummaryResponse(row)
}

func toUsageSummaryResponse(row database.GetScribeUsageSummaryForSessionRow) *usageSummaryResponse {
	if row.EventCount == 0 {
		return nil
	}
	resp := &usageSummaryResponse{
		TotalEstimatedCostMicros: row.TotalEstimatedCostMicros,
		TotalActualCostMicros:    nullableInt64Ptr(row.TotalActualCostMicros),
		Currency:                 "USD",
		CostBasis:                CostBasis(int32(row.EventCount), int32(row.ActualEventCount)),
	}
	transcriptionProvider, hasTranscriptionProvider := interfaceString(row.TranscriptionProvider)
	transcriptionOperation, hasTranscriptionOperation := interfaceString(row.TranscriptionOperation)
	if hasTranscriptionProvider && hasTranscriptionOperation {
		resp.Transcription = &transcriptionUsageResponse{
			Provider:                transcriptionProvider,
			Operation:               transcriptionOperation,
			AudioDurationSeconds:    nullableFloat64Ptr(row.TranscriptionAudioDurationSeconds),
			BillableDurationSeconds: nullableInt64Ptr(row.TranscriptionBillableDurationSeconds),
			EstimatedCostMicros:     int64Value(row.TranscriptionEstimatedCostMicros),
			ActualCostMicros:        nullableInt64Ptr(row.TranscriptionActualCostMicros),
			Currency:                "USD",
		}
	}
	llmProvider, hasLLMProvider := interfaceString(row.LlmProvider)
	llmOperation, hasLLMOperation := interfaceString(row.LlmOperation)
	if hasLLMProvider && hasLLMOperation {
		modelID, _ := interfaceString(row.LlmModelID)
		resp.LLM = &llmUsageResponse{
			Provider:            llmProvider,
			Operation:           llmOperation,
			ModelID:             modelID,
			InputTokens:         int64Value(row.LlmInputTokens),
			OutputTokens:        int64Value(row.LlmOutputTokens),
			TotalTokens:         int64Value(row.LlmTotalTokens),
			EstimatedCostMicros: int64Value(row.LlmEstimatedCostMicros),
			ActualCostMicros:    nullableInt64Ptr(row.LlmActualCostMicros),
			Currency:            "USD",
		}
	}
	return resp
}

func int8Ptr(value pgtype.Int8) *int64 {
	if !value.Valid {
		return nil
	}
	return &value.Int64
}

func numericFloat64Ptr(value pgtype.Numeric) *float64 {
	floatValue, err := value.Float64Value()
	if err != nil || !floatValue.Valid {
		return nil
	}
	return &floatValue.Float64
}

func nullableInt64Ptr(value interface{}) *int64 {
	switch v := value.(type) {
	case nil:
		return nil
	case int64:
		return &v
	case int:
		n := int64(v)
		return &n
	case float64:
		n := int64(v)
		return &n
	case pgtype.Int8:
		return int8Ptr(v)
	}
	return nil
}

func int64Value(value interface{}) int64 {
	if ptr := nullableInt64Ptr(value); ptr != nil {
		return *ptr
	}
	return 0
}

func nullableFloat64Ptr(value interface{}) *float64 {
	switch v := value.(type) {
	case nil:
		return nil
	case float64:
		return &v
	case int64:
		f := float64(v)
		return &f
	case []byte:
		return parseFloat64Ptr(string(v))
	case string:
		return parseFloat64Ptr(v)
	case pgtype.Numeric:
		return numericFloat64Ptr(v)
	}
	return nil
}

func parseFloat64Ptr(value string) *float64 {
	f, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return nil
	}
	return &f
}

func interfaceString(value interface{}) (string, bool) {
	switch v := value.(type) {
	case string:
		return v, v != ""
	case []byte:
		return string(v), len(v) > 0
	default:
		return "", false
	}
}
