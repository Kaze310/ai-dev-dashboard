import { describe, expect, it } from "vitest";

import {
  canonicalizeCostIdentifier,
  canonicalizeModel,
  stripAnthropicSnapshotSuffix,
} from "../anthropic";
import { canonicalizeCostLineItem, canonicalizeUsageModel, stripModelDateSuffix } from "../openai";

describe("OpenAI canonicalization", () => {
  it("strips YYYY-MM-DD snapshot suffixes", () => {
    expect(stripModelDateSuffix("gpt-4o-2024-08-06")).toBe("gpt-4o");
    expect(stripModelDateSuffix("gpt-4o")).toBe("gpt-4o");
  });

  it("canonicalizes usage models to lowercase without snapshot", () => {
    expect(canonicalizeUsageModel("GPT-4o-2024-08-06")).toBe("gpt-4o");
  });

  it("extracts model tokens from cost line items", () => {
    expect(canonicalizeCostLineItem("gpt-4o-2024-08-06, input")).toBe("gpt-4o");
    expect(canonicalizeCostLineItem("GPT-4.1 output")).toBe("gpt-4.1");
    expect(canonicalizeCostLineItem("o3-mini input")).toBe("o3-mini");
  });

  it("falls back to first token for non-gpt line items instead of crashing", () => {
    expect(canonicalizeCostLineItem("whisper-1")).toBe("whisper-1");
  });
});

describe("Anthropic canonicalization", () => {
  it("strips -YYYYMMDD snapshot suffixes", () => {
    expect(stripAnthropicSnapshotSuffix("claude-sonnet-4-5-20250929")).toBe("claude-sonnet-4-5");
  });

  it("canonicalizes usage models", () => {
    expect(canonicalizeModel(" Claude-Opus-4-6-20251101 ")).toBe("claude-opus-4-6");
  });

  it("normalizes 'Claude Family X.Y' style cost descriptions", () => {
    expect(canonicalizeCostIdentifier("Claude Opus 4.6 Usage - Input Tokens")).toBe("claude-opus-4-6");
    expect(canonicalizeCostIdentifier("Claude Sonnet 4.5 Usage - Output Tokens")).toBe("claude-sonnet-4-5");
  });

  it("extracts canonical model tokens from descriptions", () => {
    expect(canonicalizeCostIdentifier("Batch API | claude-sonnet-4-5-20250929 output")).toBe(
      "claude-sonnet-4-5",
    );
  });

  it("aligns usage model and cost description to the same key", () => {
    const fromUsage = canonicalizeModel("claude-opus-4-6-20251101");
    const fromCost = canonicalizeCostIdentifier("Claude Opus 4.6 Usage - Input Tokens");
    expect(fromUsage).toBe(fromCost);
  });
});
