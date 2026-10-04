// The page against the real engine, both plans built the way the export builds
// them: the with-plan straight from the tree, the without-plan by applying this
// page's own derived mutations and re-projecting.

import { describe, it, expect } from "vitest";
import { runProjectionWithEvents } from "@/engine/projection";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { buildDerivedBundle, derivedKey } from "@/lib/presentations/derived-refs";
import { buildClientData, baseClient, FIXTURE_TAX_PARAMS } from "@/engine/__tests__/fixtures";
import {
  buildRothConversionData,
  ROTH_CONVERSION_PAGE_ID,
  ROTH_WITHOUT_KEY,
  withoutConversionsRef,
} from "../view-model";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { ClientData } from "@/engine/types";

function household(): ClientData {
  const plain = buildClientData();
  return buildClientData({
    client: { ...baseClient, lifeExpectancy: 84, spouseLifeExpectancy: 86 },
    taxYearRows: FIXTURE_TAX_PARAMS,
    planSettings: { ...plain.planSettings, planEndYear: 2060, taxEngineMode: "bracket", irdTaxRate: 0.35 },
    rothConversions: [
      {
        id: "rc1",
        name: "Bridge-years conversion",
        destinationAccountId: "acct-roth",
        sourceAccountIds: ["acct-401k"],
        conversionType: "fixed_amount",
        fixedAmount: 60_000,
        startYear: 2036,
        endYear: 2040,
        indexingRate: 0,
      },
    ],
  } as Partial<ClientData>);
}

function pageData() {
  const clientData = household();
  const source = { clientData, projection: runProjectionWithEvents(clientData) };
  const without = buildDerivedBundle(
    source,
    withoutConversionsRef({ scenarioId: "base" }),
    { applyMutations, runProjection: runProjectionWithEvents },
  );
  const ctx = {
    clientData,
    projection: source.projection,
    years: source.projection.years,
    clientName: "John Smith",
    spouseName: "Jane Smith",
    bundlesByRef: {
      base: { ...source, scenarioLabel: "Base Case" },
      [derivedKey(ROTH_CONVERSION_PAGE_ID, ROTH_WITHOUT_KEY)]: without,
    },
  } as unknown as BuildDataContext;
  return { data: buildRothConversionData(ctx, { scenarioId: "base" }), clientData, without };
}

describe("Roth conversion page on a real projection", () => {
  const { data: d, clientData, without } = pageData();

  it("finds the five conversion years and prices each", () => {
    expect(d.emptyMessage).toBeNull();
    expect(d.schedule.map((r) => r.year)).toEqual([2036, 2037, 2038, 2039, 2040]);
    expect(d.schedule.every((r) => r.converted === 60_000)).toBe(true);
    expect(d.schedule.every((r) => r.extraTax > 0)).toBe(true);
    expect(d.schedule.every((r) => typeof r.bracket === "number")).toBe(true);
  });

  it("removes the conversions, and nothing else, from the comparison plan", () => {
    expect(without.clientData.rothConversions).toEqual([]);
    expect({ ...without.clientData, rothConversions: [] }).toEqual({ ...clientData, rothConversions: [] });
    expect(d.totals!.converted).toBe(300_000);
  });

  it("cuts the required withdrawal once withdrawals start", () => {
    expect(d.rmd).not.toBeNull();
    expect(d.rmd!.with).toBeLessThan(d.rmd!.without);
    expect(d.totals!.laterTaxSaved).toBeGreaterThan(0);
  });

  it("leaves the heirs better off when they would pay more on the IRA than the conversion cost", () => {
    // Conversions at 12–22% against a 35% heirs' rate: ahead from the start.
    expect(d.totals!.heirsChange).toBeGreaterThan(0);
    expect(d.breakeven).toEqual({ kind: "immediate" });
    expect(d.mix!.with.roth).toBeGreaterThan(d.mix!.without.roth);
  });

  it("writes the strategy from the conversion's own settings", () => {
    expect(d.strategy).toEqual([
      "Convert $60,000 a year from John 401(k) to Jane Roth IRA, 2036 through 2040.",
    ]);
  });
});
