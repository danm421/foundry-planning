import { describe, it, expect } from "vitest";
import {
  allocateQcds,
  fanOutQcd,
  qcdAnnualLimit,
  qcdEligibleFromYear,
  type AllocateQcdsInput,
  type QcdAccountState,
} from "../qcd";
import type { QcdEvent } from "../types";

describe("qcdAnnualLimit", () => {
  it("is 100,000 in years before 2024", () => {
    expect(qcdAnnualLimit(2023, 0.025)).toBe(100_000);
  });

  it("uses the published figure for 2024, 2025 and 2026", () => {
    expect(qcdAnnualLimit(2024, 0)).toBe(105_000);
    expect(qcdAnnualLimit(2025, 0)).toBe(108_000);
    expect(qcdAnnualLimit(2026, 0)).toBe(111_000);
  });

  it("inflates the last published figure after 2026, rounded down to the nearest 1,000", () => {
    // 111,000 × 1.025 = 113,775 → 113,000
    expect(qcdAnnualLimit(2027, 0.025)).toBe(113_000);
  });

  it("holds the last published figure with no inflation", () => {
    expect(qcdAnnualLimit(2030, 0)).toBe(111_000);
  });
});

describe("qcdEligibleFromYear", () => {
  it("is birth year + 70 when born on or before June 30", () => {
    expect(qcdEligibleFromYear("1956-06-30")).toBe(2026);
    expect(qcdEligibleFromYear("1956-01-15")).toBe(2026);
  });

  it("is birth year + 71 when born on or after July 1", () => {
    expect(qcdEligibleFromYear("1956-07-01")).toBe(2027);
  });
});

describe("fanOutQcd", () => {
  const base = {
    accountId: "ira-1",
    charityId: "charity-1",
    mode: "fixed" as const,
    startYear: 2026,
    endYear: 2028,
    amount: 20_000,
    inflationAdjust: true,
  };

  it("emits one event per year, inflating fixed amounts from the start year, each tagged with the series", () => {
    const events = fanOutQcd({ ...base, seriesId: "series-1" }, 0.03);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.year)).toEqual([2026, 2027, 2028]);
    expect(events[0].amount).toBeCloseTo(20_000, 6);
    expect(events[1].amount).toBeCloseTo(20_600, 6);
    expect(events[2].amount).toBeCloseTo(21_218, 6);
    for (const e of events) {
      expect(e).toMatchObject({
        accountId: "ira-1",
        charityId: "charity-1",
        mode: "fixed",
        seriesId: "series-1",
      });
    }
  });

  it("gives amount 0 in full_rmd mode (the RMD step decides the amount)", () => {
    const events = fanOutQcd({ ...base, mode: "full_rmd", seriesId: "series-1" }, 0.03);
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.amount === 0 && e.mode === "full_rmd")).toBe(true);
  });

  it("gives a one-time gift a single event carrying its gift id", () => {
    const events = fanOutQcd(
      { ...base, startYear: 2027, endYear: 2027, sourceGiftId: "gift-1" },
      0.03,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ year: 2027, amount: 20_000, sourceGiftId: "gift-1" });
  });
});

describe("allocateQcds", () => {
  const CAP = 111_000;

  function ira(over: Partial<QcdAccountState> = {}): QcdAccountState {
    return {
      giver: "client",
      isSourceType: true,
      inherited: false,
      qualifiesThisYear: true,
      requiredMinimum: 40_000,
      available: 1_000_000,
      ...over,
    };
  }

  function qcd(over: Partial<QcdEvent> = {}): QcdEvent {
    return {
      year: 2030,
      accountId: "ira-a",
      charityId: "public-charity",
      mode: "fixed",
      amount: 0,
      ...over,
    };
  }

  function run(
    qcds: QcdEvent[],
    accounts: Record<string, QcdAccountState>,
    over: Partial<AllocateQcdsInput> = {},
  ) {
    return allocateQcds({
      qcds,
      accounts: new Map(Object.entries(accounts)),
      giverEligible: { client: true, spouse: true },
      charityQualifies: (id) => id === "public-charity",
      cap: CAP,
      ...over,
    });
  }

  it("full RMD gives the account's required minimum, all qualifying", () => {
    const r = run([qcd({ mode: "full_rmd", sourceGiftId: "g1" })], { "ira-a": ira() });
    expect(r.results).toEqual([
      {
        accountId: "ira-a",
        charityId: "public-charity",
        giver: "client",
        sourceGiftId: "g1",
        seriesId: undefined,
        qualifying: 40_000,
        taxedExcess: 0,
      },
    ]);
    expect(r.rmdRemaining.get("ira-a")).toBe(0);
    expect(r.qcdOutByAccount.get("ira-a")).toEqual({ qualifying: 40_000, taxedExcess: 0 });
  });

  it("a fixed QCD below the RMD leaves the rest of the RMD to be taken", () => {
    const r = run([qcd({ amount: 15_000 })], { "ira-a": ira() });
    expect(r.results[0]).toMatchObject({ qualifying: 15_000, taxedExcess: 0 });
    expect(r.rmdRemaining.get("ira-a")).toBe(25_000);
  });

  it("a fixed QCD above the cap still goes in full; the part over the cap is taxed", () => {
    const r = run([qcd({ amount: 150_000 })], { "ira-a": ira() });
    expect(r.results[0]).toMatchObject({ qualifying: 111_000, taxedExcess: 39_000 });
    expect(r.rmdRemaining.get("ira-a")).toBe(0);
  });

  it("full RMD above the cap stops at the cap; the rest of the RMD is a normal RMD", () => {
    const r = run([qcd({ mode: "full_rmd" })], { "ira-a": ira({ requiredMinimum: 203_000 }) });
    expect(r.results[0]).toMatchObject({ qualifying: 111_000, taxedExcess: 0 });
    expect(r.rmdRemaining.get("ira-a")).toBe(92_000);
  });

  it("a giver who isn't eligible this year gives nothing", () => {
    const r = run([qcd({ amount: 15_000 })], { "ira-a": ira() }, {
      giverEligible: { client: false, spouse: true },
    });
    expect(r.results).toEqual([]);
    expect(r.rmdRemaining.get("ira-a")).toBe(40_000);
    expect(r.qcdOutByAccount.size).toBe(0);
  });

  it("a gift to a private charity: fixed is fully taxed, full RMD gives nothing", () => {
    const fixed = run([qcd({ amount: 15_000, charityId: "private-fdn" })], { "ira-a": ira() });
    expect(fixed.results[0]).toMatchObject({ qualifying: 0, taxedExcess: 15_000 });
    expect(fixed.rmdRemaining.get("ira-a")).toBe(25_000);

    const full = run([qcd({ mode: "full_rmd", charityId: "private-fdn" })], { "ira-a": ira() });
    expect(full.results).toEqual([]);
    expect(full.rmdRemaining.get("ira-a")).toBe(40_000);
  });

  it("a SEP with an employer contribution this year doesn't qualify: same outcome as a private charity", () => {
    const sep = { "ira-a": ira({ qualifiesThisYear: false }) };
    const fixed = run([qcd({ amount: 15_000 })], sep);
    expect(fixed.results[0]).toMatchObject({ qualifying: 0, taxedExcess: 15_000 });

    const full = run([qcd({ mode: "full_rmd" })], sep);
    expect(full.results).toEqual([]);
    expect(full.rmdRemaining.get("ira-a")).toBe(40_000);
  });

  it("a 401(k) or Roth source never funds a QCD", () => {
    const r = run([qcd({ amount: 15_000 })], { "ira-a": ira({ isSourceType: false }) });
    expect(r.results).toEqual([]);
    expect(r.rmdRemaining.get("ira-a")).toBe(40_000);
  });

  it("an IRA that no longer exists, or has no household owner, is skipped", () => {
    const missing = run([qcd({ amount: 15_000, accountId: "gone" })], { "ira-a": ira() });
    expect(missing.results).toEqual([]);
    expect(missing.rmdRemaining.get("ira-a")).toBe(40_000);

    const heirOwned = run([qcd({ amount: 15_000 })], { "ira-a": ira({ giver: null }) });
    expect(heirOwned.results).toEqual([]);
    expect(heirOwned.rmdRemaining.get("ira-a")).toBe(40_000);
  });

  it("aggregation: a QCD beyond one IRA's RMD covers the owner's other IRAs, never their 401(k)", () => {
    const r = run([qcd({ amount: 30_000 })], {
      "ira-a": ira({ requiredMinimum: 10_000 }),
      "ira-b": ira({ requiredMinimum: 10_000 }),
      "k-401": ira({ requiredMinimum: 10_000, isSourceType: false }),
    });
    expect(r.results[0]).toMatchObject({ qualifying: 30_000 });
    expect(r.rmdRemaining.get("ira-a")).toBe(0);
    expect(r.rmdRemaining.get("ira-b")).toBe(0);
    expect(r.rmdRemaining.get("k-401")).toBe(10_000);
  });

  it("aggregation never crosses givers", () => {
    const r = run([qcd({ amount: 30_000 })], {
      "ira-a": ira({ requiredMinimum: 10_000 }),
      "spouse-ira": ira({ giver: "spouse", requiredMinimum: 10_000 }),
    });
    expect(r.rmdRemaining.get("spouse-ira")).toBe(10_000);
  });

  it("an inherited IRA's QCD counts only toward that inherited IRA", () => {
    const fromInherited = run([qcd({ amount: 30_000, accountId: "inh" })], {
      inh: ira({ inherited: true, requiredMinimum: 10_000 }),
      "ira-b": ira({ requiredMinimum: 10_000 }),
    });
    expect(fromInherited.rmdRemaining.get("inh")).toBe(0);
    expect(fromInherited.rmdRemaining.get("ira-b")).toBe(10_000);

    const intoInherited = run([qcd({ amount: 30_000 })], {
      "ira-a": ira({ requiredMinimum: 10_000 }),
      inh: ira({ inherited: true, requiredMinimum: 10_000 }),
    });
    expect(intoInherited.rmdRemaining.get("inh")).toBe(10_000);
  });

  it("two QCDs from one IRA stop at its available balance, in entry order", () => {
    const r = run(
      [qcd({ amount: 40_000, charityId: "public-charity" }), qcd({ amount: 40_000, charityId: "public-charity" })],
      { "ira-a": ira({ available: 50_000 }) },
    );
    expect(r.results.map((x) => x.qualifying + x.taxedExcess)).toEqual([40_000, 10_000]);
    expect(r.qcdOutByAccount.get("ira-a")).toEqual({ qualifying: 50_000, taxedExcess: 0 });
  });

  it("two QCDs from one IRA share the giver's cap, in entry order", () => {
    const r = run(
      [qcd({ amount: 40_000 }), qcd({ amount: 40_000 })],
      { "ira-a": ira() },
      { cap: 60_000 },
    );
    expect(r.results[0]).toMatchObject({ qualifying: 40_000, taxedExcess: 0 });
    expect(r.results[1]).toMatchObject({ qualifying: 20_000, taxedExcess: 20_000 });
  });

  it("each spouse has their own cap", () => {
    const r = run(
      [qcd({ amount: 100_000 }), qcd({ amount: 100_000, accountId: "spouse-ira" })],
      { "ira-a": ira(), "spouse-ira": ira({ giver: "spouse" }) },
    );
    expect(r.results[0]).toMatchObject({ giver: "client", qualifying: 100_000, taxedExcess: 0 });
    expect(r.results[1]).toMatchObject({ giver: "spouse", qualifying: 100_000, taxedExcess: 0 });
  });
});
