import { describe, it, expect } from "vitest";
import { runProjection } from "@/engine/projection";
import { buildClientData } from "@/engine/__tests__/fixtures";
import { buildMonthlyCashFlowRows } from "../monthly-cash-flow";

describe("buildMonthlyCashFlowRows — headline lines", () => {
  const clientData = buildClientData();
  const years = runProjection(clientData);
  const rows = buildMonthlyCashFlowRows(years, clientData, "nominal");

  it("emits one row per projection year, in order", () => {
    expect(rows).toHaveLength(years.length);
    expect(rows.map((r) => r.year)).toEqual(years.map((y) => y.year));
  });

  it("divides every figure by 12", () => {
    const y = years[0];
    expect(rows[0].income).toBeCloseTo(y.totalIncome / 12, 6);
    expect(rows[0].fixed.taxes).toBeCloseTo(y.expenses.taxes / 12, 6);
    expect(rows[0].portfolioDraw).toBeCloseTo(y.withdrawals.total / 12, 6);
    // Savings is a committed cost, not money left to live on.
    expect(rows[0].fixed.savings).toBeCloseTo(y.savings.total / 12, 6);
  });

  it("leaves living expenses OUT of fixed costs", () => {
    const y = years[0];
    const sumOfParts =
      rows[0].fixed.taxes +
      rows[0].fixed.liabilities +
      rows[0].fixed.savings +
      rows[0].fixed.insurance +
      rows[0].fixed.realEstate +
      rows[0].fixed.other;
    expect(rows[0].fixed.total).toBeCloseTo(sumOfParts, 6);
    // The whole point of the report: the lifestyle budget is not a fixed cost.
    expect(rows[0].fixed.total * 12).toBeLessThan(y.totalExpenses);
    // That comparison alone is a knife edge on this fixture — `totalExpenses`
    // itself includes savings, so folding living in ties rather than exceeds.
    // Pin the composition exactly instead: these six fields and nothing else.
    expect(rows[0].fixed.total * 12).toBeCloseTo(
      y.expenses.taxes +
        y.expenses.liabilities +
        y.savings.total +
        y.expenses.insurance +
        y.expenses.realEstate +
        y.expenses.other,
      6,
    );
  });

  it("computes available as left-after-fixed plus the portfolio draw", () => {
    for (const r of rows) {
      expect(r.leftAfterFixed).toBeCloseTo(r.income - r.fixed.total, 6);
      expect(r.available).toBeCloseTo(r.leftAfterFixed + r.portfolioDraw, 6);
    }
  });

  it("never counts entity withdrawals in the draw", () => {
    for (const [i, r] of rows.entries()) {
      expect(r.portfolioDraw).toBeCloseTo(years[i].withdrawals.total / 12, 6);
    }
  });

  it("labels ages the same way the existing cash-flow drill does", () => {
    expect(rows[0].ageLabel).toBe("Age 56 / 54");
  });
});

describe("cash gifts", () => {
  it("are already inside expenses.other, and counted there exactly once", () => {
    const clientData = buildClientData({
      giftEvents: [
        {
          kind: "cash",
          year: 2026,
          amount: 25_000,
          grantor: "client",
          sourceAccountId: "acct-savings",
          useCrummeyPowers: false,
        },
      ],
    });
    const years = runProjection(clientData);
    const y2026 = years.find((y) => y.year === 2026)!;
    expect(y2026.expenses.cashGifts).toBeGreaterThan(0);
    // Settled empirically: `other` DOES already contain the cash gift, and
    // `total` still counts it exactly once (it sums the raw breakdown's `other`
    // plus the gift as its own addend, not the composed `other` field). So the
    // module must NOT add `expenses.cashGifts` on top of `expenses.other`.
    expect(y2026.expenses.other).toBeGreaterThanOrEqual(y2026.expenses.cashGifts);
    // ...and exactly once, not twice: a no-gift run of the same fixture puts
    // `other` at 0, so the gift accounts for the whole of the difference. The
    // module therefore reads `expenses.other` alone.
    const noGift = runProjection(buildClientData());
    const base2026 = noGift.find((y) => y.year === 2026)!;
    expect(y2026.expenses.other - base2026.expenses.other).toBe(
      y2026.expenses.cashGifts,
    );
  });
});

describe("dollar basis", () => {
  const clientData = buildClientData();
  const years = runProjection(clientData);
  const { inflationRate, planStartYear } = clientData.planSettings;

  it("deflates future years to plan-start purchasing power by default", () => {
    const nominal = buildMonthlyCashFlowRows(years, clientData, "nominal");
    const today = buildMonthlyCashFlowRows(years, clientData);

    const i = years.findIndex((y) => y.year === planStartYear + 10);
    expect(i).toBeGreaterThan(0);
    expect(nominal[i].income).toBeGreaterThan(0); // else the check below is empty

    expect(today[i].income).toBeCloseTo(
      nominal[i].income / (1 + inflationRate) ** 10,
      6,
    );
    expect(today[i].income).toBeLessThan(nominal[i].income);
    // The plan's own first year is the baseline — its figures are untouched.
    expect(today[0].income).toBeCloseTo(nominal[0].income, 6);
  });
});
