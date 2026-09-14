// src/lib/entity-extraction/__tests__/region-classifier.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { findEntity } from "@/domain/forge/detail-fields";

vi.mock("@/lib/extraction/azure-client", () => ({
  callAIExtraction: vi.fn(),
}));

import { callAIExtraction } from "@/lib/extraction/azure-client";
import { classifyRegions, buildRegionClassifierPrompt } from "../region-classifier";

const entities = [findEntity("life_insurance_policy")!, findEntity("disability_policy")!];
const mocked = vi.mocked(callAIExtraction);

beforeEach(() => vi.clearAllMocks());

describe("buildRegionClassifierPrompt", () => {
  it("offers only the entities it was given", () => {
    const prompt = buildRegionClassifierPrompt(entities);
    expect(prompt).toContain("life_insurance_policy");
    expect(prompt).toContain("disability_policy");
    expect(prompt).not.toContain("roth_conversion");
    expect(prompt).not.toContain("withdrawal_strategy");
  });

  it("gives the model the document hints, not just entity ids", () => {
    expect(buildRegionClassifierPrompt(entities)).toContain("in-force illustration");
  });
});

describe("classifyRegions", () => {
  it("returns the page ranges for each entity present", async () => {
    mocked.mockResolvedValue(JSON.stringify({
      life_insurance_policy: [[2, 4]],
      disability_policy: [],
    }));
    const result = await classifyRegions({ outline: "o", anchors: "a", entities });
    expect(result).toEqual({ life_insurance_policy: [[2, 4]], disability_policy: [] });
  });

  it("returns both entities when one document carries both", async () => {
    mocked.mockResolvedValue(JSON.stringify({
      life_insurance_policy: [[1, 2]],
      disability_policy: [[5, 6]],
    }));
    const result = await classifyRegions({ outline: "o", anchors: "a", entities });
    expect(result!.life_insurance_policy).toEqual([[1, 2]]);
    expect(result!.disability_policy).toEqual([[5, 6]]);
  });

  it("drops a key that is not in the offered vocabulary", async () => {
    mocked.mockResolvedValue(JSON.stringify({
      life_insurance_policy: [[1, 2]],
      roth_conversion: [[9, 9]],
    }));
    const result = await classifyRegions({ outline: "o", anchors: "a", entities });
    expect(result).not.toHaveProperty("roth_conversion");
  });

  it("returns null when no offered key is present, so the caller can fall back", async () => {
    mocked.mockResolvedValue(JSON.stringify({ something_else: [[1, 1]] }));
    expect(await classifyRegions({ outline: "o", anchors: "a", entities })).toBeNull();
  });

  it("returns null when the AI call throws", async () => {
    mocked.mockRejectedValue(new Error("azure down"));
    expect(await classifyRegions({ outline: "o", anchors: "a", entities })).toBeNull();
  });

  it("returns null on an inverted page range", async () => {
    mocked.mockResolvedValue(JSON.stringify({ life_insurance_policy: [[7, 3]] }));
    expect(await classifyRegions({ outline: "o", anchors: "a", entities })).toBeNull();
  });

  it("returns null when an entity claims more than twenty ranges", async () => {
    const many = Array.from({ length: 21 }, (_, i) => [i + 1, i + 1]);
    mocked.mockResolvedValue(JSON.stringify({ life_insurance_policy: many }));
    expect(await classifyRegions({ outline: "o", anchors: "a", entities })).toBeNull();
  });

  it("returns null when the AI reply is the bare JSON literal null, rather than throwing", async () => {
    // "null" is valid JSON, so parseAIResponse's JSON.parse fallback succeeds
    // and hands back the value `null` — not `{}`. Object.hasOwnProperty.call
    // on a null receiver throws a TypeError; that must not escape classifyRegions.
    mocked.mockResolvedValue("null");
    await expect(
      classifyRegions({ outline: "o", anchors: "a", entities }),
    ).resolves.toBeNull();
  });

  it("returns null on a non-JSON garbled response", async () => {
    mocked.mockResolvedValue("not json at all");
    expect(await classifyRegions({ outline: "o", anchors: "a", entities })).toBeNull();
  });

  it("returns null when the AI reply is a top-level JSON array", async () => {
    mocked.mockResolvedValue(JSON.stringify([[1, 2]]));
    expect(await classifyRegions({ outline: "o", anchors: "a", entities })).toBeNull();
  });

  it("returns null on a non-integer page number", async () => {
    mocked.mockResolvedValue(JSON.stringify({ life_insurance_policy: [[1.5, 3]] }));
    expect(await classifyRegions({ outline: "o", anchors: "a", entities })).toBeNull();
  });
});
