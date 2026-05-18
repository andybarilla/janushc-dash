package scribe

import "math"

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

func CostBasis(totalEvents int32, actualEvents int32) string {
	if totalEvents > 0 && actualEvents == totalEvents {
		return "actual"
	}
	if actualEvents > 0 {
		return "mixed"
	}
	return "estimated"
}
