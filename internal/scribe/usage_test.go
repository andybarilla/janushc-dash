package scribe

import "testing"

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
