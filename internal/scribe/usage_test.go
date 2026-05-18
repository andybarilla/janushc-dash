package scribe

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andybarilla/janushc-dash/internal/database"
)

type fakeUsageEventCreator struct {
	arg database.CreateScribeUsageEventParams
	err error
}

type fakeUsageSummaryGetter struct {
	row database.GetScribeUsageSummaryForSessionRow
	err error
}

func (f *fakeUsageEventCreator) CreateScribeUsageEvent(ctx context.Context, arg database.CreateScribeUsageEventParams) (database.ScribeUsageEvent, error) {
	f.arg = arg
	return database.ScribeUsageEvent{}, f.err
}

func (f *fakeUsageSummaryGetter) GetScribeUsageSummaryForSession(ctx context.Context, sessionID pgtype.UUID) (database.GetScribeUsageSummaryForSessionRow, error) {
	return f.row, f.err
}

func testSessionID(t *testing.T) pgtype.UUID {
	t.Helper()
	id := pgtype.UUID{}
	if err := id.Scan("11111111-1111-1111-1111-111111111111"); err != nil {
		t.Fatalf("scan session id: %v", err)
	}
	return id
}

func TestRecordTranscriptionUsageEventBuildsExpectedParams(t *testing.T) {
	fake := &fakeUsageEventCreator{}
	sessionID := testSessionID(t)

	err := recordTranscriptionUsageEvent(context.Background(), fake, sessionID, "job-1", 12.4, true, 0.024)
	if err != nil {
		t.Fatalf("recordTranscriptionUsageEvent returned error: %v", err)
	}

	arg := fake.arg
	if arg.SessionID != sessionID || arg.EventType != "transcription" || arg.Provider != "aws_transcribe_medical" || arg.Operation != "medical_batch_transcription" {
		t.Fatalf("unexpected transcription identity params: %+v", arg)
	}
	if !arg.ExternalJobID.Valid || arg.ExternalJobID.String != "job-1" {
		t.Fatalf("ExternalJobID = %+v, want job-1", arg.ExternalJobID)
	}
	if !arg.AudioDurationSeconds.Valid {
		t.Fatalf("AudioDurationSeconds invalid")
	}
	if !arg.BillableDurationSeconds.Valid || arg.BillableDurationSeconds.Int32 != 13 {
		t.Fatalf("BillableDurationSeconds = %+v, want 13", arg.BillableDurationSeconds)
	}
	if arg.EstimatedCostMicros != 5200 {
		t.Fatalf("EstimatedCostMicros = %d, want 5200", arg.EstimatedCostMicros)
	}
	if string(arg.RateSnapshot) != `{"usd_per_minute":"0.024"}` || string(arg.Metadata) != `{}` {
		t.Fatalf("unexpected json: rate=%s metadata=%s", arg.RateSnapshot, arg.Metadata)
	}
}

func TestRecordTranscriptionUsageEventUnavailableDurationStoresNullsAndWarning(t *testing.T) {
	fake := &fakeUsageEventCreator{}

	err := recordTranscriptionUsageEvent(context.Background(), fake, testSessionID(t), "job-2", 0, false, 0.024)
	if err != nil {
		t.Fatalf("recordTranscriptionUsageEvent returned error: %v", err)
	}

	arg := fake.arg
	if arg.AudioDurationSeconds.Valid || arg.BillableDurationSeconds.Valid {
		t.Fatalf("duration fields should be null: audio=%+v billable=%+v", arg.AudioDurationSeconds, arg.BillableDurationSeconds)
	}
	if arg.EstimatedCostMicros != 0 {
		t.Fatalf("EstimatedCostMicros = %d, want 0", arg.EstimatedCostMicros)
	}
	if string(arg.Metadata) != `{"warning":"duration_unavailable"}` {
		t.Fatalf("Metadata = %s, want duration warning", arg.Metadata)
	}
}

func TestRecordLLMUsageEventBuildsExpectedParams(t *testing.T) {
	fake := &fakeUsageEventCreator{}
	sessionID := testSessionID(t)
	usage := LLMUsage{ModelID: "claude", InputTokens: 1000, OutputTokens: 2000, TotalTokens: 3000}

	err := recordLLMUsageEvent(context.Background(), fake, sessionID, usage, 3.00, 15.00)
	if err != nil {
		t.Fatalf("recordLLMUsageEvent returned error: %v", err)
	}

	arg := fake.arg
	if arg.SessionID != sessionID || arg.EventType != "llm" || arg.Provider != "aws_bedrock_anthropic" || arg.Operation != "scribe_extraction" {
		t.Fatalf("unexpected llm identity params: %+v", arg)
	}
	if !arg.ModelID.Valid || arg.ModelID.String != "claude" {
		t.Fatalf("ModelID = %+v, want claude", arg.ModelID)
	}
	if arg.InputTokens.Int32 != 1000 || arg.OutputTokens.Int32 != 2000 || arg.TotalTokens.Int32 != 3000 {
		t.Fatalf("unexpected token params: input=%+v output=%+v total=%+v", arg.InputTokens, arg.OutputTokens, arg.TotalTokens)
	}
	if arg.EstimatedCostMicros != 33000 {
		t.Fatalf("EstimatedCostMicros = %d, want 33000", arg.EstimatedCostMicros)
	}
	if string(arg.RateSnapshot) != `{"input_usd_per_million_tokens":"3","output_usd_per_million_tokens":"15"}` || string(arg.Metadata) != `{}` {
		t.Fatalf("unexpected json: rate=%s metadata=%s", arg.RateSnapshot, arg.Metadata)
	}
}

func TestRecordUsageEventReturnsInsertError(t *testing.T) {
	insertErr := errors.New("insert failed")
	fake := &fakeUsageEventCreator{err: insertErr}

	err := recordLLMUsageEvent(context.Background(), fake, testSessionID(t), LLMUsage{InputTokens: 1, OutputTokens: 1, TotalTokens: 2}, 3, 15)
	if !errors.Is(err, insertErr) {
		t.Fatalf("recordLLMUsageEvent error = %v, want %v", err, insertErr)
	}
}

func TestProcessErrorUsageCanBeRecorded(t *testing.T) {
	fake := &fakeUsageEventCreator{}
	processErr := &ProcessError{Message: "parse failed", Usage: LLMUsage{ModelID: "claude", InputTokens: 7, OutputTokens: 11, TotalTokens: 18}, Err: errors.New("json")}

	err := recordLLMUsageEvent(context.Background(), fake, testSessionID(t), processErr.Usage, 3, 15)
	if err != nil {
		t.Fatalf("recordLLMUsageEvent returned error: %v", err)
	}
	if fake.arg.InputTokens.Int32 != 7 || fake.arg.OutputTokens.Int32 != 11 || fake.arg.TotalTokens.Int32 != 18 {
		t.Fatalf("parse failure usage not recorded: %+v", fake.arg)
	}
}

func TestToUsageSummaryResponseMapsPopulatedRow(t *testing.T) {
	audioDuration := pgtype.Numeric{}
	if err := audioDuration.Scan("12.4"); err != nil {
		t.Fatalf("scan audio duration: %v", err)
	}
	row := database.GetScribeUsageSummaryForSessionRow{
		EventCount:                           2,
		TotalEstimatedCostMicros:             339720,
		TranscriptionAudioDurationSeconds:    audioDuration,
		TranscriptionBillableDurationSeconds: pgtype.Int8{Int64: 13, Valid: true},
		TranscriptionEstimatedCostMicros:     300000,
		TranscriptionProvider:                []byte("aws_transcribe_medical"),
		TranscriptionOperation:               "medical_batch_transcription",
		LlmInputTokens:                       8120,
		LlmOutputTokens:                      1024,
		LlmTotalTokens:                       9144,
		LlmEstimatedCostMicros:               39720,
		LlmProvider:                          "aws_bedrock_anthropic",
		LlmOperation:                         []byte("scribe_extraction"),
		LlmModelID:                           "claude-3-5-sonnet",
		ActualEventCount:                     0,
	}

	got := toUsageSummaryResponse(row)
	if got == nil {
		t.Fatalf("toUsageSummaryResponse returned nil")
	}
	if got.TotalEstimatedCostMicros != 339720 || got.TotalActualCostMicros != nil || got.Currency != "USD" || got.CostBasis != "estimated" {
		t.Fatalf("unexpected summary: %+v", got)
	}
	if got.Transcription == nil || got.Transcription.Provider != "aws_transcribe_medical" || got.Transcription.Operation != "medical_batch_transcription" || got.Transcription.EstimatedCostMicros != 300000 || got.Transcription.Currency != "USD" {
		t.Fatalf("unexpected transcription: %+v", got.Transcription)
	}
	if got.Transcription.AudioDurationSeconds == nil || *got.Transcription.AudioDurationSeconds != 12.4 {
		t.Fatalf("AudioDurationSeconds = %v, want 12.4", got.Transcription.AudioDurationSeconds)
	}
	if got.Transcription.BillableDurationSeconds == nil || *got.Transcription.BillableDurationSeconds != 13 {
		t.Fatalf("BillableDurationSeconds = %v, want 13", got.Transcription.BillableDurationSeconds)
	}
	if got.LLM == nil || got.LLM.Provider != "aws_bedrock_anthropic" || got.LLM.Operation != "scribe_extraction" || got.LLM.ModelID != "claude-3-5-sonnet" {
		t.Fatalf("unexpected llm identity: %+v", got.LLM)
	}
	if got.LLM.InputTokens != 8120 || got.LLM.OutputTokens != 1024 || got.LLM.TotalTokens != 9144 || got.LLM.EstimatedCostMicros != 39720 || got.LLM.Currency != "USD" {
		t.Fatalf("unexpected llm usage: %+v", got.LLM)
	}
}

func TestToUsageSummaryResponseOmitsUnavailableTranscriptionDuration(t *testing.T) {
	got := toUsageSummaryResponse(database.GetScribeUsageSummaryForSessionRow{
		EventCount:                       1,
		TranscriptionProvider:            "aws_transcribe_medical",
		TranscriptionOperation:           "medical_batch_transcription",
		TranscriptionEstimatedCostMicros: 0,
	})
	if got == nil || got.Transcription == nil {
		t.Fatalf("expected transcription summary: %+v", got)
	}
	if got.Transcription.AudioDurationSeconds != nil || got.Transcription.BillableDurationSeconds != nil {
		t.Fatalf("duration fields should be nil: %+v", got.Transcription)
	}
}

func TestToUsageSummaryResponseReturnsNilForNoEvents(t *testing.T) {
	if got := toUsageSummaryResponse(database.GetScribeUsageSummaryForSessionRow{}); got != nil {
		t.Fatalf("toUsageSummaryResponse = %+v, want nil", got)
	}
}

func TestLoadUsageSummaryResponseReturnsNilOnQueryError(t *testing.T) {
	got := loadUsageSummaryResponse(context.Background(), &fakeUsageSummaryGetter{err: errors.New("query failed")}, testSessionID(t))
	if got != nil {
		t.Fatalf("loadUsageSummaryResponse = %+v, want nil", got)
	}
}

func TestCalculateTranscriptionCost(t *testing.T) {
	estimate := CalculateTranscriptionCost(12.4, 0.024)

	if estimate.AudioDurationSeconds != 12.4 {
		t.Fatalf("AudioDurationSeconds = %v, want 12.4", estimate.AudioDurationSeconds)
	}
	if estimate.BillableDurationSeconds != 13 {
		t.Fatalf("BillableDurationSeconds = %d, want 13", estimate.BillableDurationSeconds)
	}
	if estimate.EstimatedCostMicros != 5200 {
		t.Fatalf("EstimatedCostMicros = %d, want 5200", estimate.EstimatedCostMicros)
	}
}

func TestCalculateLLMCost(t *testing.T) {
	estimate := CalculateLLMCost(1000, 2000, 3.00, 15.00)

	if estimate.InputTokens != 1000 {
		t.Fatalf("InputTokens = %d, want 1000", estimate.InputTokens)
	}
	if estimate.OutputTokens != 2000 {
		t.Fatalf("OutputTokens = %d, want 2000", estimate.OutputTokens)
	}
	if estimate.TotalTokens != 3000 {
		t.Fatalf("TotalTokens = %d, want 3000", estimate.TotalTokens)
	}
	if estimate.EstimatedCostMicros != 33000 {
		t.Fatalf("EstimatedCostMicros = %d, want 33000", estimate.EstimatedCostMicros)
	}
}

func TestCostBasis(t *testing.T) {
	tests := []struct {
		name         string
		totalEvents  int32
		actualEvents int32
		want         string
	}{
		{name: "estimated with no actual events", totalEvents: 2, actualEvents: 0, want: "estimated"},
		{name: "actual when all events have actual costs", totalEvents: 2, actualEvents: 2, want: "actual"},
		{name: "mixed when some events have actual costs", totalEvents: 3, actualEvents: 1, want: "mixed"},
		{name: "estimated with no events", totalEvents: 0, actualEvents: 0, want: "estimated"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CostBasis(tt.totalEvents, tt.actualEvents)
			if got != tt.want {
				t.Fatalf("CostBasis(%d, %d) = %q, want %q", tt.totalEvents, tt.actualEvents, got, tt.want)
			}
		})
	}
}
