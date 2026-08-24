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
    // Each remaining field pinned to its OWN engine source. The sum-composition
    // check below cannot see two of these swapped — the total is identical, but
    // the report would print the mortgage on the insurance row.
    expect(rows[0].fixed.liabilities).toBeCloseTo(y.expenses.liabilities / 12, 6);
    expect(rows[0].fixed.insurance).toBeCloseTo(y.expenses.insurance / 12, 6);
    expect(rows[0].fixed.realEstate).toBeCloseTo(y.expenses.realEstate / 12, 6);
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

  it("reads the draw from withdrawals.total alone", () => {
    // Without this the loop below could pass on a fixture that never draws.
    expect(years.some((y) => y.withdrawals.total > 0)).toBe(true);
    // The limit of what this test proves: the fixture has no entity-owned
    // accounts, so `entityWithdrawals` is 0 in every year and an ADDITIVE
    // `+ y.entityWithdrawals.total` bug could not red here. Wholesale
    // replacement does red. If this assertion ever fails, the fixture has
    // grown entity withdrawals and the loop below becomes the real guard.
    expect(years.every((y) => y.entityWithdrawals.total === 0)).toBe(true);
    for (const [i, r] of rows.entries()) {
      expect(r.portfolioDraw).toBeCloseTo(years[i].withdrawals.total / 12, 6);
    }
  });

  it("labels ages the same way the existing cash-flow drill does", () => {
    expect(rows[0].ageLabel).toBe("Age 56 / 54");
  });
});

describe("cash gifts", () => {
  it("sit inside expenses.other exactly once, and reach fixed.other unchanged", () => {
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

    // The module must carry that through untouched. This is the only test that
    // pins `fixed.other` at all: the base fixture's `expenses.other` is 0 in
    // every year, so on that fixture dropping the field entirely, or adding
    // `cashGifts` on top of it, are both invisible.
    const giftRows = buildMonthlyCashFlowRows(years, clientData, "nominal");
    const giftRow = giftRows.find((r) => r.year === 2026)!;
    expect(giftRow.fixed.other * 12).toBeCloseTo(y2026.expenses.other, 6);
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
