import { describe, it, expect } from "vitest";
import { liSolvedSchema } from "../options-schema";

const LEGACY_PAYLOAD = {
  curveRows: [{ year: 2048, clientNeed: 2_000_000, spouseNeed: 1_300_000 }],
  mcClient: { status: "solved", faceValue: 2_000_000, achievedScore: 0.9 },
  mcSpouse: null,
  assumptions: { deathYear: 2048, modelPortfolioLabel: "Balanced 60/40", mcTargetScore: 0.9 },
};

describe("liSolvedSchema", () => {
  it("defaults estate-tax addends to null on legacy payloads (cached solves, saved decks)", () => {
    const parsed = liSolvedSchema.parse(LEGACY_PAYLOAD);
    expect(parsed.estateTaxAddendClient).toBeNull();
    expect(parsed.estateTaxAddendSpouse).toBeNull();
  });

  it("passes explicit addends through", () => {
    const parsed = liSolvedSchema.parse({
      ...LEGACY_PAYLOAD,
      estateTaxAddendClient: 350_000,
      estateTaxAddendSpouse: 120_000,
    });
    expect(parsed.estateTaxAddendClient).toBe(350_000);
    expect(parsed.estateTaxAddendSpouse).toBe(120_000);
  });
});
