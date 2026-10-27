import { describe, it, expect, vi } from "vitest";
import type { ClientData, ProjectionResult } from "@/engine";

const distribution = vi.fn<(a: unknown) => { toHeirs: number }>(() => ({ toHeirs: 777 }));
vi.mock("@/lib/estate/estate-distribution-at-year", async (orig) => ({
  ...(await orig<object>()),
  estateDistributionAtYear: (a: unknown) => distribution(a),
}));

import { estateImpactOf } from "../estate-impact";

const tree = { client: { firstName: "Ann", spouseName: "Bo" } } as unknown as ClientData;

function proj(p: Record<string, unknown>) {
  return { years: [{ year: 2040 }, { year: 2050 }], ...p } as unknown as ProjectionResult;
}

describe("estateImpactOf", () => {
  it("adds both deaths and reads heirs at the second death", () => {
    const r = estateImpactOf(
      proj({
        firstDeathEvent: { year: 2035, totalTaxesAndExpenses: 100 },
        secondDeathEvent: { year: 2045, totalTaxesAndExpenses: 250 },
      }),
      tree,
    );
    expect(r).toEqual({ taxesAndCosts: 350, toHeirs: 777, finalDeathYear: 2045 });
    expect(distribution).toHaveBeenLastCalledWith(
      expect.objectContaining({ year: 2045, ownerNames: { clientName: "Ann", spouseName: "Bo" } }),
    );
  });

  it("sums only the final death for a single client", () => {
    const r = estateImpactOf(proj({ secondDeathEvent: { year: 2046, totalTaxesAndExpenses: 40 } }), tree);
    expect(r.taxesAndCosts).toBe(40);
    expect(r.finalDeathYear).toBe(2046);
  });

  it("falls back to the last projected year with no death events", () => {
    const r = estateImpactOf(proj({}), tree);
    expect(r).toEqual({ taxesAndCosts: 0, toHeirs: 777, finalDeathYear: 2050 });
  });
});
