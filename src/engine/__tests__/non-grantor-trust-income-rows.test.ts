import { describe, it, expect } from "vitest";
import { runProjection } from "@/engine/projection";
import { buildCrtLifecycleFixture, CRT_FIXTURE_IDS } from "./_fixtures/crt";

/**
 * Income a NON-GRANTOR trust earns outside its accounts' realization models
 * (estate-trusts audit 2026-09-05, N2).
 *
 * The household 1040 loop skips trust-owned income rows "for the 1041 pass",
 * but that pass used to ingest only account realization and sale gains — so a
 * $100k rental row owned by an irrevocable trust landed in the trust's
 * checking and was taxed nowhere. Same shape for the RMD on a trust-owned IRA
 * (a trust named as IRA beneficiary is a standard structure).
 */

const { SIBLING_TRUST_ID, SIBLING_CHECKING_ID, SIBLING_INCOME_ID, SIBLING_IRA_ID } =
  CRT_FIXTURE_IDS;

describe("income row owned by a non-grantor trust", () => {
  const data = buildCrtLifecycleFixture({
    inceptionYear: 2026,
    payoutPercent: 0.06,
    termYears: 3,
    inceptionValue: 1_000_000,
    siblingNonGrantorTrust: true,
    siblingIncomeRow: true,
  });
  const y2026 = runProjection(data).find((y) => y.year === 2026)!;

  it("lands in the trust's checking", () => {
    const cashIn = y2026.accountLedgers[SIBLING_CHECKING_ID]?.entries?.find(
      (e) => e.sourceId === SIBLING_INCOME_ID,
    );
    expect(cashIn?.amount).toBeCloseTo(100_000, 2);
  });

  it("is retained ordinary income on the trust's 1041", () => {
    const tt = y2026.trustTaxByEntity?.get(SIBLING_TRUST_ID);
    expect(tt?.retainedOrdinary).toBeCloseTo(100_000, 2);
    // 2026 seed trust brackets: 10% to $3,300, 37% above → 330 + 96,700 × 0.37
    expect(tt?.federalOrdinaryTax).toBeCloseTo(36_109, 0);
  });

  it("never reaches the household 1040", () => {
    expect(y2026.taxDetail?.bySource?.[SIBLING_INCOME_ID]).toBeUndefined();
  });
});

describe("RMD from an IRA owned by a non-grantor trust", () => {
  const data = buildCrtLifecycleFixture({
    inceptionYear: 2026,
    payoutPercent: 0.06,
    termYears: 3,
    inceptionValue: 1_000_000,
    siblingNonGrantorTrust: true,
    siblingIra: true,
  });
  const y2026 = runProjection(data).find((y) => y.year === 2026)!;

  it("is taxed to the trust as retained ordinary income, matching the cash the trust received", () => {
    const rmd = y2026.accountLedgers[SIBLING_CHECKING_ID]?.entries?.find(
      (e) => e.category === "rmd" && e.sourceId === SIBLING_IRA_ID,
    );
    expect(rmd).toBeDefined();
    expect(rmd!.amount).toBeGreaterThan(0);
    const tt = y2026.trustTaxByEntity?.get(SIBLING_TRUST_ID);
    expect(tt?.retainedOrdinary).toBeCloseTo(rmd!.amount, 2);
  });
});
