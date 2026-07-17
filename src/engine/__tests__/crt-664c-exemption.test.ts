import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildCrtLifecycleFixture, CRT_FIXTURE_IDS } from "./_fixtures/crt";

describe("CRT realizationCorpus fixture", () => {
  it("defaults leave the fixture untouched (no taxable account, no taxYearRows)", () => {
    const data = buildCrtLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
    });
    expect(
      data.accounts.find((a) => a.id === CRT_FIXTURE_IDS.CRT_TAXABLE_ID),
    ).toBeUndefined();
    expect(data.taxYearRows).toBeUndefined();
    expect(
      data.entities!.find((e) => e.id === CRT_FIXTURE_IDS.CRT_ENTITY_ID)!.isGrantor,
    ).toBe(true);
  });

  it("realizationCorpus adds a CRT-owned taxable account that actually grows, and seeds bracket-mode tax params", () => {
    const data = buildCrtLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      realizationCorpus: true,
    });

    const taxable = data.accounts.find(
      (a) => a.id === CRT_FIXTURE_IDS.CRT_TAXABLE_ID,
    )!;
    expect(taxable).toBeDefined();
    expect(taxable.realization?.pctOrdinaryIncome).toBe(1);
    expect(taxable.owners[0]).toMatchObject({
      kind: "entity",
      entityId: CRT_FIXTURE_IDS.CRT_ENTITY_ID,
    });
    // Bracket mode must be live — without taxYearRows the engine silently falls
    // back to flat-0 and NO tax is computed, which would make the §664(c)
    // assertions in this file pass for the wrong reason.
    expect(data.taxYearRows?.length).toBeGreaterThan(0);

    // The account generates real internal income: 5% × $1M = $50k/yr ordinary.
    const years = runProjection(data);
    const y1 = years.find((y) => y.year === 2026)!;
    expect(y1.accountLedgers[CRT_FIXTURE_IDS.CRT_TAXABLE_ID].growth).toBeCloseTo(
      50_000,
      0,
    );
  });

  it("isGrantor opt overrides the entity flag", () => {
    const data = buildCrtLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      isGrantor: false,
    });
    expect(
      data.entities!.find((e) => e.id === CRT_FIXTURE_IDS.CRT_ENTITY_ID)!.isGrantor,
    ).toBe(false);
  });
});
