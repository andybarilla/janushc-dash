import { describe, expect, it } from "vitest";
import {
  formatAudioMinutes,
  formatMicrosAsDollars,
  formatModelDisplay,
  formatTokens,
} from "./usage-format";

describe("usage formatting", () => {
  it("formats micros as dollars", () => {
    expect(formatMicrosAsDollars(300000)).toBe("$0.30");
  });

  it("formats audio seconds as minutes", () => {
    expect(formatAudioMinutes(744)).toBe("12.4 min audio");
  });

  it("formats token counts", () => {
    expect(formatTokens(8120)).toBe("8,120");
  });

  it("maps Anthropic Sonnet model IDs to a friendly name", () => {
    expect(formatModelDisplay("us.anthropic.claude-sonnet-4-5-20250929-v1:0")).toBe(
      "Claude Sonnet 4.5",
    );
    expect(formatModelDisplay("anthropic.claude-3-5-sonnet-20241022-v2:0")).toBe(
      "Claude Sonnet 3.5",
    );
  });

  it("returns raw model IDs when no friendly mapping exists", () => {
    expect(formatModelDisplay("custom-model")).toBe("custom-model");
  });
});
