import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AnnuityPreviewChart,
  annuityPreviewAgeAtStart,
  buildAnnuityPreviewRows,
} from "../annuity-preview-chart";

const contract = {
  productType: "fixed_indexed" as const, taxTreatment: "non_qualified" as const,
  costBasis: 100_000, annualFeePct: 0, incomeMode: "rider" as const,
  incomeStartYear: 2032, benefitBase: 100_000, rollupRate: 0.06,
  rollupRatchets: false, payoutPct: 0.05,
};

describe("buildAnnuityPreviewRows", () => {
  it("returns one row per projected year", () => {
    const rows = buildAnnuityPreviewRows({ contract, accountValue: 100_000,
      startYear: 2026, years: 30, ownerAgeAtStart: 60, growthRate: 0.04 });
    expect(rows).toHaveLength(30);
    expect(rows[0].year).toBe(2026);
  });

  it("the benefit base outruns the account value while income is deferred", () => {
    const rows = buildAnnuityPreviewRows({ contract, accountValue: 100_000,
      startYear: 2026, years: 30, ownerAgeAtStart: 60, growthRate: 0.02 });
    const atStart = rows.find((r) => r.year === 2031)!;
    expect(atStart.benefitBase).toBeGreaterThan(atStart.accountValue);
  });

  it("marks the crossover year — where the account value hits zero but income does not", () => {
    const rows = buildAnnuityPreviewRows({ contract, accountValue: 100_000,
      startYear: 2026, years: 45, ownerAgeAtStart: 60, growthRate: 0 });
    const crossover = rows.find((r) => r.isCrossover);
    expect(crossover).toBeDefined();
    expect(crossover!.accountValue).toBe(0);
    expect(crossover!.income).toBeGreaterThan(0);
  });

  it("has no crossover when the account value never depletes", () => {
    const rows = buildAnnuityPreviewRows({
      contract: { ...contract, payoutPct: 0.01 },
      accountValue: 100_000, startYear: 2026, years: 30, ownerAgeAtStart: 60, growthRate: 0.08,
    });
    expect(rows.some((r) => r.isCrossover)).toBe(false);
  });

  // A rider fee of 50% of the benefit base empties the account in 2027, five
  // years before the first payment. A drained balance with nothing coming out
  // of it is not the crossover — and once income does start, only the FIRST
  // paying year is marked, not every year after it.
  it("waits for income before calling an empty balance a crossover, and marks one year", () => {
    const rows = buildAnnuityPreviewRows({
      contract: { ...contract, riderFeePct: 0.5 },
      accountValue: 100_000, startYear: 2026, years: 20, ownerAgeAtStart: 60, growthRate: 0,
    });
    expect(rows.find((r) => r.year === 2027)!.accountValue).toBe(0);
    expect(rows.find((r) => r.year === 2027)!.income).toBe(0);
    expect(rows.filter((r) => r.isCrossover).map((r) => r.year)).toEqual([2032]);
  });

  // With no stated payout percent the engine reads the age band. The owner is
  // 60 when the preview starts and 66 when income begins in 2032, so the 65+
  // band (5%) applies. A loop that never aged the owner would take the 60+ band
  // (4.5%) and understate every payment for the rest of the contract.
  it("ages the owner year by year, so the payout band is read at the income start", () => {
    const rows = buildAnnuityPreviewRows({
      contract: { ...contract, payoutPct: undefined },
      accountValue: 100_000, startYear: 2026, years: 20, ownerAgeAtStart: 60, growthRate: 0,
    });
    const atStart = rows.find((r) => r.year === 2032)!;
    expect(atStart.income).toBeCloseTo(atStart.benefitBase * 0.05, 6);
    // Liveness: the two bands are genuinely different numbers, so the pin above
    // is not satisfied by both.
    expect(atStart.income).not.toBeCloseTo(atStart.benefitBase * 0.045, 6);
  });
});

// ── The refusal to guess (controller ruling P32) ─────────────────────────────
// `payoutPercentForAge(NaN)` neither throws nor returns zero: every
// `NaN >= band.minAge` is false, so it falls through and hands back the LAST
// band's percent — a completely plausible number. A preview drawn off a guessed
// age would therefore be confident and wrong, and nothing downstream would
// complain. So the chart draws only when it has a real age AND a real balance.

describe("annuityPreviewAgeAtStart", () => {
  it("is the owner's age in the first projected year", () => {
    expect(annuityPreviewAgeAtStart(2026, 1966)).toBe(60);
  });

  it("refuses to invent an age when the birth year is missing or unusable", () => {
    expect(annuityPreviewAgeAtStart(2026, undefined)).toBeNull();
    expect(annuityPreviewAgeAtStart(2026, null)).toBeNull();
    expect(annuityPreviewAgeAtStart(2026, NaN)).toBeNull();
  });
});

describe("AnnuityPreviewChart", () => {
  const base = { contract, startYear: 2026, years: 30 };
  const html = (props: Parameters<typeof AnnuityPreviewChart>[0]) =>
    renderToStaticMarkup(createElement(AnnuityPreviewChart, props));

  it("draws once it has both a balance and a real owner age", () => {
    expect(html({ ...base, accountValue: 100_000, ownerAgeAtStart: 60 })).toContain("<canvas");
  });

  it("draws nothing without an owner age, and names what is missing", () => {
    const out = html({ ...base, accountValue: 100_000, ownerAgeAtStart: null });
    expect(out).not.toContain("<canvas");
    expect(out).toContain("date of birth");
  });

  it("draws nothing without a balance, and names what is missing", () => {
    const out = html({ ...base, accountValue: null, ownerAgeAtStart: 60 });
    expect(out).not.toContain("<canvas");
    expect(out).toContain("account balance");
  });

  // The panel accepts a milestone ("when Sam retires") in place of a calendar
  // year, and the engine only understands the year. An unresolved milestone
  // would draw flat lines and no income at all — a picture of a contract that
  // never pays, which is not what the advisor described.
  it("draws nothing until the income start resolves to a real year", () => {
    const out = html({
      ...base, contract: { ...contract, incomeStartYear: null },
      accountValue: 100_000, ownerAgeAtStart: 60,
    });
    expect(out).not.toContain("<canvas");
    expect(out).toContain("year income starts");
  });

  // The panel emits a fraction on every keystroke, so typing "150" into a
  // percent box hands the engine 1.5 mid-word and its rate guard throws. A
  // half-typed percentage must not white-screen the form it is typed into.
  it("says so instead of crashing when a percentage is out of range", () => {
    const out = html({
      ...base, contract: { ...contract, annualFeePct: 1.5 },
      accountValue: 100_000, ownerAgeAtStart: 60,
    });
    expect(out).not.toContain("<canvas");
    expect(out).toContain("0–100%");
  });
});
