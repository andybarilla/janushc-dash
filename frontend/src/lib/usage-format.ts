import type { CostBasis } from "./scribe-queries";

export function formatMicrosAsDollars(micros: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(micros / 1_000_000);
}

export function formatAudioMinutes(seconds: number): string {
  return `${(seconds / 60).toFixed(1)} min audio`;
}

export function formatTokens(tokens: number): string {
  return new Intl.NumberFormat("en-US").format(tokens);
}

export function formatModelDisplay(modelId?: string): string {
  if (!modelId) {
    return "model unavailable";
  }

  if (modelId.includes("claude-sonnet-4-5")) {
    return "Claude Sonnet 4.5";
  }

  if (modelId.includes("claude-3-5-sonnet")) {
    return "Claude Sonnet 3.5";
  }

  if (modelId.includes("claude-3-sonnet")) {
    return "Claude Sonnet 3";
  }

  return modelId;
}

export function formatCostBasisLabel(costBasis: CostBasis): string {
  if (costBasis === "actual") {
    return "Actual usage";
  }

  if (costBasis === "mixed") {
    return "Mixed actual/estimated usage";
  }

  return "Estimated usage";
}

export function formatCostBasisSuffix(costBasis: CostBasis): string {
  if (costBasis === "actual") {
    return "actual";
  }

  if (costBasis === "mixed") {
    return "mixed";
  }

  return "est.";
}

export function formatCostBasisDescription(costBasis: CostBasis): string {
  if (costBasis === "actual") {
    return "actual";
  }

  if (costBasis === "mixed") {
    return "mixed";
  }

  return "estimated";
}
