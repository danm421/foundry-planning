import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import {
  buildCltLifecycleFixture,
  CLT_FIXTURE_IDS,
} from "./_fixtures/clt";

/**
 * Task 14: Cashflow + tax-detail annotations.
 *
 * The CLT cash-flow events (annual unitrust payments, recapture on grantor
 * death, end-of-term distribution) are surfaced through the existing
 * ProjectionYear data structures so any cashflow / tax-detail report consumer
 * picks them up automatically. This test asserts the data is labeled
 * distinctly enough that downstream UI can render CLT-specific copy without
 * re-deriving from `accountLedgers` raw amounts.
 */
describe("CLT cashflow + tax-detail annotations", () => {
  it("annual unitrust outflow lands in charitableOutflowDetail with kind=clt_payment", () => {
    const data = buildCltLifecycleFixture({
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
    expect(entry.kind).toBe("clt_payment");
    expect(entry.trustId).toBe(CLT_FIXTURE_IDS.CLT_ENTITY_ID);
    expect(entry.charityId).toBe(CLT_FIXTURE_IDS.PUBLIC_CHARITY_ID);
    expect(entry.amount).toBeGreaterThan(0);
  });

  it("annual unitrust payment lands as a labeled ledger entry on the trust's checking", () => {
    const data = buildCltLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      charityType: "public",
      grantorAgi: 5_000_000,
    });
    const years = runProjection(data);
    const year1 = years.find((y) => y.year === 2026)!;
    const ledger = year1.accountLedgers[CLT_FIXTURE_IDS.CLT_CHECKING_ID];
    expect(ledger).toBeDefined();
    const cltEntry = ledger.entries?.find((e) =>
      e.label.includes("CLT unitrust payment to charity"),
    );
    expect(cltEntry).toBeDefined();
    expect(cltEntry!.amount).toBeLessThan(0);
  });

  it("recapture surfaces in taxDetail.bySource on grantor death year with stable key", () => {
    const data = buildCltLifecycleFixture({
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
    const recaptureKey = `clt_recapture:${CLT_FIXTURE_IDS.CLT_ENTITY_ID}`;
    const entry = death.taxDetail?.bySource[recaptureKey];
    expect(entry).toBeDefined();
    expect(entry!.type).toBe("ordinary_income");
    expect(entry!.amount).toBeGreaterThan(0);
  });
});
