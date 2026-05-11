import { describe, it, expect } from "vitest";
import {
  perYearCharitableFlows,
  charityCarryforwardTotal,
} from "../charity-flows";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { CharityCarryforward } from "@/engine/types";

function mkPlan(opts: {
  gifts: Array<{ year: number; amount: number; recipient?: string }>;
  beneficiaries: Array<{ id: string; kind: "charity" | "individual" }>;
  years: Array<{ year: number; charitableOutflows: number }>;
}): ComparisonPlan {
  return {
    index: 0,
    isBaseline: true,
    ref: { kind: "scenario", id: "x" },
    id: "x",
    label: "X",
    tree: {
      gifts: opts.gifts.map((g, i) => ({
        id: `g${i}`,
        year: g.year,
        amount: g.amount,
        grantor: "client",
        recipientExternalBeneficiaryId: g.recipient,
        useCrummeyPowers: false,
      })),
      externalBeneficiaries: opts.beneficiaries.map((b) => ({
        id: b.id,
        name: b.id,
        kind: b.kind,
        charityType: "public" as const,
      })),
    } as ComparisonPlan["tree"],
    result: {
      years: opts.years.map((y) => ({
        year: y.year,
        charitableOutflows: y.charitableOutflows,
      })) as ComparisonPlan["result"]["years"],
    } as ComparisonPlan["result"],
    lifetime: {} as ComparisonPlan["lifetime"],
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
  };
}

describe("perYearCharitableFlows", () => {
  it("sums charity cash gifts + CLUT outflows by year", () => {
    const plan = mkPlan({
      gifts: [
        { year: 2030, amount: 10_000, recipient: "ch1" },
        { year: 2030, amount: 5_000, recipient: "fam1" }, // not charity
        { year: 2031, amount: 20_000, recipient: "ch1" },
      ],
      beneficiaries: [
        { id: "ch1", kind: "charity" },
        { id: "fam1", kind: "individual" },
      ],
      years: [
        { year: 2030, charitableOutflows: 1_000 },
        { year: 2031, charitableOutflows: 0 },
        { year: 2032, charitableOutflows: 500 },
      ],
    });

    const out = perYearCharitableFlows(plan, null);
    expect(out).toEqual([
      { year: 2030, cashGiftsToCharity: 10_000, clutOutflows: 1_000, total: 11_000 },
      { year: 2031, cashGiftsToCharity: 20_000, clutOutflows: 0, total: 20_000 },
      { year: 2032, cashGiftsToCharity: 0, clutOutflows: 500, total: 500 },
    ]);
  });

  it("filters out non-charity gifts even when recipient id is missing from beneficiaries", () => {
    const plan = mkPlan({
      gifts: [{ year: 2030, amount: 999, recipient: "ghost" }],
      beneficiaries: [],
      years: [{ year: 2030, charitableOutflows: 0 }],
    });
    const out = perYearCharitableFlows(plan, null);
    expect(out[0].cashGiftsToCharity).toBe(0);
  });

  it("ignores gifts with no recipientExternalBeneficiaryId (family-member or entity gifts)", () => {
    const plan = mkPlan({
      gifts: [{ year: 2030, amount: 10_000, recipient: undefined }],
      beneficiaries: [{ id: "ch1", kind: "charity" }],
      years: [{ year: 2030, charitableOutflows: 0 }],
    });
    const out = perYearCharitableFlows(plan, null);
    expect(out[0].cashGiftsToCharity).toBe(0);
  });

  it("clips by yearRange (inclusive on both ends)", () => {
    const plan = mkPlan({
      gifts: [
        { year: 2030, amount: 10_000, recipient: "ch1" },
        { year: 2035, amount: 20_000, recipient: "ch1" },
        { year: 2040, amount: 30_000, recipient: "ch1" },
      ],
      beneficiaries: [{ id: "ch1", kind: "charity" }],
      years: [
        { year: 2030, charitableOutflows: 0 },
        { year: 2035, charitableOutflows: 0 },
        { year: 2040, charitableOutflows: 0 },
      ],
    });
    const out = perYearCharitableFlows(plan, { start: 2032, end: 2038 });
    expect(out.map((r) => r.year)).toEqual([2035]);
  });
});

describe("charityCarryforwardTotal", () => {
  it("sums all four CarryforwardEntry arrays", () => {
    const cf: CharityCarryforward = {
      cashPublic: [{ amount: 100, originYear: 2030 }, { amount: 200, originYear: 2031 }],
      cashPrivate: [{ amount: 50, originYear: 2030 }],
      appreciatedPublic: [{ amount: 25, originYear: 2031 }],
      appreciatedPrivate: [],
    };
    expect(charityCarryforwardTotal(cf)).toBe(375);
  });

  it("returns 0 for an empty carryforward", () => {
    expect(
      charityCarryforwardTotal({
        cashPublic: [],
        cashPrivate: [],
        appreciatedPublic: [],
        appreciatedPrivate: [],
      }),
    ).toBe(0);
  });

  it("returns 0 when input is undefined", () => {
    expect(charityCarryforwardTotal(undefined)).toBe(0);
  });
});
