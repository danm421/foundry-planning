import { describe, it, expect } from "vitest";
import type { ClientData, EntitySummary } from "@/engine/types";
import type { ScenarioChange, TargetKind } from "@/engine/scenario/types";
import { applyScenarioChanges } from "@/engine/scenario/applyChanges";
import { mutationsToScenarioChanges } from "../mutations-to-scenario-changes";
import type { SolverScenarioChangeDraft } from "../types";

const source = {
  client: {}, planSettings: { planStartYear: 2026 },
  accounts: [], incomes: [], expenses: [], savingsRules: [],
  gifts: [], externalBeneficiaries: [], entities: [],
} as unknown as ClientData;

const ilit: EntitySummary = { id: "t1", name: "ILIT", entityType: "trust", isIrrevocable: true, isGrantor: false, includeInPortfolio: false, grantor: "client", trustSubType: "ilit", crummeyPowers: true };

/** The same source tree with the trust already in the BASE plan. */
const withBaseTrust = { ...source, entities: [ilit] } as unknown as ClientData;

/** The reload leg: drafts → ScenarioChange rows → replay onto the base tree. */
function replay(base: ClientData, drafts: SolverScenarioChangeDraft[]): ClientData {
  const changes: ScenarioChange[] = drafts.map((d, i) => ({
    id: `c${i}`,
    scenarioId: "s1",
    opType: d.opType,
    targetKind: d.targetKind as TargetKind,
    targetId: d.targetId,
    payload: d.payload,
    toggleGroupId: null,
    orderIndex: d.orderIndex,
  }));
  return applyScenarioChanges(structuredClone(base), changes, {}, []).effectiveTree;
}

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

// ── I6: editing a BASE-PLAN trust ───────────────────────────────────────────
//
// Spec §Testing names this one explicitly, with a reload assertion, and names
// the failure: "an `add` against an id that already exists in base is the
// failure that would make a scenario DUPLICATE the client's trust." Editing
// base-plan trusts is this branch's headline feature, and nothing pinned it.

describe("mutationsToScenarioChanges — editing a BASE-PLAN trust", () => {
  it("emits an `edit`, not an `add`, and reloads to ONE trust", () => {
    const drafts = mutationsToScenarioChanges(withBaseTrust, "client-1", [
      { kind: "entity-upsert", id: "t1", value: { ...ilit, trustee: "Linda", name: "Smith ILIT" } },
    ]);
    const row = drafts.find((d) => d.targetId === "t1");
    expect(row).toMatchObject({ opType: "edit", targetKind: "entity", targetId: "t1" });
    // An edit carries only the fields that moved.
    expect(Object.keys(row!.payload as Record<string, unknown>).sort()).toEqual(["name", "trustee"]);

    const reloaded = replay(withBaseTrust, drafts);
    // The headline assertion: ONE trust, not two.
    expect(reloaded.entities?.map((e) => e.id)).toEqual(["t1"]);
    const after = reloaded.entities![0];
    expect(after.trustee).toBe("Linda");
    expect(after.name).toBe("Smith ILIT");
    // Untouched fields survive the edit — an `add` would have replaced the row
    // wholesale and this is what distinguishes the two.
    expect(after.trustSubType).toBe("ilit");
    expect(after.crummeyPowers).toBe(true);
  });

  it("emits a `remove` for a base-plan trust, and the reload drops it", () => {
    const drafts = mutationsToScenarioChanges(withBaseTrust, "client-1", [
      { kind: "entity-upsert", id: "t1", value: null },
    ]);
    expect(drafts.find((d) => d.targetId === "t1")?.opType).toBe("remove");
    expect(replay(withBaseTrust, drafts).entities ?? []).toEqual([]);
  });

  it("keeps a numeric field a NUMBER across the round trip", () => {
    // A numeric that arrives from the DB as a string makes the engine
    // concatenate: `1 + "0.03"` is `"10.03"`. `"0.03" == 0.03` is true, so the
    // assertion has to be on `typeof`.
    const drafts = mutationsToScenarioChanges(withBaseTrust, "client-1", [
      { kind: "entity-upsert", id: "t1", value: { ...ilit, distributionPercent: 0.03 } },
    ]);
    const after = replay(withBaseTrust, drafts).entities![0];
    expect(after.distributionPercent).toBe(0.03);
    expect(typeof after.distributionPercent).toBe("number");
  });
});
