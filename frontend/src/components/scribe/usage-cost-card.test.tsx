import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UsageCostCard } from "./usage-cost-card";
import type { ScribeUsageSummary } from "@/lib/scribe-queries";

const estimatedUsage: ScribeUsageSummary = {
  transcription: {
    provider: "aws_transcribe_medical",
    operation: "medical_transcription",
    audio_duration_seconds: 744,
    billable_duration_seconds: 745,
    estimated_cost_micros: 2480000,
    currency: "USD",
  },
  llm: {
    provider: "aws_bedrock",
    operation: "converse",
    model_id: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    input_tokens: 8120,
    output_tokens: 934,
    total_tokens: 9054,
    estimated_cost_micros: 384000,
    currency: "USD",
  },
  total_estimated_cost_micros: 2864000,
  currency: "USD",
  cost_basis: "estimated",
};

afterEach(() => {
  cleanup();
});

describe("UsageCostCard", () => {
  it("renders estimated usage rows and total", () => {
    render(<UsageCostCard usage={estimatedUsage} status="completed" inPipeline={false} />);

    expect(screen.getByRole("heading", { name: "Usage & Cost" })).toBeInTheDocument();
    expect(screen.getByText("Estimated usage")).toBeInTheDocument();
    expect(screen.getByText("Transcription")).toBeInTheDocument();
    expect(screen.getByText("12.4 min audio")).toBeInTheDocument();
    expect(screen.getByText("AI extraction")).toBeInTheDocument();
    expect(screen.getByText("Claude Sonnet 4.5")).toBeInTheDocument();
    expect(screen.getByText("8,120 input / 934 output tokens")).toBeInTheDocument();
    expect(screen.getByText("Total estimated encounter cost")).toBeInTheDocument();
    expect(screen.getByText("$2.86 est.")).toBeInTheDocument();
  });

  it("renders mixed and actual labels clearly", () => {
    const mixedUsage: ScribeUsageSummary = {
      ...estimatedUsage,
      total_actual_cost_micros: 3000000,
      cost_basis: "mixed",
    };
    const actualUsage: ScribeUsageSummary = {
      ...estimatedUsage,
      total_actual_cost_micros: 3000000,
      cost_basis: "actual",
    };

    const { rerender } = render(
      <UsageCostCard usage={mixedUsage} status="completed" inPipeline={false} />,
    );
    expect(screen.getByText("Mixed actual/estimated usage")).toBeInTheDocument();
    expect(screen.getByText("Total mixed encounter cost")).toBeInTheDocument();
    expect(screen.getByText("$3.00 mixed")).toBeInTheDocument();

    rerender(<UsageCostCard usage={actualUsage} status="completed" inPipeline={false} />);
    expect(screen.getByText("Actual usage")).toBeInTheDocument();
    expect(screen.getByText("Total actual encounter cost")).toBeInTheDocument();
    expect(screen.getByText("$3.00 actual")).toBeInTheDocument();
  });

  it("renders a pipeline placeholder when usage is not available yet", () => {
    render(<UsageCostCard status="processing" inPipeline={true} />);

    expect(
      screen.getByText("Usage will appear after transcription and AI extraction complete."),
    ).toBeInTheDocument();
  });

  it("renders failed no-usage copy", () => {
    render(<UsageCostCard status="failed" inPipeline={false} />);

    expect(screen.getByText("No usage captured for this failed run.")).toBeInTheDocument();
  });
});
