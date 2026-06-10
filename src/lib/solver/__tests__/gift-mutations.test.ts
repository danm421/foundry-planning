import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { applyMutations } from "../apply-mutations";

function tree(over: Partial<ClientData> = {}): ClientData {
  return {
    client: { dateOfBirth: "1960-01-01", retirementAge: 65 },
    planSettings: { planStartYear: 2026, planEndYear: 2060, inflationRate: 0.025 },
    accounts: [],
    incomes: [],
    expenses: [],
    savingsRules: [],
    liabilities: [],
    entities: [{ id: "trust-1", name: "ILIT", entityType: "trust", isIrrevocable: true, includeInPortfolio: false, isGrantor: false }],
    externalBeneficiaries: [],
    gifts: [],
    giftEvents: [],
    taxYearRows: [],
    familyMembers: [],
    withdrawalStrategy: [],
    ...over,
  } as unknown as ClientData;
}

const cashGift: EstateFlowGift = {
  kind: "cash-once",
  id: "gift-1",
  year: 2030,
  amount: 50_000,
  grantor: "client",
  recipient: { kind: "external_beneficiary", id: "charity-1" },
  crummey: false,
  eventKind: "outright",
};

describe("applyMutations — external-beneficiary-upsert", () => {
  it("adds an external beneficiary", () => {
    const out = applyMutations(tree(), [
      { kind: "external-beneficiary-upsert", id: "charity-1", value: { id: "charity-1", name: "Red Cross", kind: "charity", charityType: "public" } },
    ]);
    expect(out.externalBeneficiaries).toHaveLength(1);
    expect(out.externalBeneficiaries?.[0]).toMatchObject({ id: "charity-1", name: "Red Cross" });
  });

  it("removes an external beneficiary on null", () => {
    const base = tree({ externalBeneficiaries: [{ id: "charity-1", name: "Red Cross", kind: "charity", charityType: "public" }] });
    const out = applyMutations(base, [
      { kind: "external-beneficiary-upsert", id: "charity-1", value: null },
    ]);
    expect(out.externalBeneficiaries).toHaveLength(0);
  });
});

describe("applyMutations — gift-upsert", () => {
  it("materialises a cash gift into giftEvents, preserving base gifts", () => {
    const base = tree({
      gifts: [{ id: "base-gift", year: 2028, amount: 10_000, grantor: "client", useCrummeyPowers: false } as never],
    });
    const out = applyMutations(base, [
      { kind: "external-beneficiary-upsert", id: "charity-1", value: { id: "charity-1", name: "Red Cross", kind: "charity", charityType: "public" } },
      { kind: "gift-upsert", id: "gift-1", value: cashGift },
    ]);
    // Base cash gift survives + the scenario cash gift is appended.
    expect(out.gifts?.some((g) => g.id === "base-gift")).toBe(true);
    expect(out.gifts?.some((g) => g.id === "gift-1")).toBe(true);
    // The scenario gift reaches giftEvents (what the engine reads).
    expect(out.giftEvents.some((e) => e.kind === "cash" && e.year === 2030 && e.amount === 50_000)).toBe(true);
  });

  it("fans an asset gift to an existing trust into an asset giftEvent", () => {
    const base = tree({ accounts: [{ id: "acct-1", name: "Brokerage", category: "taxable", value: 500_000 } as never] });
    const assetGift: EstateFlowGift = {
      kind: "asset-once", id: "gift-a", year: 2031, accountId: "acct-1", percent: 0.5,
      grantor: "client", recipient: { kind: "entity", id: "trust-1" }, eventKind: "outright",
    };
    const out = applyMutations(base, [{ kind: "gift-upsert", id: "gift-a", value: assetGift }]);
    expect(out.giftEvents.some((e) => e.kind === "asset" && e.accountId === "acct-1" && e.percent === 0.5)).toBe(true);
  });

  it("a delete (value:null) leaves no scenario gift", () => {
    const out = applyMutations(tree(), [
      { kind: "gift-upsert", id: "gift-1", value: cashGift },
      { kind: "gift-upsert", id: "gift-1", value: null },
    ]);
    expect(out.giftEvents).toHaveLength(0);
    expect(out.gifts ?? []).toHaveLength(0);
  });

  it("a lone gift-upsert:null does not wipe base gifts/giftEvents (append semantics)", () => {
    const base = tree({
      gifts: [{ id: "base-gift", year: 2028, amount: 10_000, grantor: "client", useCrummeyPowers: false } as never],
      giftEvents: [{ kind: "cash", year: 2028, amount: 10_000, grantor: "client", useCrummeyPowers: false } as never],
    });
    const out = applyMutations(base, [
      { kind: "gift-upsert", id: "never-saved", value: null },
    ]);
    // The post-loop merge appends derived (empty) onto the base, so base data survives.
    expect(out.gifts?.some((g) => g.id === "base-gift")).toBe(true);
    expect(out.giftEvents.some((e) => e.kind === "cash" && e.year === 2028)).toBe(true);
  });
});
