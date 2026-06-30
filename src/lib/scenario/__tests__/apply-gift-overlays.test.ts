import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";
import { applyGiftOverlays } from "../apply-gift-overlays";

function tree(): ClientData {
  return {
    planSettings: { planStartYear: 2026, planEndYear: 2060, inflationRate: 0.025, taxInflationRate: 0.025 },
    accounts: [{ id: "acct-1", name: "B", category: "taxable", value: 500000 }],
    liabilities: [], taxYearRows: [],
    gifts: [{ id: "base-g", year: 2030, amount: 10000, grantor: "client", useCrummeyPowers: false }],
    giftEvents: [{ kind: "cash", year: 2030, amount: 10000, grantor: "client", useCrummeyPowers: false, sourceGiftId: "base-g" }],
  } as unknown as ClientData;
}
const ch = (opType: "add" | "remove", targetId: string, payload: unknown): ScenarioChange => ({
  id: "c", scenarioId: "s", opType, targetKind: "gift", targetId, payload, toggleGroupId: null, orderIndex: 0,
} as ScenarioChange);

it("add-over-base-id overrides in place", () => {
  const out = applyGiftOverlays(tree(), [ch("add", "base-g", { kind: "cash-once", id: "base-g", year: 2030, amount: 25000, grantor: "client", recipient: { kind: "entity", id: "t1" }, crummey: false })], 0.025);
  const cash = out.giftEvents.filter((e) => e.kind === "cash");
  expect(cash).toHaveLength(1);
  expect((cash[0] as { amount: number }).amount).toBe(25000);
});

it("remove strips the base footprint", () => {
  const out = applyGiftOverlays(tree(), [ch("remove", "base-g", null)], 0.025);
  expect(out.giftEvents).toHaveLength(0);
  expect(out.gifts).toHaveLength(0);
});

it("no gift changes is identity", () => {
  const t = tree();
  const out = applyGiftOverlays(t, [], 0.025);
  expect(out).toBe(t);
});
