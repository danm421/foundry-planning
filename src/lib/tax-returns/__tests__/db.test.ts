import { describe, it, expect } from "vitest";
import { rowToSummary, parseRowFacts, type TaxReturnRow } from "../db";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";

function makeRow(overrides: Partial<TaxReturnRow> = {}): TaxReturnRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    clientId: "22222222-2222-2222-2222-222222222222",
    taxYear: 2025,
    status: "needs_review",
    extractedFacts: emptyTaxReturnFacts(2025),
    facts: emptyTaxReturnFacts(2025),
    warnings: ["Schedule D not found"],
    vaultDocumentId: null,
    sourceFilename: "smith-1040.pdf",
    promptVersion: "tax_return_facts:2026-07-10.1",
    model: "full",
    createdAt: new Date("2026-07-10T00:00:00Z"),
    updatedAt: new Date("2026-07-10T00:00:00Z"),
    ...overrides,
  };
}

describe("tax-returns db mapper", () => {
  it("summarizes a row without exposing facts", () => {
    const s = rowToSummary(makeRow());
    expect(s).toEqual({
      taxYear: 2025,
      status: "needs_review",
      warningCount: 1,
      sourceFilename: "smith-1040.pdf",
      updatedAt: "2026-07-10T00:00:00.000Z",
    });
  });

  it("parses valid facts jsonb", () => {
    const { facts, parseError } = parseRowFacts(makeRow());
    expect(parseError).toBe(false);
    expect(facts?.taxYear).toBe(2025);
  });

  it("flags corrupt facts jsonb instead of throwing", () => {
    const { facts, parseError } = parseRowFacts(
      makeRow({ facts: { garbage: true } }),
    );
    expect(facts).toBeNull();
    expect(parseError).toBe(true);
  });
});
