import { describe, it, expect } from "vitest";
import { ltcBenefitText, ltcInflationText, ltcPremiumText, ltcSummaryText, ltcTypeText } from "../ltc-labels";
import type { LtcPolicy } from "@/engine/types";
import { LTC_RIDER_DEFAULTS, LTC_STANDALONE_DEFAULTS } from "@/lib/schemas/ltc-policies";

const standalone: LtcPolicy = {
  id: "s", name: "Genworth", insured: "client", carrier: null, issueYear: 2026,
  ...LTC_STANDALONE_DEFAULTS, annualPremium: 2400, partnership: false, notes: null,
};
const rider: LtcPolicy = {
  id: "r", name: "Rider", insured: "client", carrier: null, issueYear: 2026,
  ...LTC_RIDER_DEFAULTS, lifePolicyAccountId: "a1", partnership: false, notes: null,
};

describe("LTC labels", () => {
  it("words a standalone policy", () => {
    expect(ltcTypeText(standalone, null)).toBe("Traditional");
    expect(ltcBenefitText(standalone, null)).toBe("$6,000/mo · 3 yrs");
    expect(ltcBenefitText({ ...standalone, benefitAmount: 200, benefitUnit: "day", benefitPeriodMode: "lifetime" }, null)).toBe("$200/day · lifetime");
    expect(ltcInflationText(standalone)).toBe("3% compound");
    expect(ltcPremiumText(standalone)).toBe("$2,400/yr for life");
    expect(ltcPremiumText({ ...standalone, premiumPayMode: "to_age", premiumPayToAge: 65 })).toBe("$2,400/yr to age 65");
  });

  it("reads a $0 premium as not entered, and only a paid-up policy as paid up", () => {
    expect(ltcPremiumText({ ...standalone, annualPremium: 0 })).toBe("No premium entered");
    expect(ltcPremiumText({ ...standalone, premiumPayMode: "paid_up" })).toBe("Paid up");
    expect(ltcPremiumText({ ...standalone, annualPremium: 0, premiumPayMode: "paid_up" })).toBe("Paid up");
  });

  it("words a rider, with and without the face value", () => {
    expect(ltcTypeText(rider, "Whole Life")).toBe("Rider on Whole Life");
    expect(ltcBenefitText(rider, 500_000)).toBe("2% of $500,000/mo");
    expect(ltcBenefitText(rider, null)).toBe("2% of the death benefit/mo");
    expect(ltcInflationText(rider)).toBe("None");
    expect(ltcPremiumText(rider)).toBe("In the life premium");
  });

  it("reads back what a policy pays", () => {
    expect(ltcSummaryText(standalone, null, 2026)).toBe("Pays up to $6,000/mo in 2026, from a pool of about $216,000.");
    expect(ltcSummaryText(rider, 500_000, 2026)).toBe(
      "Pays up to $10,000/mo for about 50 months; at least $0 left to heirs.",
    );
    expect(ltcSummaryText({ ...rider, residualDeathBenefit: 25_000, extensionYears: 2 }, 500_000, 2026)).toBe(
      "Pays up to $10,000/mo for about 47 months, then 24 more months; at least $25,000 left to heirs.",
    );
    // No face value (its life policy is missing): say nothing rather than invent one.
    expect(ltcSummaryText(rider, null, 2026)).toBeNull();
  });

  it("names the total when a rider's pool is smaller than one month's benefit", () => {
    const thin = { ...rider, residualDeathBenefit: 495_000 };
    expect(ltcSummaryText(thin, 500_000, 2026)).toBe(
      "Pays at most $5,000 in total; at least $495,000 left to heirs.",
    );
    expect(ltcSummaryText({ ...thin, extensionYears: 2 }, 500_000, 2026)).toBe(
      "Pays at most $5,000 in total, then 24 more months; at least $495,000 left to heirs.",
    );
  });

  it("describes a policy issued in a later year as of its issue year", () => {
    expect(ltcSummaryText({ ...standalone, issueYear: 2030 }, null, 2026)).toBe(
      "Pays up to $6,000/mo in 2030, from a pool of about $216,000.",
    );
  });
});
