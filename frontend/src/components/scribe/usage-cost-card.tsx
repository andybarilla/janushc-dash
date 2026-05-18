import type { ReactElement } from "react";
import type { CostBasis, ScribeUsageSummary } from "@/lib/scribe-queries";
import {
  formatAudioMinutes,
  formatCostBasisDescription,
  formatCostBasisLabel,
  formatCostBasisSuffix,
  formatMicrosAsDollars,
  formatModelDisplay,
  formatTokens,
} from "@/lib/usage-format";

interface UsageCostCardProps {
  usage?: ScribeUsageSummary;
  status: string;
  inPipeline: boolean;
}

function costMicrosForBasis(
  estimatedCostMicros: number,
  actualCostMicros: number | undefined,
  costBasis: CostBasis,
): number {
  if (costBasis === "actual" || costBasis === "mixed") {
    return actualCostMicros ?? estimatedCostMicros;
  }

  return estimatedCostMicros;
}

function formatCost(
  estimatedCostMicros: number,
  actualCostMicros: number | undefined,
  costBasis: CostBasis,
): string {
  return `${formatMicrosAsDollars(
    costMicrosForBasis(estimatedCostMicros, actualCostMicros, costBasis),
  )} ${formatCostBasisSuffix(costBasis)}`;
}

export function UsageCostCard({
  usage,
  status,
  inPipeline,
}: UsageCostCardProps): ReactElement {
  const isFailedWithoutUsage = status === "failed" && !usage;

  return (
    <section className="janus-usage-card" aria-labelledby="janus-usage-heading">
      <div className="janus-usage-header">
        <h2 id="janus-usage-heading" className="janus-usage-title">
          Usage & Cost
        </h2>
        {usage ? (
          <span className="janus-usage-basis">{formatCostBasisLabel(usage.cost_basis)}</span>
        ) : null}
      </div>

      {!usage && inPipeline ? (
        <p className="janus-usage-placeholder">
          Usage will appear after transcription and AI extraction complete.
        </p>
      ) : null}

      {isFailedWithoutUsage ? (
        <p className="janus-usage-placeholder">No usage captured for this failed run.</p>
      ) : null}

      {usage ? (
        <div className="janus-usage-content">
          {usage.transcription ? (
            <div className="janus-usage-row">
              <div className="janus-usage-row-main">
                <span className="janus-usage-row-title">Transcription</span>
                <span className="janus-usage-row-detail">
                  {usage.transcription.audio_duration_seconds === undefined
                    ? "duration unavailable"
                    : formatAudioMinutes(usage.transcription.audio_duration_seconds)}
                </span>
                <span className="janus-usage-row-meta">
                  {usage.transcription.provider} · {usage.transcription.operation}
                </span>
              </div>
              <span className="janus-usage-row-cost">
                {formatCost(
                  usage.transcription.estimated_cost_micros,
                  usage.transcription.actual_cost_micros,
                  usage.cost_basis,
                )}
              </span>
            </div>
          ) : null}

          {usage.llm ? (
            <div className="janus-usage-row">
              <div className="janus-usage-row-main">
                <span className="janus-usage-row-title">AI extraction</span>
                <span className="janus-usage-row-detail">
                  {formatModelDisplay(usage.llm.model_id)}
                </span>
                <span className="janus-usage-row-meta">
                  {formatTokens(usage.llm.input_tokens)} input / {formatTokens(usage.llm.output_tokens)} output tokens
                </span>
              </div>
              <span className="janus-usage-row-cost">
                {formatCost(
                  usage.llm.estimated_cost_micros,
                  usage.llm.actual_cost_micros,
                  usage.cost_basis,
                )}
              </span>
            </div>
          ) : null}

          <div className="janus-usage-total">
            <span className="janus-usage-total-label">
              Total {formatCostBasisDescription(usage.cost_basis)} encounter cost
            </span>
            <span className="janus-usage-total-cost">
              {formatMicrosAsDollars(
                costMicrosForBasis(
                  usage.total_estimated_cost_micros,
                  usage.total_actual_cost_micros,
                  usage.cost_basis,
                ),
              )} {formatCostBasisSuffix(usage.cost_basis)}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
