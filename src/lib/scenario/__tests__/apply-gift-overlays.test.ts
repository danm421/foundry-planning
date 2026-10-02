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

// A recurring gift made inside a scenario is a `gift` add carrying a series
// draft. This is the form the scenario's projection reads, so an edit of it (an
// add on the same id) must replace the fanned-out events, not stack on them.
const seriesDraft = (annualAmount: number, endYear: number) => ({
  kind: "series", id: "s-new", startYear: 2030, endYear, annualAmount,
  amountMode: "fixed", inflationAdjust: false, grantor: "client",
  recipient: { kind: "entity", id: "t1" }, crummey: false,
});

it("a series-shaped gift add projects one gift event per year of the series", () => {
  const out = applyGiftOverlays(tree(), [ch("add", "s-new", seriesDraft(19000, 2032))], 0.025);
  const fanned = out.giftEvents.filter((e) => (e as { seriesId?: string }).seriesId === "s-new");
  expect(fanned.map((e) => e.year)).toEqual([2030, 2031, 2032]);
  expect(fanned.every((e) => (e as { amount: number }).amount === 19000)).toBe(true);
  // The base gift beside it is untouched.
  expect(out.giftEvents.some((e) => (e as { sourceGiftId?: string }).sourceGiftId === "base-g")).toBe(true);
});

it("editing a series is an add on the same id: the new events replace the old", () => {
  const t = tree();
  t.giftEvents = [
    ...t.giftEvents,
    ...[2030, 2031, 2032, 2033].map((year) => ({
      kind: "cash", year, amount: 1000, grantor: "client", useCrummeyPowers: false, seriesId: "s-new",
    })),
  ] as unknown as typeof t.giftEvents;
  const out = applyGiftOverlays(t, [ch("add", "s-new", seriesDraft(25000, 2031))], 0.025);
  const fanned = out.giftEvents.filter((e) => (e as { seriesId?: string }).seriesId === "s-new");
  expect(fanned.map((e) => [e.year, (e as { amount: number }).amount])).toEqual([
    [2030, 25000],
    [2031, 25000],
  ]);
});
