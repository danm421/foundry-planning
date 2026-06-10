import { describe, it, expect } from "vitest";
import type { ClientData, GiftEvent } from "@/engine/types";
import type { TargetKind, ScenarioChange } from "@/engine/scenario/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import type { SolverMutation } from "../types";
import { applyMutations } from "../apply-mutations";
import { mutationsToScenarioChanges } from "../mutations-to-scenario-changes";
import { applyScenarioChanges } from "@/engine/scenario/applyChanges";
import { resolveRefYears } from "@/lib/year-refs";
import { normalizeScenarioGifts } from "@/lib/scenario/normalize-scenario-gifts";

function tree(): ClientData {
  return {
    client: { dateOfBirth: "1960-01-01", retirementAge: 65, lifeExpectancy: 90 },
    planSettings: { planStartYear: 2026, planEndYear: 2060, inflationRate: 0.025, taxInflationRate: 0.025 },
    accounts: [{ id: "acct-1", name: "Brokerage", category: "taxable", value: 500_000 }],
    incomes: [], expenses: [], savingsRules: [], liabilities: [],
    entities: [{ id: "trust-1", name: "ILIT", entityType: "trust", isIrrevocable: true, includeInPortfolio: false, isGrantor: false }],
    externalBeneficiaries: [], gifts: [], giftEvents: [], taxYearRows: [], familyMembers: [],
    withdrawalStrategy: [],
  } as unknown as ClientData;
}

const charity: EstateFlowGift = { kind: "cash-once", id: "g-cash", year: 2030, amount: 50_000, grantor: "client", recipient: { kind: "external_beneficiary", id: "c-new" }, crummey: false };
const assetGift: EstateFlowGift = { kind: "asset-once", id: "g-asset", year: 2031, accountId: "acct-1", percent: 0.5, grantor: "client", recipient: { kind: "entity", id: "trust-1" }, eventKind: "outright" };
const SERIES_START = 2030;
const SERIES_END = 2034;
const SERIES_ANNUAL = 18_000;
const series: EstateFlowGift = { kind: "series", id: "g-series", startYear: SERIES_START, endYear: SERIES_END, annualAmount: SERIES_ANNUAL, amountMode: "fixed", inflationAdjust: false, grantor: "client", recipient: { kind: "entity", id: "trust-1" }, crummey: true };

const muts: SolverMutation[] = [
  { kind: "external-beneficiary-upsert", id: "c-new", value: { id: "c-new", name: "Red Cross", kind: "charity", charityType: "public" } },
  { kind: "gift-upsert", id: "g-cash", value: charity },
  { kind: "gift-upsert", id: "g-asset", value: assetGift },
  { kind: "gift-upsert", id: "g-series", value: series },
];

/** Canonical JSON: sorts object keys at every level so the comparison is
 *  insensitive to field-insertion order (the two paths may construct giftEvent
 *  objects with the same values in a different key order). */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v as Record<string, unknown>)
            .sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]]),
        )
      : v,
  );
}

/** Stable comparison keys independent of array order AND object key order. */
function eventKeys(events: GiftEvent[]): string[] {
  return events.map(canonical).sort();
}

describe("gift round-trip parity (live ≡ reload, gift fields)", () => {
  it("applyMutations gift fields match the reload pipeline's", () => {
    const base = tree();

    // Live path.
    const live = applyMutations(base, muts);

    // Reload path: mutations → scenario changes → applyScenarioChanges →
    // resolveRefYears → normalizeScenarioGifts.
    const drafts = mutationsToScenarioChanges(base, "client-1", muts);
    const changes: ScenarioChange[] = drafts.map((d, i) => ({
      id: `c${i}`,
      scenarioId: "s1",
      opType: d.opType,
      // SolverScenarioChangeDraft.targetKind is a superset of the engine's TargetKind
      // (both now carry "gift"/"external_beneficiary"); the cast documents that.
      targetKind: d.targetKind as TargetKind,
      targetId: d.targetId,
      payload: d.payload,
      toggleGroupId: null,
      orderIndex: d.orderIndex,
    }));
    const { effectiveTree } = applyScenarioChanges(base, changes, {}, []);
    const cpi = effectiveTree.planSettings.taxInflationRate ?? effectiveTree.planSettings.inflationRate ?? 0;
    const reload = normalizeScenarioGifts(resolveRefYears(effectiveTree), cpi);

    // The charity persisted + reloaded.
    expect(reload.externalBeneficiaries?.some((b) => b.id === "c-new")).toBe(true);
    // giftEvents match by value (order-independent).
    expect(eventKeys(reload.giftEvents)).toEqual(eventKeys(live.giftEvents));
    // Series fanned into multiple yearly events (>1, deliberately loose: proves
    // the fan-out happened without pinning the exact per-year count).
    expect(
      live.giftEvents.filter(
        (e) =>
          e.kind === "cash" &&
          e.year >= SERIES_START &&
          e.year <= SERIES_END &&
          e.amount === SERIES_ANNUAL,
      ).length,
    ).toBeGreaterThan(1);
  });
});
