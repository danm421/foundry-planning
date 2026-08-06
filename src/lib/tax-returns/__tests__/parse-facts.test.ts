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

  // The nullable nested blocks have a template value of null, so conform()
  // reads them as scalars and would pass the model's object through untouched —
  // a single stray key would then fail the STRICT schema and sink the whole
  // extraction. These cover the Schedule E block added alongside scheduleENet.
  it("conforms a Schedule E block, coercing strings and dropping unknown keys", () => {
    const base = emptyTaxReturnFacts(2025);
    const raw = JSON.stringify({
      isAmended: false,
      facts: {
        ...base,
        income: {
          ...base.income,
          scheduleENet: -6141,
          scheduleE: {
            grossRents: "$19,600",
            totalExpenses: 25741,
            depreciation: 8413,
            mortgageInterest: 6210,
            propertyTaxes: 5024,
            suspendedPassiveLoss: 0,
            netRent: -6141, // not in the schema; must be dropped, not fatal
          },
        },
      },
    });
    const { facts, warnings } = parseTaxReturnFactsJson(raw);
    expect(facts.income.scheduleENet).toBe(-6141);
    expect(facts.income.scheduleE?.grossRents).toBe(19600);
    expect(facts.income.scheduleE?.depreciation).toBe(8413);
    expect(warnings.some((w) => w.includes("scheduleE.netRent"))).toBe(true);
  });

  it("leaves scheduleE null when the model omits it", () => {
    const { facts } = parseTaxReturnFactsJson(aiResponse({ filingStatus: "single" }));
    expect(facts.income.scheduleE).toBeNull();
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

  it("throws TaxReturnParseError when conformed facts fail schema validation", () => {
    // "married" is not a valid filing-status enum value; conform() passes
    // non-numeric strings through, so this must be caught by safeParse.
    expect(() => parseTaxReturnFactsJson(aiResponse({ filingStatus: "married" }))).toThrow(
      TaxReturnParseError,
    );
  });

  it('treats string "true" isAmended as amended, with a warning', () => {
    const raw = JSON.stringify({ isAmended: "true", facts: emptyTaxReturnFacts(2025) });
    const parsed = parseTaxReturnFactsJson(raw);
    expect(parsed.isAmended).toBe(true);
    expect(parsed.warnings.length).toBe(1);
    expect(parsed.warnings[0]).toContain("isAmended");
  });

  it("coerces a numeric-string taxYear with a warning, keeping pre-2022 rejection", () => {
    const parsed = parseTaxReturnFactsJson(aiResponse({ taxYear: "2025" }));
    expect(parsed.facts.taxYear).toBe(2025);
    expect(parsed.warnings.length).toBe(1);
    expect(parsed.warnings[0]).toContain("taxYear");
    expect(() => parseTaxReturnFactsJson(aiResponse({ taxYear: "2019" }))).toThrow(
      TaxReturnParseError,
    );
  });

  it("preserves entity arrays instead of flattening them to an object", () => {
    const raw = JSON.stringify({
      isAmended: false,
      facts: {
        taxYear: 2025,
        k1s: [
          { entityName: "Ridge Partners LLC", ein: "12-3456789",
            entityType: "partnership", ordinaryBusinessIncome: 42000,
            rentalIncome: null, guaranteedPayments: "30,000", section179: null,
            w2WagesFromEntity: null, qbiIncome: 42000, isSstb: false },
        ],
        businesses: [],
      },
    });

    const { facts, warnings } = parseTaxReturnFactsJson(raw);

    expect(Array.isArray(facts.k1s)).toBe(true);
    expect(facts.k1s).toHaveLength(1);
    expect(facts.k1s[0].entityName).toBe("Ridge Partners LLC");
    // Per-element string coercion still applies inside the array.
    expect(facts.k1s[0].guaranteedPayments).toBe(30000);
    expect(warnings.some((w) => w.includes("k1s.0.guaranteedPayments"))).toBe(true);
  });

  it("drops unknown keys inside an array element with a warning", () => {
    const raw = JSON.stringify({
      isAmended: false,
      facts: {
        taxYear: 2025,
        k1s: [
          { entityName: "X", ein: null, entityType: null,
            ordinaryBusinessIncome: null, rentalIncome: null,
            guaranteedPayments: null, section179: null, w2WagesFromEntity: null,
            qbiIncome: null, isSstb: null, box20Code: "Z" },
        ],
      },
    });

    const { facts, warnings } = parseTaxReturnFactsJson(raw);

    expect(facts.k1s).toHaveLength(1);
    expect(warnings.some((w) => w.includes("box20Code"))).toBe(true);
  });

  it("coerces a non-array into an empty array rather than failing the parse", () => {
    const raw = JSON.stringify({
      isAmended: false,
      facts: { taxYear: 2025, k1s: null, businesses: "none" },
    });

    const { facts, warnings } = parseTaxReturnFactsJson(raw);

    expect(facts.k1s).toEqual([]);
    expect(facts.businesses).toEqual([]);
    expect(warnings.some((w) => w.includes("businesses"))).toBe(true);
  });
});
