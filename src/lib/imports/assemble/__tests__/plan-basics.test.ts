import { describe, it, expect } from "vitest";
import {
  derivePlanBasics,
  RETIREMENT_SPENDING_REPLACEMENT_RATIO,
  type DerivePlanBasicsInput,
} from "../plan-basics";
import type { ImportPayload } from "../../types";

function payload(over: Partial<ImportPayload> = {}): ImportPayload {
  return {
    dependents: [], accounts: [], incomes: [], expenses: [], liabilities: [],
    lifePolicies: [], wills: [], entities: [], savings: [], warnings: [], ...over,
  };
}

function input(over: Partial<DerivePlanBasicsInput> = {}): DerivePlanBasicsInput {
  return {
    payload: payload(),
    known: { retirementAge: 65, lifeExpectancy: 92, hasSpouse: false, primaryDob: "1972-06-14" },
    mode: "new",
    taxReturn: null,
    ...over,
  };
}

describe("retirement age / life expectancy provenance", () => {
  it("labels a new build as build_request", () => {
    const b = derivePlanBasics(input({ mode: "new" }));
    expect(b.retirementAge).toEqual({ value: 65, provenance: "build_request" });
    expect(b.lifeExpectancy).toEqual({ value: 92, provenance: "build_request" });
  });

  it("labels a refresh as client_record", () => {
    const b = derivePlanBasics(input({ mode: "refresh" }));
    expect(b.retirementAge.provenance).toBe("client_record");
  });
});

describe("spouse fields", () => {
  it("omits the spouse pair entirely for a single filer", () => {
    const b = derivePlanBasics(input({ known: { retirementAge: 65, lifeExpectancy: 92, hasSpouse: false } }));
    expect(b.spouseRetirementAge).toBeUndefined();
    expect(b.spouseLifeExpectancy).toBeUndefined();
  });

  it("emits the spouse pair when the household has a spouse", () => {
    const b = derivePlanBasics(input({
      known: { retirementAge: 65, lifeExpectancy: 92, hasSpouse: true,
               spouseRetirementAge: 65, spouseLifeExpectancy: 90 },
    }));
    expect(b.spouseRetirementAge?.value).toBe(65);
    expect(b.spouseLifeExpectancy?.value).toBe(90);
  });

  it("blanks the spouse pair, flagged, when the household has a spouse but no known values", () => {
    const b = derivePlanBasics(input({
      known: { retirementAge: 65, lifeExpectancy: 92, hasSpouse: true },
    }));
    expect(b.spouseRetirementAge).toEqual({ value: null, provenance: "derived" });
    expect(b.spouseLifeExpectancy).toEqual({ value: null, provenance: "derived" });
  });
});

describe("currentLivingSpending", () => {
  it("is blank when there is no evidence at all", () => {
    const b = derivePlanBasics(input());
    expect(b.currentLivingSpending.value).toBeNull();
  });

  it("derives AGI minus total tax and discloses the taxable-saving blind spot", () => {
    const b = derivePlanBasics(input({ taxReturn: { taxYear: 2025, agi: 124624, totalTax: 14210 } }));
    expect(b.currentLivingSpending.value).toBe(110414);
    expect(b.currentLivingSpending.provenance).toBe("derived");
    expect(b.currentLivingSpending.reason).toBe(
      "Estimated from the 2025 return: AGI minus total tax. Does not account for saving into taxable accounts.",
    );
  });

  it("is blank when the return is missing agi", () => {
    const b = derivePlanBasics(input({ taxReturn: { taxYear: 2025, agi: null, totalTax: 14210 } }));
    expect(b.currentLivingSpending.value).toBeNull();
  });

  it("is blank when the return is missing totalTax — never a partial calculation", () => {
    const b = derivePlanBasics(input({ taxReturn: { taxYear: 2025, agi: 124624, totalTax: null } }));
    expect(b.currentLivingSpending.value).toBeNull();
  });

  it("prefers an extracted living expense over the tax derivation", () => {
    const b = derivePlanBasics(input({
      payload: payload({
        expenses: [{ name: "Living", type: "living", annualAmount: 90000 } as unknown as ImportPayload["expenses"][number]],
      }),
      taxReturn: { taxYear: 2025, agi: 124624, totalTax: 14210 },
    }));
    expect(b.currentLivingSpending.value).toBe(90000);
    expect(b.currentLivingSpending.provenance).toBe("document");
    // A single contributing row is not a "combination" — nothing to disclose.
    expect(b.currentLivingSpending.reason).toBeUndefined();
  });

  it("sums multiple extracted living-expense rows and discloses the count", () => {
    const b = derivePlanBasics(input({
      payload: payload({
        expenses: [
          { name: "Housing", type: "living", annualAmount: 24000 } as unknown as ImportPayload["expenses"][number],
          { name: "Groceries", type: "living", annualAmount: 12000 } as unknown as ImportPayload["expenses"][number],
          { name: "Utilities", type: "living", annualAmount: 6000 } as unknown as ImportPayload["expenses"][number],
        ],
      }),
    }));
    expect(b.currentLivingSpending.value).toBe(42000);
    expect(b.currentLivingSpending.provenance).toBe("document");
    expect(b.currentLivingSpending.reason).toBe(
      "Summed from 3 extracted living-expense rows.",
    );
  });

  it("excludes rows that fail the amount check from both the sum and the count", () => {
    const b = derivePlanBasics(input({
      payload: payload({
        expenses: [
          { name: "Housing", type: "living", annualAmount: 24000 } as unknown as ImportPayload["expenses"][number],
          { name: "Zero", type: "living", annualAmount: 0 } as unknown as ImportPayload["expenses"][number],
          { name: "Negative", type: "living", annualAmount: -500 } as unknown as ImportPayload["expenses"][number],
          { name: "NonFinite", type: "living", annualAmount: Infinity } as unknown as ImportPayload["expenses"][number],
          { name: "NonNumeric", type: "living", annualAmount: "n/a" } as unknown as ImportPayload["expenses"][number],
        ],
      }),
    }));
    // Only "Housing" clears numericAmount — one contributing row, no reason.
    expect(b.currentLivingSpending.value).toBe(24000);
    expect(b.currentLivingSpending.provenance).toBe("document");
    expect(b.currentLivingSpending.reason).toBeUndefined();
  });
});

describe("retirementLivingSpending", () => {
  it("applies the replacement ratio to whatever current spending resolved to", () => {
    const b = derivePlanBasics(input({ taxReturn: { taxYear: 2025, agi: 124624, totalTax: 14210 } }));
    expect(b.retirementLivingSpending.value).toBe(
      Math.round(110414 * RETIREMENT_SPENDING_REPLACEMENT_RATIO),
    );
    expect(b.retirementLivingSpending.reason).toBe(
      "Estimated at 80% of current living expenses.",
    );
  });

  it("stays blank when current spending is blank — the ratio is never applied to nothing", () => {
    const b = derivePlanBasics(input());
    expect(b.retirementLivingSpending.value).toBeNull();
  });

  it("cascades off the summed living-expense figure when multiple rows contributed", () => {
    const b = derivePlanBasics(input({
      payload: payload({
        expenses: [
          { name: "Housing", type: "living", annualAmount: 24000 } as unknown as ImportPayload["expenses"][number],
          { name: "Groceries", type: "living", annualAmount: 12000 } as unknown as ImportPayload["expenses"][number],
        ],
      }),
    }));
    expect(b.currentLivingSpending.value).toBe(36000);
    expect(b.retirementLivingSpending.value).toBe(
      Math.round(36000 * RETIREMENT_SPENDING_REPLACEMENT_RATIO),
    );
  });
});

describe("social security", () => {
  it("emits one entry per person and blanks PIA with no evidence", () => {
    const b = derivePlanBasics(input({
      known: { retirementAge: 65, lifeExpectancy: 92, hasSpouse: true,
               primaryDob: "1972-06-14", spouseDob: "1970-09-02" },
    }));
    expect(b.socialSecurity.map((s) => s.owner)).toEqual(["client", "spouse"]);
    expect(b.socialSecurity[0].pia.value).toBeNull();
  });

  it("defaults claiming age to FRA for a post-1960 birth year", () => {
    const b = derivePlanBasics(input());
    expect(b.socialSecurity[0].claimingAge.value).toBe(67);
    expect(b.socialSecurity[0].claimingAge.provenance).toBe("derived");
    expect(b.socialSecurity[0].claimingAge.reason).toBe(
      "Defaulted to full retirement age (67) for a 1972 birth year.",
    );
  });

  it("falls back to 67 when no date of birth is known", () => {
    const b = derivePlanBasics(input({
      known: { retirementAge: 65, lifeExpectancy: 92, hasSpouse: false },
    }));
    expect(b.socialSecurity[0].claimingAge.value).toBe(67);
  });

  /**
   * `pia` commits to `incomes.pia_monthly` under `ssBenefitMode: "pia_at_fra"`,
   * so it must be MONTHLY. Extraction reads an ANNUAL benefit off the document;
   * leaving that annual figure in the field would overstate Social Security 12x
   * once committed. The planner's producer (apply-decisions.ts) is already
   * monthly, which is why the conversion belongs here rather than at the commit
   * write site.
   */
  it("converts the extracted ANNUAL benefit into a MONTHLY PIA", () => {
    const b = derivePlanBasics(input({
      payload: payload({
        incomes: [
          { type: "social_security", name: "Social Security", annualAmount: 40200, owner: "client" },
        ],
      }),
    }));
    expect(b.socialSecurity[0].pia.value).toBe(3350);
    // Same document fact in different units — not a re-derivation.
    expect(b.socialSecurity[0].pia.provenance).toBe("document");
  });

  it("rounds the monthly PIA to the 2 decimals the pia_monthly column stores", () => {
    const b = derivePlanBasics(input({
      payload: payload({
        incomes: [
          { type: "social_security", name: "Social Security", annualAmount: 40000, owner: "client" },
        ],
      }),
    }));
    // 40000 / 12 = 3333.3333… — stored as decimal(15,2).
    expect(b.socialSecurity[0].pia.value).toBe(3333.33);
  });
});
