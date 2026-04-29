/**
 * Golden fixture regression tests — PR1 Task 7 (audit F5).
 *
 * These tests lock the baseline output of three canonical scenarios so that
 * PR2's architecture change (iterative re-tax) produces a clear, auditable diff.
 *
 * G1 — Pre-retirement, no deficit:        numbers should be UNCHANGED by PR2.
 * G2 — Early retiree, taxable+Roth basis: numbers will MOVE in PR2 (tax added).
 * G3 — Late retiree, Trad IRA + RMDs:     numbers will shift slightly in PR2.
 *
 * runProjection returns ProjectionYear[] directly (not { years: ... }).
 */
import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type { ProjectionYear } from "../types";
import {
  g1ClientData,
  g1ExpectedYears,
  g2ClientData,
  g2ExpectedYears,
  g3ClientData,
  g3ExpectedYears,
  type GoldenExpectedYear,
} from "./golden-fixtures-data";

function assertGoldenYears(
  scenario: string,
  projYears: ProjectionYear[],
  expected: GoldenExpectedYear[],
) {
  for (const e of expected) {
    const yr = projYears.find((y) => y.year === e.year);
    expect(yr, `${scenario}: missing year ${e.year}`).toBeDefined();
    expect(yr!.expenses.taxes, `${scenario} ${e.year} expenses.taxes`).toBeCloseTo(e.expensesTaxes, 2);
    expect(yr!.withdrawals.total, `${scenario} ${e.year} withdrawals.total`).toBeCloseTo(e.withdrawalsTotal, 2);
    expect(yr!.taxDetail?.earnedIncome ?? 0, `${scenario} ${e.year} taxDetail.earnedIncome`).toBeCloseTo(e.taxDetailEarned, 2);
    expect(yr!.taxDetail?.ordinaryIncome ?? 0, `${scenario} ${e.year} taxDetail.ordinaryIncome`).toBeCloseTo(e.taxDetailOrdinary, 2);
    expect(yr!.taxDetail?.capitalGains ?? 0, `${scenario} ${e.year} taxDetail.capitalGains`).toBeCloseTo(e.taxDetailCapGains, 2);
  }
}

describe("golden fixture G1 — pre-retirement, no deficit", () => {
  it("matches captured baseline year-by-year", () => {
    assertGoldenYears("G1", runProjection(g1ClientData), g1ExpectedYears);
  });
});

describe("golden fixture G2 — early retiree, taxable + Roth basis deficit", () => {
  it("matches captured baseline year-by-year (PR2 will move these numbers)", () => {
    assertGoldenYears("G2", runProjection(g2ClientData), g2ExpectedYears);
  });
});

describe("golden fixture G3 — late retiree, Trad IRA deficit + RMDs", () => {
  it("matches captured baseline year-by-year", () => {
    assertGoldenYears("G3", runProjection(g3ClientData), g3ExpectedYears);
  });
});
