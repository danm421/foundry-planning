import { describe, it, expect } from "vitest";
import type { ClientData, GiftEvent } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";
import type { SolverMutation } from "../types";
import { applyMutations } from "../apply-mutations";
import { mutationsToScenarioChanges } from "../mutations-to-scenario-changes";
import { applyScenarioChanges } from "@/engine/scenario/applyChanges";
import { resolveRefYears } from "@/lib/year-refs";
import { applyGiftOverlays } from "@/lib/scenario/apply-gift-overlays";
import { SOLVER_MUTATION_SCHEMA } from "../mutation-schema";

function baseTree(): ClientData {
  return {
    client: { dateOfBirth: "1960-01-01", retirementAge: 65, lifeExpectancy: 90 },
    planSettings: { planStartYear: 2026, planEndYear: 2060, inflationRate: 0.025, taxInflationRate: 0.025 },
    accounts: [{ id: "acct-1", name: "B", category: "taxable", value: 500000 }],
    incomes: [], expenses: [], savingsRules: [], liabilities: [],
    entities: [{ id: "trust-1", name: "ILIT", entityType: "trust", isIrrevocable: true, includeInPortfolio: false, isGrantor: false }],
    externalBeneficiaries: [],
    gifts: [{ id: "base-g", year: 2030, amount: 10000, grantor: "client", useCrummeyPowers: false }],
    giftEvents: [{ kind: "cash", year: 2030, amount: 10000, grantor: "client", useCrummeyPowers: false, sourceGiftId: "base-g" }],
    taxYearRows: [], familyMembers: [], withdrawalStrategy: [],
  } as unknown as ClientData;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}
const eventKeys = (events: GiftEvent[]) => events.map(canonical).sort();

function reload(base: ClientData, muts: SolverMutation[]): ClientData {
  const drafts = mutationsToScenarioChanges(base, "client-1", muts);
  const changes: ScenarioChange[] = drafts.map((d, i) => ({
    id: `c${i}`, scenarioId: "s1", opType: d.opType, targetKind: d.targetKind as ScenarioChange["targetKind"],
    targetId: d.targetId, payload: d.payload, toggleGroupId: null, orderIndex: d.orderIndex,
  }));
  const giftChanges = changes.filter((c) => c.targetKind === "gift");
  const nonGift = changes.filter((c) => c.targetKind !== "gift");
  const { effectiveTree } = applyScenarioChanges(base, nonGift, {}, []);
  const cpi = effectiveTree.planSettings.taxInflationRate ?? effectiveTree.planSettings.inflationRate ?? 0;
  return applyGiftOverlays(resolveRefYears(effectiveTree), giftChanges, cpi);
}

const cases: Record<string, SolverMutation[]> = {
  "base edit": [{ kind: "gift-upsert", id: "base-g", value: { kind: "cash-once", id: "base-g", year: 2030, amount: 25000, grantor: "client", recipient: { kind: "entity", id: "trust-1" }, crummey: false } }],
  "base remove": [{ kind: "gift-upsert", id: "base-g", value: null }],
  "base toggle-off": [{ kind: "gift-upsert", id: "base-g", value: { kind: "cash-once", id: "base-g", year: 2030, amount: 10000, grantor: "client", recipient: { kind: "entity", id: "trust-1" }, crummey: false, enabled: false } }],
};

describe("gift round-trip parity (live ≡ reload) for base-gift ops", () => {
  for (const [name, muts] of Object.entries(cases)) {
    it(name, () => {
      const base = baseTree();
      const live = applyMutations(base, muts);
      const rl = reload(base, muts);
      expect(eventKeys(rl.giftEvents)).toEqual(eventKeys(live.giftEvents));
    });
  }
});


/**
 * The cases above hand `mutationsToScenarioChanges` a mutation object built in
 * TypeScript. The save-scenario route does not: it parses the request body with
 * SOLVER_MUTATION_SCHEMA first, and a Zod object STRIPS any key the schema
 * omits. That strip is invisible to a parity test that skips the wire — which
 * is how a saved scenario came to lose an advisor's valuation discount while
 * the live solver preview kept it. These cases put the wire back in.
 */
describe("gift round-trip through the route's Zod schema", () => {
  const discounted: SolverMutation[] = [
    {
      kind: "gift-upsert",
      id: "g-asset",
      value: {
        kind: "asset-once", id: "g-asset", year: 2030, accountId: "acct-1",
        percent: 0.15, grantor: "client", recipient: { kind: "entity", id: "trust-1" },
        valuationDiscount: 0.3,
      },
    },
  ];
  const overTheWire = () =>
    discounted.map((m) => SOLVER_MUTATION_SCHEMA.parse(m)) as SolverMutation[];

  it("keeps the valuation discount on the saved scenario's gift event", () => {
    const rl = reload(baseTree(), overTheWire());
    const asset = rl.giftEvents.find((e) => e.kind === "asset");
    expect(asset).toMatchObject({ percent: 0.15, valuationDiscount: 0.3 });
  });

  it("projects the same events as the live preview", () => {
    const base = baseTree();
    const live = applyMutations(base, discounted);
    const rl = reload(base, overTheWire());
    expect(eventKeys(rl.giftEvents)).toEqual(eventKeys(live.giftEvents));
  });
});
