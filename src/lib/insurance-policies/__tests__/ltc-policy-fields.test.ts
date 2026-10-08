// src/lib/insurance-policies/__tests__/ltc-policy-fields.test.ts
import { describe, it, expect } from "vitest";
import { normalizeLtcPolicyFields, withLtcKind, type LtcPolicyFields } from "../ltc-policy-fields";
import { ltcPolicyCreateSchema, LTC_STANDALONE_DEFAULTS } from "@/lib/schemas/ltc-policies";

const LIFE = "20000000-0000-4000-8000-000000000001";
const standalone: LtcPolicyFields = {
  name: "  Genworth  ", insured: "client", carrier: "  ", issueYear: 2018, ...LTC_STANDALONE_DEFAULTS,
  annualPremium: 2400, partnership: false, notes: "",
};

describe("normalizeLtcPolicyFields", () => {
  it("trims text and turns blank carrier and notes into null", () => {
    const n = normalizeLtcPolicyFields(standalone);
    expect(n.name).toBe("Genworth");
    expect(n.carrier).toBeNull();
    expect(n.notes).toBeNull();
  });

  it("clears rider-only fields on a standalone policy and the unused premium companion", () => {
    const n = normalizeLtcPolicyFields({
      ...standalone, lifePolicyAccountId: LIFE, riderMonthlyPct: 0.02, extensionYears: 2,
      premiumPayMode: "lifetime", premiumPayToAge: 65,
    });
    expect(n).toMatchObject({ lifePolicyAccountId: null, riderMonthlyPct: null, extensionYears: 0, premiumPayToAge: null });
  });

  it("clears standalone-only fields and the premium on a rider", () => {
    const rider = withLtcKind({ ...standalone, lifePolicyAccountId: LIFE }, "life_rider");
    const n = normalizeLtcPolicyFields({ ...rider, lifePolicyAccountId: LIFE, annualPremium: 900, sharedCare: true });
    expect(n).toMatchObject({
      benefitPeriodMode: null, benefitPeriodYears: null, sharedCare: false, annualPremium: 0,
      premiumPayMode: "paid_up", benefitAmount: 0,
    });
  });

  // Review Focus 3: switching kind back and forth leaves no leftovers.
  it("round-trips Traditional → Rider → Traditional into a body the create schema accepts", () => {
    const there = withLtcKind({ ...standalone, lifePolicyAccountId: LIFE }, "life_rider");
    const back = withLtcKind({ ...there, lifePolicyAccountId: LIFE }, "standalone");
    const body = normalizeLtcPolicyFields(back);
    expect(body.lifePolicyAccountId).toBeNull();
    expect(ltcPolicyCreateSchema.safeParse(body).success).toBe(true);
  });
});
