/**
 * Golden fixture regression tests — PR1 Task 7 (audit F5) + Task 12 (G4).
 *
 * These tests lock the baseline output of four canonical scenarios so that
 * PR2's architecture change (iterative re-tax) produces a clear, auditable diff.
 *
 * G1 — Pre-retirement, no deficit:        numbers should be UNCHANGED by PR2.
 * G2 — Early retiree, taxable+Roth basis: numbers will MOVE in PR2 (tax added).
 * G3 — Late retiree, Trad IRA + RMDs:     numbers will shift slightly in PR2.
 * G4 — Split 401(k), Roth/pre-tax:        locked here; exercises rothPercent end-to-end.
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
  g4ClientData,
  g4ExpectedYears,
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

    // G4-only: Roth basis on the 401(k) and above-the-line deduction.
    if (e.rothValueEoY401k !== undefined) {
      const ledger = yr!.accountLedgers["acct-g4-401k"];
      expect(ledger, `${scenario} ${e.year} acct-g4-401k ledger`).toBeDefined();
      expect(
        ledger!.rothValueEoY,
        `${scenario} ${e.year} rothValueEoY (expect 30% of contribution)`,
      ).toBeCloseTo(e.rothValueEoY401k, 2);
    }
    if (e.aboveLineRetirementContributions !== undefined) {
      expect(
        yr!.deductionBreakdown?.aboveLine.retirementContributions,
        `${scenario} ${e.year} aboveLine.retirementContributions (expect 70% of contribution)`,
      ).toBeCloseTo(e.aboveLineRetirementContributions, 2);
    }
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

describe("golden fixture G4 — split 401(k) savings rule, Roth/pre-tax", () => {
  it("matches captured baseline year-by-year: Roth basis = 30% of contribution, deduction = 70%", () => {
    assertGoldenYears("G4", runProjection(g4ClientData), g4ExpectedYears);
  });
});
