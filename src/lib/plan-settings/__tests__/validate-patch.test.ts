import { describe, it, expect, vi, afterEach } from "vitest";
import { validatePlanSettingsPatch, GROWTH_SOURCE_VALUES, INFLATION_SOURCE_VALUES } from "../validate-patch";
import { growthSourceEnum, inflationRateSourceEnum } from "@/db/schema";

describe("validatePlanSettingsPatch", () => {
  it("accepts an empty patch and in-range values, as numbers or decimal strings", () => {
    expect(validatePlanSettingsPatch({})).toBeNull();
    expect(
      validatePlanSettingsPatch({
        flatStateRate: "0.06",
        irdTaxRate: 0.37,
        surplusSpendPct: "1",
        residenceState: "CA",
        coveredByWorkplacePlan: "auto",
        capitalLossCarryforwardLt: null,
      }),
    ).toBeNull();
  });

  it.each([
    ["flatFederalRate", 1.5, /flatFederalRate must be between 0 and 1/],
    ["flatStateRate", "1.5", /flatStateRate must be between 0 and 1/],
    ["irdTaxRate", -0.1, /irdTaxRate must be between 0 and 1/],
    ["surplusSpendPct", "2", /surplusSpendPct must be between 0 and 1/],
    ["medicarePremiumInflationRate", 3, /medicarePremiumInflationRate/],
    ["flatStateEstateRate", "abc", /flatStateEstateRate must be between 0 and 1/],
  ])("refuses an out-of-range or non-numeric %s", (key, value, message) => {
    expect(validatePlanSettingsPatch({ [key]: value })).toMatch(message);
  });

  it.each([
    ["estateAdminExpenses", -1],
    ["priorTaxableGiftsClient", "-5"],
    ["priorTaxableGiftsSpouse", "abc"],
    ["capitalLossCarryforwardSt", "NaN"],
    ["lifetimeExemptionCap", -1],
  ])("refuses a negative or non-numeric %s", (key, value) => {
    expect(validatePlanSettingsPatch({ [key]: value })).toMatch(
      new RegExp(`${key} must be a non-negative number`),
    );
  });

  it("refuses a residence that is not a USPS code, but allows null", () => {
    expect(validatePlanSettingsPatch({ residenceState: "ZZ" })).toMatch(/residenceState/);
    expect(validatePlanSettingsPatch({ residenceState: null })).toBeNull();
  });

  it("refuses a coverage value outside auto/yes/no", () => {
    expect(validatePlanSettingsPatch({ spouseCoveredByWorkplacePlan: "maybe" })).toMatch(
      /spouseCoveredByWorkplacePlan must be 'auto', 'yes', or 'no'/,
    );
  });

  describe("plan start year", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("accepts only this year or next year", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
      expect(validatePlanSettingsPatch({ planStartYear: 2026 })).toBeNull();
      expect(validatePlanSettingsPatch({ planStartYear: 2027 })).toBeNull();
      expect(validatePlanSettingsPatch({ planStartYear: "2027" })).toBeNull();
      for (const bad of [2025, 2028, "2020", "abc", 1999]) {
        expect(validatePlanSettingsPatch({ planStartYear: bad })).toBe("Plan start year must be 2026 or 2027");
      }
    });

    it("rejects last year once the year has turned", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2027-01-01T06:00:00Z"));
      expect(validatePlanSettingsPatch({ planStartYear: 2026 })).toBe("Plan start year must be 2027 or 2028");
    });
  });

  describe("growth & inflation columns", () => {
    const NEVER_EMPTY = [
      "inflationRate",
      "defaultGrowthTaxable",
      "defaultGrowthCash",
      "defaultGrowthRetirement",
      "defaultGrowthRealEstate",
      "defaultGrowthBusiness",
      "defaultGrowthLifeInsurance",
      "medicarePremiumInflationRate",
    ];

    it("accepts the values the form sends, including a negative growth rate", () => {
      expect(
        validatePlanSettingsPatch({
          inflationRate: "0.03",
          defaultGrowthTaxable: 0.07,
          defaultGrowthCash: "-0.01",
          medicarePremiumInflationRate: "0.03",
          inflationRateSource: "asset_class",
          growthSourceTaxable: "model_portfolio",
          growthSourceRealEstate: "inflation",
          modelPortfolioIdTaxable: null,
          taxInflationRate: null,
          ssWageGrowthRate: null,
        }),
      ).toBeNull();
    });

    it.each(NEVER_EMPTY.flatMap((k) => [[k, ""], [k, "  "], [k, null], [k, "abc"], [k, Number.NaN]] as const))(
      "refuses a blank, null or non-finite %s (%j)",
      (key, value) => {
        expect(validatePlanSettingsPatch({ [key]: value })).toMatch(new RegExp(`${key} must be a number`));
      },
    );

    it("refuses a rate the 5,4 decimal column cannot hold", () => {
      expect(validatePlanSettingsPatch({ defaultGrowthTaxable: 10 })).toBe(
        "Default growth — taxable must be between -1000% and 1000%",
      );
      expect(validatePlanSettingsPatch({ inflationRate: "-12" })).toBe(
        "Inflation rate must be between -1000% and 1000%",
      );
    });

    it.each([
      ["inflationRateSource", "inflation"],
      ["inflationRateSource", null],
      ["growthSourceTaxable", "bogus"],
      ["growthSourceCash", null],
      ["growthSourceLifeInsurance", ""],
    ])("refuses an out-of-enum %s (%j)", (key, value) => {
      expect(validatePlanSettingsPatch({ [key]: value })).toMatch(new RegExp(`${key} must be one of`));
    });

    it("leaves an absent key alone", () => {
      expect(validatePlanSettingsPatch({ residenceState: "CA" })).toBeNull();
    });
  });

  // The validator mirrors the schema enums (it ships in the client bundle and
  // cannot import the schema); this pins the two copies together.
  it("lists exactly the schema's growth and inflation source values", () => {
    expect([...GROWTH_SOURCE_VALUES].sort()).toEqual([...growthSourceEnum.enumValues].sort());
    expect([...INFLATION_SOURCE_VALUES].sort()).toEqual([...inflationRateSourceEnum.enumValues].sort());
  });
});
