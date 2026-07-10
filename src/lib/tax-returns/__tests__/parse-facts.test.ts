import { describe, it, expect } from "vitest";
import { parseTaxReturnFactsJson, TaxReturnParseError } from "../parse-facts";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";

function aiResponse(factsOverrides: Record<string, unknown> = {}, isAmended = false): string {
  const facts = { ...emptyTaxReturnFacts(2025), ...factsOverrides };
  return JSON.stringify({ isAmended, facts });
}

describe("parseTaxReturnFactsJson", () => {
  it("parses a clean response", () => {
    const { facts, isAmended, warnings } = parseTaxReturnFactsJson(aiResponse({ filingStatus: "single" }));
    expect(facts.filingStatus).toBe("single");
    expect(isAmended).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("strips markdown fences", () => {
    const raw = "```json\n" + aiResponse() + "\n```";
    expect(parseTaxReturnFactsJson(raw).facts.taxYear).toBe(2025);
  });

  it("coerces numeric strings and currency formatting", () => {
    const facts = { ...emptyTaxReturnFacts(2025), income: { ...emptyTaxReturnFacts(2025).income, wages: "$150,000" } };
    const parsed = parseTaxReturnFactsJson(JSON.stringify({ isAmended: false, facts }));
    expect(parsed.facts.income.wages).toBe(150000);
    expect(parsed.warnings.length).toBe(1); // coercion warning
  });

  it("defaults missing sections and strips unknown keys with warnings", () => {
    const raw = JSON.stringify({
      isAmended: false,
      facts: { taxYear: 2024, filingStatus: "married_joint", income: { wages: 90000, bogusField: 1 } },
    });
    const { facts, warnings } = parseTaxReturnFactsJson(raw);
    expect(facts.income.wages).toBe(90000);
    expect(facts.tax.totalTax).toBeNull();
    expect(warnings.some((w) => w.includes("bogusField"))).toBe(true);
  });

  it("passes isAmended through", () => {
    expect(parseTaxReturnFactsJson(aiResponse({}, true)).isAmended).toBe(true);
  });

  it("throws TaxReturnParseError on non-JSON", () => {
    expect(() => parseTaxReturnFactsJson("I could not read this document")).toThrow(TaxReturnParseError);
  });

  it("throws on a pre-2022 tax year", () => {
    expect(() => parseTaxReturnFactsJson(aiResponse({ taxYear: 2019 }))).toThrow(TaxReturnParseError);
  });
});
