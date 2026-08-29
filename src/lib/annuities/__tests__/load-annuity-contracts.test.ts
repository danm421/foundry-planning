import { describe, it, expect, vi } from "vitest";

// `vi.mock` factories are hoisted above the module body, so the fixture rows
// and the call counter have to be hoisted with them.
const { rows, dbStats } = vi.hoisted(() => ({
  dbStats: { selectCalls: 0 },
  rows: [
    // Fully-populated rider contract.
    {
      accountId: "a1",
      carrier: "Acme Life",
      contractNumberLast4: "1234",
      productType: "fixed_indexed",
      taxTreatment: "non_qualified",
      costBasis: "100000.00",
      surrenderChargePct: "0.0700",
      surrenderEndYear: 2032,
      annualFeePct: "0.0125",
      incomeMode: "rider",
      incomeStartYear: 2030,
      incomeStartYearRef: null,
      payoutStructure: "single_life",
      survivorPct: null,
      periodCertainYears: null,
      benefitBase: "150000.00",
      rollupRate: "0.0600",
      rollupEndYear: 2035,
      rollupRatchets: true,
      riderFeePct: "0.0100",
      payoutPct: null,
      annuitizedPayment: null,
      expectedReturnYears: null,
    },
    // Every nullable column NULL. `Number(null)` is 0, so this row is the
    // trap: a 0 cost basis makes the whole contract taxable, and a 0 benefit
    // base pays nothing.
    {
      accountId: "a2",
      carrier: null,
      contractNumberLast4: null,
      productType: "myga",
      taxTreatment: "qualified",
      costBasis: null,
      surrenderChargePct: null,
      surrenderEndYear: null,
      annualFeePct: "0.0000",
      incomeMode: "none",
      incomeStartYear: null,
      incomeStartYearRef: null,
      payoutStructure: null,
      survivorPct: null,
      periodCertainYears: null,
      benefitBase: null,
      rollupRate: null,
      rollupEndYear: null,
      rollupRatchets: false,
      riderFeePct: null,
      payoutPct: null,
      annuitizedPayment: null,
      expectedReturnYears: null,
    },
    // A legal row under the `annuity_income_needs_start` CHECK: the ref alone
    // satisfies it, so income_start_year is NULL and only the ref says when
    // income turns on.
    {
      accountId: "a3",
      carrier: null,
      contractNumberLast4: null,
      productType: "fixed_indexed",
      taxTreatment: "non_qualified",
      costBasis: "200000.00",
      surrenderChargePct: null,
      surrenderEndYear: null,
      annualFeePct: "0.0100",
      incomeMode: "rider",
      incomeStartYear: null,
      incomeStartYearRef: "client_retirement",
      payoutStructure: "single_life",
      survivorPct: null,
      periodCertainYears: null,
      benefitBase: "200000.00",
      rollupRate: "0.0500",
      rollupEndYear: null,
      rollupRatchets: true,
      riderFeePct: "0.0110",
      payoutPct: null,
      annuitizedPayment: null,
      expectedReturnYears: null,
    },
  ],
}));

vi.mock("@/db", () => ({
  db: {
    select: () => {
      dbStats.selectCalls += 1;
      return { from: () => ({ where: () => Promise.resolve(rows) }) };
    },
  },
}));

const { loadAnnuityContractsByAccountIds } = await import("../load-annuity-contracts");

/** Stands in for `load-client-data`'s milestone resolver. */
const resolveStart = (ref: string | null, storedYear: number | null): number =>
  ref === "client_retirement" ? 2040 : (storedYear ?? 2026);

const loadAll = () =>
  loadAnnuityContractsByAccountIds(["a1", "a2", "a3"], resolveStart);

describe("loadAnnuityContractsByAccountIds", () => {
  it("returns an empty map for an empty id list without touching the DB", async () => {
    const before = dbStats.selectCalls;
    expect(await loadAnnuityContractsByAccountIds([], resolveStart)).toEqual({});
    expect(dbStats.selectCalls).toBe(before);
  });

  it("converts Drizzle decimal STRINGS to numbers", async () => {
    const map = await loadAll();
    expect(map.a1.costBasis).toBe(100_000);
    expect(map.a1.annualFeePct).toBe(0.0125);
    expect(map.a1.benefitBase).toBe(150_000);
    expect(map.a1.rollupRate).toBe(0.06);

    // The WHOLE mapping, not a sample of it. Ledger #129: the six optional
    // pass-throughs (carrier, contractNumberLast4, payoutStructure,
    // surrenderEndYear, periodCertainYears, rollupEndYear) could each be
    // deleted from the object literal and still compile with every test green —
    // only the five REQUIRED fields were tsc-guarded. A field silently dropped
    // here reaches the engine as `undefined` and quietly changes the plan.
    expect(map.a1).toEqual({
      carrier: "Acme Life",
      contractNumberLast4: "1234",
      productType: "fixed_indexed",
      taxTreatment: "non_qualified",
      costBasis: 100_000,
      surrenderChargePct: 0.07,
      surrenderEndYear: 2032,
      annualFeePct: 0.0125,
      incomeMode: "rider",
      incomeStartYear: 2030,
      payoutStructure: "single_life",
      survivorPct: null,
      periodCertainYears: null,
      benefitBase: 150_000,
      rollupRate: 0.06,
      rollupEndYear: 2035,
      rollupRatchets: true,
      riderFeePct: 0.01,
      payoutPct: undefined,
      annuitizedPayment: undefined,
      expectedReturnYears: undefined,
    });
  });

  it("leaves NULL money and rates undefined — never coerced to 0", async () => {
    // A 0 basis would make the whole contract taxable; undefined means
    // "seed from account value" downstream. Number(null) === 0, so this is
    // the exact trap the loader has to avoid.
    const map = await loadAll();
    expect(map.a2.costBasis).toBeUndefined();
    expect(map.a2.costBasis).not.toBe(0);
    expect(map.a2.benefitBase).toBeUndefined();
    expect(map.a2.benefitBase).not.toBe(0);
    expect(map.a2.rollupRate).toBeUndefined();
    expect(map.a2.rollupRate).not.toBe(0);
    expect(map.a2.riderFeePct).toBeUndefined();
    expect(map.a2.riderFeePct).not.toBe(0);
  });

  it("keeps payoutPct undefined so the age band table applies", async () => {
    const map = await loadAll();
    expect(map.a1.payoutPct).toBeUndefined();
  });

  it("carries the mode discriminator through unchanged", async () => {
    const map = await loadAll();
    expect(map.a1.incomeMode).toBe("rider");
    expect(map.a1.rollupRatchets).toBe(true);
  });

  it("resolves incomeStartYearRef when the stored year is NULL", async () => {
    // The CHECK constraint is satisfied by the ref alone. Left unresolved the
    // engine's `started` test is false forever and a funded guaranteed-income
    // annuity silently never pays.
    const map = await loadAll();
    expect(map.a3.incomeStartYear).toBe(2040);
    expect(typeof map.a3.incomeStartYear).toBe("number");
  });

  it("keeps a stored income start year when there is no ref", async () => {
    const map = await loadAll();
    expect(map.a1.incomeStartYear).toBe(2030);
  });

  it("leaves incomeStartYear null when both the year and the ref are NULL", async () => {
    const map = await loadAll();
    expect(map.a2.incomeStartYear).toBeNull();
  });
});
