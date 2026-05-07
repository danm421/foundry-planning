import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import {
  buildClutLifecycleFixture,
  CLUT_FIXTURE_IDS,
} from "./_fixtures/clut";

/**
 * Task 14: Cashflow + tax-detail annotations.
 *
 * The CLUT cash-flow events (annual unitrust payments, recapture on grantor
 * death, end-of-term distribution) are surfaced through the existing
 * ProjectionYear data structures so any cashflow / tax-detail report consumer
 * picks them up automatically. This test asserts the data is labeled
 * distinctly enough that downstream UI can render CLUT-specific copy without
 * re-deriving from `accountLedgers` raw amounts.
 */
describe("CLUT cashflow + tax-detail annotations", () => {
  it("annual unitrust outflow lands in charitableOutflowDetail with kind=clut_unitrust", () => {
    const data = buildClutLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      charityType: "public",
      grantorAgi: 5_000_000,
    });
    const years = runProjection(data);
    const year1 = years.find((y) => y.year === 2026)!;
    expect(year1.charitableOutflowDetail).toBeDefined();
    expect(year1.charitableOutflowDetail).toHaveLength(1);
    const entry = year1.charitableOutflowDetail![0];
    expect(entry.kind).toBe("clut_unitrust");
    expect(entry.trustId).toBe(CLUT_FIXTURE_IDS.CLUT_ENTITY_ID);
    expect(entry.charityId).toBe(CLUT_FIXTURE_IDS.PUBLIC_CHARITY_ID);
    expect(entry.amount).toBeGreaterThan(0);
  });

  it("annual unitrust payment lands as a labeled ledger entry on the trust's checking", () => {
    const data = buildClutLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      charityType: "public",
      grantorAgi: 5_000_000,
    });
    const years = runProjection(data);
    const year1 = years.find((y) => y.year === 2026)!;
    const ledger = year1.accountLedgers[CLUT_FIXTURE_IDS.CLUT_CHECKING_ID];
    expect(ledger).toBeDefined();
    const clutEntry = ledger.entries?.find((e) =>
      e.label.includes("CLUT unitrust payment to charity"),
    );
    expect(clutEntry).toBeDefined();
    expect(clutEntry!.amount).toBeLessThan(0);
  });

  it("recapture surfaces in taxDetail.bySource on grantor death year with stable key", () => {
    const data = buildClutLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 15,
      inceptionValue: 1_000_000,
      charityType: "public",
      grantorAgi: 200_000,
      grantorDeathYear: 2030,
      irc7520Rate: 0.022,
    });
    const years = runProjection(data);
    const death = years.find((y) => y.year === 2030)!;
    const recaptureKey = `clut_recapture:${CLUT_FIXTURE_IDS.CLUT_ENTITY_ID}`;
    const entry = death.taxDetail?.bySource[recaptureKey];
    expect(entry).toBeDefined();
    expect(entry!.type).toBe("ordinary_income");
    expect(entry!.amount).toBeGreaterThan(0);
  });
});
