import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { mutationsToScenarioChanges } from "../mutations-to-scenario-changes";

const source = {
  client: {}, planSettings: { planStartYear: 2026 },
  accounts: [], incomes: [], expenses: [], savingsRules: [],
  gifts: [], externalBeneficiaries: [],
} as unknown as ClientData;

const gift: EstateFlowGift = {
  kind: "cash-once", id: "g1", year: 2030, amount: 50_000,
  grantor: "client", recipient: { kind: "external_beneficiary", id: "c1" }, crummey: false,
};

describe("mutationsToScenarioChanges — gift + external_beneficiary", () => {
  it("emits an add row with targetKind 'external_beneficiary'", () => {
    const drafts = mutationsToScenarioChanges(source, "client-1", [
      { kind: "external-beneficiary-upsert", id: "c1", value: { id: "c1", name: "Red Cross", kind: "charity", charityType: "public" } },
    ]);
    const row = drafts.find((d) => d.targetId === "c1");
    expect(row).toMatchObject({ opType: "add", targetKind: "external_beneficiary", targetId: "c1" });
    expect(row?.payload).toMatchObject({ id: "c1", name: "Red Cross" });
  });

  it("emits an add row with targetKind 'gift' carrying the draft", () => {
    const drafts = mutationsToScenarioChanges(source, "client-1", [
      { kind: "gift-upsert", id: "g1", value: gift },
    ]);
    const row = drafts.find((d) => d.targetId === "g1");
    expect(row).toMatchObject({ opType: "add", targetKind: "gift", targetId: "g1" });
    expect(row?.payload).toMatchObject({ kind: "cash-once", amount: 50_000 });
  });

  it("emits a remove for a delete of a gift not in source.gifts (base asset/series)", () => {
    const drafts = mutationsToScenarioChanges(source, "client-1", [
      { kind: "gift-upsert", id: "g1", value: null },
    ]);
    const row = drafts.find((d) => d.targetId === "g1");
    expect(row).toMatchObject({ opType: "remove", targetKind: "gift", targetId: "g1", payload: null });
  });

  it("emits a single add (full payload) when an already-present gift changes", () => {
    const seeded = {
      ...source,
      gifts: [gift as never],
    } as unknown as ClientData;
    const drafts = mutationsToScenarioChanges(seeded, "client-1", [
      { kind: "gift-upsert", id: "g1", value: { ...gift, amount: 75_000 } },
    ]);
    const row = drafts.find((d) => d.targetId === "g1");
    expect(row).toMatchObject({ opType: "add", targetKind: "gift", targetId: "g1" });
    expect(row?.payload).toMatchObject({ amount: 75_000 });
  });

  it("emits a remove row when an already-present external_beneficiary is deleted", () => {
    const seeded = {
      ...source,
      externalBeneficiaries: [{ id: "c1", name: "Red Cross", kind: "charity", charityType: "public" }],
    } as unknown as ClientData;
    const drafts = mutationsToScenarioChanges(seeded, "client-1", [
      { kind: "external-beneficiary-upsert", id: "c1", value: null },
    ]);
    const row = drafts.find((d) => d.targetId === "c1");
    expect(row).toMatchObject({ opType: "remove", targetKind: "external_beneficiary", targetId: "c1", payload: null });
  });

  it("remove of a base asset/series gift not in source.gifts still emits a remove", () => {
    const src = { gifts: [], giftEvents: [] } as unknown as ClientData;
    const drafts = mutationsToScenarioChanges(src, "client-1", [
      { kind: "gift-upsert", id: "base-series", value: null },
    ]);
    const gift = drafts.find((d) => d.targetKind === "gift");
    expect(gift).toMatchObject({ opType: "remove", targetId: "base-series", targetKind: "gift" });
  });

  it("edit/add of a gift emits a single add with the full draft payload", () => {
    const src = { gifts: [], giftEvents: [] } as unknown as ClientData;
    const value = { kind: "cash-once", id: "g1", year: 2030, amount: 5000, grantor: "client", recipient: { kind: "entity", id: "t1" }, crummey: false, enabled: false } as const;
    const drafts = mutationsToScenarioChanges(src, "client-1", [{ kind: "gift-upsert", id: "g1", value }]);
    const gift = drafts.filter((d) => d.targetKind === "gift");
    expect(gift).toHaveLength(1);
    expect(gift[0]).toMatchObject({ opType: "add", targetId: "g1", payload: value });
  });
});
