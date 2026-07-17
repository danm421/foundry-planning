import { describe, it, expect } from "vitest";
import { supplementalDrawSources, type SupplementalDraw } from "../withdrawal";

// R2 (silent reconciliation gap): the engine books each supplemental draw into
// taxDetail.bySource under `withdrawal:<acctId>` / `withdrawal_tax_free:<acctId>`
// keys. When one account is drawn twice in the same year (the same accountId
// appears in two WithdrawalPriority rows), a naive `=` assignment lets the 2nd
// draw OVERWRITE the 1st, while the income totals (taxFreeRetirementIncome and
// recognized income) sum BOTH draws. Because `non_taxable` is not in the ledger's
// RECONCILED character set, the resulting grossSubtotal drift is SILENT — no
// Unattributed row, no ⚠. The assembler must ACCUMULATE per account so the
// bySource entry stays reconciled with the income totals.

function draw(overrides: Partial<SupplementalDraw> & { accountId: string; amount: number }): SupplementalDraw {
  return {
    ordinaryIncome: 0,
    capitalGains: 0,
    basisReturn: 0,
    earlyWithdrawalPenalty: 0,
    ...overrides,
  };
}

// Mirrors projection.ts's taxFreeRetirementSlice for the given retirement accounts:
// the untaxed slice of a retirement draw is display-only non-taxable income.
function retirementSlice(retirementIds: Set<string>) {
  return (d: SupplementalDraw): number =>
    retirementIds.has(d.accountId) ? Math.max(0, d.amount - d.ordinaryIncome) : 0;
}

describe("supplementalDrawSources (R2: per-account accumulation)", () => {
  it("accumulates two tax-free draws on the same account instead of overwriting", () => {
    // Two post-59.5 Roth draws on one account (ordinaryIncome 0 → fully tax-free).
    const draws = [
      draw({ accountId: "acct-roth", amount: 200_000 }),
      draw({ accountId: "acct-roth", amount: 50_000 }),
    ];

    const out = supplementalDrawSources(draws, retirementSlice(new Set(["acct-roth"])));

    // Buggy `=` assignment would keep only the 2nd draw ($50k).
    expect(out["withdrawal_tax_free:acct-roth"]).toEqual({ type: "tax_free", amount: 250_000 });
  });

  it("accumulates two taxable draws on the same account", () => {
    // Two traditional-IRA draws on one account, both ordinary income.
    const draws = [
      draw({ accountId: "acct-ira", amount: 30_000, ordinaryIncome: 30_000 }),
      draw({ accountId: "acct-ira", amount: 20_000, ordinaryIncome: 20_000 }),
    ];

    const out = supplementalDrawSources(draws, retirementSlice(new Set()));

    expect(out["withdrawal:acct-ira"]).toEqual({ type: "ordinary_income", amount: 50_000 });
  });

  it("leaves the common one-draw-per-account case byte-identical", () => {
    const draws = [
      draw({ accountId: "acct-ira", amount: 40_000, ordinaryIncome: 40_000 }),
      draw({ accountId: "acct-roth", amount: 25_000 }),
      draw({ accountId: "acct-brokerage", amount: 10_000, capitalGains: 4_000 }),
    ];

    const out = supplementalDrawSources(draws, retirementSlice(new Set(["acct-ira", "acct-roth"])));

    expect(out).toEqual({
      "withdrawal:acct-ira": { type: "ordinary_income", amount: 40_000 },
      "withdrawal_tax_free:acct-roth": { type: "tax_free", amount: 25_000 },
      "withdrawal:acct-brokerage": { type: "capital_gains", amount: 4_000 },
    });
  });
});
