import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { isEstateFlowGiftDraft, normalizeScenarioGifts } from "../normalize-scenario-gifts";
import { withSynthesizedPremiumGifts } from "@/lib/insurance-policies/premium-gift";

function tree(over: Partial<ClientData> = {}): ClientData {
  return {
    client: { dateOfBirth: "1960-01-01", retirementAge: 65, lifeExpectancy: 90 },
    planSettings: { planStartYear: 2026, planEndYear: 2060, inflationRate: 0.025 },
    accounts: [], incomes: [], expenses: [], savingsRules: [], liabilities: [],
    entities: [], externalBeneficiaries: [], gifts: [], giftEvents: [],
    taxYearRows: [], familyMembers: [],
    ...over,
  } as unknown as ClientData;
}

const draft: EstateFlowGift = {
  kind: "cash-once", id: "g1", year: 2030, amount: 50_000,
  grantor: "client", recipient: { kind: "external_beneficiary", id: "c1" }, crummey: false,
};

describe("isEstateFlowGiftDraft", () => {
  it("identifies draft-shaped entries vs base Gift rows", () => {
    expect(isEstateFlowGiftDraft(draft)).toBe(true);
    expect(isEstateFlowGiftDraft({ id: "x", year: 2028, amount: 1, grantor: "client", useCrummeyPowers: false })).toBe(false);
    expect(isEstateFlowGiftDraft(null)).toBe(false);
  });
});

describe("normalizeScenarioGifts", () => {
  it("rebuilds giftEvents from draft entries while preserving base gifts/events", () => {
    // tree.gifts mixes a base Gift row with a scenario draft (as applyScenarioChanges leaves it).
    const baseGift = { id: "base", year: 2027, amount: 10_000, grantor: "client", useCrummeyPowers: false };
    const baseEvent = { kind: "cash", year: 2027, amount: 10_000, grantor: "client", useCrummeyPowers: false };
    const t = tree({
      gifts: [baseGift as never, draft as never],
      giftEvents: [baseEvent as never],
    });
    const out = normalizeScenarioGifts(t, 0.025);
    expect(out.gifts!.some((g) => g.id === "base")).toBe(true);
    expect(out.gifts!.some((g) => g.id === "g1")).toBe(true);
    // No draft-shaped entries remain in gifts.
    expect(out.gifts!.every((g) => !isEstateFlowGiftDraft(g))).toBe(true);
    // Base + scenario events both present, sorted.
    expect(out.giftEvents!.filter((e) => e.kind === "cash")).toHaveLength(2);
  });

  it("is a no-op when there are no draft entries", () => {
    const t = tree({ gifts: [{ id: "base", year: 2027, amount: 10_000, grantor: "client", useCrummeyPowers: false } as never] });
    expect(normalizeScenarioGifts(t, 0.025)).toBe(t);
  });

  it("scenario gift survives premium-gift synthesis (pipeline composition)", () => {
    const t = tree({ gifts: [draft as never] });
    const out = withSynthesizedPremiumGifts(normalizeScenarioGifts(t, 0.025));
    expect(out.giftEvents!.some((e) => e.kind === "cash" && e.year === 2030 && e.amount === 50_000)).toBe(true);
  });
});
