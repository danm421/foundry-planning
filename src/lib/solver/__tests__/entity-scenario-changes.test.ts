import { describe, it, expect } from "vitest";
import type { ClientData, EntitySummary } from "@/engine/types";
import { mutationsToScenarioChanges } from "../mutations-to-scenario-changes";

const source = {
  client: {}, planSettings: { planStartYear: 2026 },
  accounts: [], incomes: [], expenses: [], savingsRules: [],
  gifts: [], externalBeneficiaries: [], entities: [],
} as unknown as ClientData;

const ilit: EntitySummary = { id: "t1", name: "ILIT", entityType: "trust", isIrrevocable: true, isGrantor: false, includeInPortfolio: false, grantor: "client", trustSubType: "ilit", crummeyPowers: true };

describe("mutationsToScenarioChanges — entity-upsert", () => {
  it("emits an add row with targetKind 'entity' carrying the entity", () => {
    const drafts = mutationsToScenarioChanges(source, "client-1", [
      { kind: "entity-upsert", id: "t1", value: ilit },
    ]);
    const row = drafts.find((d) => d.targetId === "t1");
    expect(row).toMatchObject({ opType: "add", targetKind: "entity", targetId: "t1" });
    expect(row?.payload).toMatchObject({ trustSubType: "ilit", isIrrevocable: true });
  });

  it("emits nothing for a delete of a never-saved entity", () => {
    const drafts = mutationsToScenarioChanges(source, "client-1", [
      { kind: "entity-upsert", id: "t1", value: null },
    ]);
    expect(drafts.find((d) => d.targetId === "t1")).toBeUndefined();
  });
});
