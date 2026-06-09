import { describe, it, expect } from "vitest";
import { runProjection } from "..";
import { buildClientData, sampleAccounts, sampleFamilyMembers } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account } from "../types";

// The base fixture has no default checking account, so income/expense/tax
// flows (which route through creditCash → default checking) have nowhere to
// land and never produce cash-ledger entries. Inject one so the trivial
// cash-basis invariant has entries to assert against.
const householdChecking: Account = {
  id: "acct-checking",
  name: "Household Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 25000,
  basis: 25000,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

describe("asset-ledger per-entry basis", () => {
  it("cash/checking entries carry basis == amount", () => {
    const years = runProjection(
      buildClientData({ accounts: [...sampleAccounts, householdChecking] }),
    );
    const y0 = years[0];

    // Sanity: at least one cash-like ledger carries income/expense/tax entries,
    // otherwise the invariant below would pass vacuously.
    let asserted = 0;
    for (const ledger of Object.values(y0.accountLedgers)) {
      // cash-like accounts: every entry's basis equals its amount
      if (ledger.basisBoY !== undefined && ledger.basisBoY === ledger.beginningValue) {
        for (const e of ledger.entries) {
          if (e.category === "income" || e.category === "expense" || e.category === "tax") {
            expect(e.basis, e.label).toBe(e.amount);
            asserted++;
          }
        }
      }
    }
    expect(asserted).toBeGreaterThan(0);
  });

  it("growth/withdrawal/roth sites are NOT yet populated in phase 1 (placeholder)", () => {
    // Sentinel so the reconciliation invariant test is added in Phase 2 (Task 9),
    // after the tax-sensitive sites are populated. Phase 1 leaves those basis
    // deltas undefined intentionally.
    expect(true).toBe(true);
  });

  it("growth-realization basis equals basisIncrease on taxable (LTCG excluded), 0 on retirement", () => {
    // A realization mix with a large LTCG slice so the basis-bearing portion
    // (oi + qdiv + stcg + taxExempt) is strictly less than the full growth —
    // LTCG is unrealized appreciation and must NOT count toward basis.
    const realization = {
      pctOrdinaryIncome: 0.2,
      pctQualifiedDividends: 0.1,
      pctLtCapitalGains: 0.6, // excluded from basis
      pctTaxExempt: 0.1,
      turnoverPct: 0, // no STCG → 0.6 stays LTCG
    };
    // Taxable account with embedded LTCG: growth bumps basis only by the
    // non-LTCG portion. Retirement account carries the SAME realization model
    // (so growthDetail/basisIncrease are nonzero) but basis stays flat there.
    const taxableWithLtcg: Account = {
      ...sampleAccounts.find((a) => a.id === "acct-brokerage")!,
      realization,
    };
    const retirementWithRealization: Account = {
      ...sampleAccounts.find((a) => a.id === "acct-401k")!,
      realization,
    };
    const otherAccounts = sampleAccounts.filter(
      (a) => a.id !== "acct-brokerage" && a.id !== "acct-401k",
    );
    const years = runProjection(
      buildClientData({
        accounts: [
          taxableWithLtcg,
          retirementWithRealization,
          ...otherAccounts,
          householdChecking,
        ],
      }),
    );
    const y0 = years[0];

    // Taxable brokerage: growth entry basis == growthDetail.basisIncrease and < amount.
    const taxLedger = y0.accountLedgers["acct-brokerage"];
    expect(taxLedger?.growthDetail, "brokerage should have a realization model").toBeTruthy();
    const taxGrowth = taxLedger?.entries.find((e) => e.category === "growth");
    expect(taxGrowth, "expected a growth entry on the taxable account").toBeTruthy();
    expect(taxGrowth?.basis, "taxable growth basis").toBeCloseTo(
      taxLedger!.growthDetail!.basisIncrease,
      6,
    );
    // LTCG is excluded, so basis is strictly less than the full growth amount.
    expect(taxGrowth!.basis!).toBeLessThan(taxGrowth!.amount);
    expect(taxGrowth!.basis!).toBeGreaterThan(0);

    // Retirement 401k: growthDetail/basisIncrease are nonzero (realization model
    // is present) but the growth entry's basis is 0 — basis tracks post-tax
    // contributions, not realization, on retirement accounts.
    const retLedger = y0.accountLedgers["acct-401k"];
    expect(retLedger?.growthDetail, "401k should have a realization model").toBeTruthy();
    expect(retLedger!.growthDetail!.basisIncrease, "401k basisIncrease nonzero").toBeGreaterThan(0);
    const retGrowth = retLedger?.entries.find((e) => e.category === "growth");
    expect(retGrowth, "expected a growth entry on the retirement account").toBeTruthy();
    expect(retGrowth?.basis, "retirement growth basis must be 0").toBe(0);

    // Gate guard, across ALL accounts: a growth entry's basis is never greater
    // than its amount, and any nonzero growth basis lands only on taxable/cash.
    for (const [acctId, ledger] of Object.entries(y0.accountLedgers)) {
      const acct = [taxableWithLtcg, retirementWithRealization, ...otherAccounts, householdChecking].find(
        (a) => a.id === acctId,
      );
      for (const e of ledger.entries) {
        if (e.category !== "growth" || e.basis === undefined) continue;
        expect(e.basis, `${acctId} growth basis <= amount`).toBeLessThanOrEqual(e.amount);
        if (e.basis !== 0) {
          expect(
            acct?.category === "taxable" || acct?.category === "cash",
            `${acctId} nonzero growth basis only on taxable/cash`,
          ).toBe(true);
        }
      }
    }
  });

  it("taxable supplemental withdrawal basis == basisReturn (negative); RMD basis 0; RMD cash inflow basis == amount", () => {
    // Force a deficit large enough to drain the $50k cash emergency fund
    // (priority 1) AND draw from the taxable brokerage (priority 2). The
    // brokerage draw realizes partial basis (basis 200k / value 300k → ~33%
    // gain), so its withdrawal entry's basis must equal the engine's own
    // withdrawalDetail.basisReturn (negative — it's an outflow).
    //
    // Also makes the household RMD-eligible (client born 1948 → RMD at 73) so
    // the rmdEnabled 401k produces an `rmd` entry (retirement source → basis 0)
    // and a matching cash inflow into checking (cash 1:1 → basis == amount).
    const elderlyClient = {
      ...buildClientData().client,
      dateOfBirth: "1948-03-01", // age 78 in 2026 → RMD-eligible
      spouseDob: "1950-05-01",
      retirementAge: 65,
    };
    const elderlyFamily = [
      { ...sampleFamilyMembers[0], dateOfBirth: "1948-03-01" },
      { ...sampleFamilyMembers[1], dateOfBirth: "1950-05-01" },
    ];
    const years = runProjection(
      buildClientData({
        client: elderlyClient,
        familyMembers: elderlyFamily,
        accounts: [...sampleAccounts, householdChecking],
        // No salary (retired) + a single large living expense → big deficit
        // that cannot be covered by SS + RMD, forcing supplemental draws.
        incomes: [
          {
            id: "inc-ss-john",
            type: "social_security",
            name: "John SS",
            annualAmount: 36000,
            startYear: 2026,
            endYear: 2055,
            growthRate: 0.02,
            owner: "client",
            claimingAge: 67,
          },
        ],
        expenses: [
          {
            id: "exp-living",
            type: "living",
            name: "Living Expenses",
            annualAmount: 200000,
            startYear: 2026,
            endYear: 2055,
            growthRate: 0.03,
          },
        ],
        savingsRules: [],
        liabilities: [],
      }),
    );
    const y0 = years[0];

    // --- Taxable brokerage supplemental withdrawal ---
    const brokerLedger = y0.accountLedgers["acct-brokerage"];
    expect(brokerLedger?.withdrawalDetail, "brokerage should have a withdrawalDetail").toBeTruthy();
    expect(
      brokerLedger!.withdrawalDetail!.basisReturn,
      "brokerage basisReturn should be nonzero (partial basis returned)",
    ).toBeGreaterThan(0);
    // The taxable, non-internal withdrawal entry on the brokerage.
    const brokerWithdrawal = brokerLedger?.entries.find(
      (e) => e.category === "withdrawal" && !e.isInternalTransfer,
    );
    expect(brokerWithdrawal, "expected a withdrawal entry on the brokerage").toBeTruthy();
    expect(brokerWithdrawal!.amount, "withdrawal amount is negative (outflow)").toBeLessThan(0);
    // Entry basis is the negative of the realized basisReturn — it equals the
    // exact delta applied to basisMap for this withdrawal.
    // Safe here because this single-year draw never trips the
    // `min(basisReturn, basisBefore)` clamp on basisMap, so the entry's basis
    // equals the unclamped withdrawalDetail.basisReturn. A multi-draw fixture (or
    // a starting basis below basisReturn) could diverge — the entry would then
    // track the clamped basisMap delta, not the raw accumulated basisReturn.
    expect(brokerWithdrawal!.basis, "brokerage withdrawal basis").toBeCloseTo(
      -brokerLedger!.withdrawalDetail!.basisReturn,
      6,
    );
    expect(brokerWithdrawal!.basis!, "withdrawal basis is negative (outflow)").toBeLessThan(0);
    // Non-tautological: a pure-basis cash draw would have basis == amount; here
    // the brokerage realized a gain, so |basis| is strictly less than |amount|.
    expect(Math.abs(brokerWithdrawal!.basis!)).toBeLessThan(Math.abs(brokerWithdrawal!.amount));

    // --- 401k RMD: retirement source → basis 0 ---
    const k401Ledger = y0.accountLedgers["acct-401k"];
    const rmdEntry = k401Ledger?.entries.find((e) => e.category === "rmd");
    expect(rmdEntry, "expected an RMD entry on the 401k").toBeTruthy();
    expect(rmdEntry!.amount, "RMD amount is negative (outflow)").toBeLessThan(0);
    expect(rmdEntry!.basis, "RMD (pre-tax distribution) carries no basis").toBe(0);

    // --- RMD cash inflow into checking: cash 1:1 → basis == amount ---
    const checkingLedger = y0.accountLedgers["acct-checking"];
    const rmdCashIn = checkingLedger?.entries.find(
      (e) => e.category === "rmd" && e.amount > 0,
    );
    expect(rmdCashIn, "expected an RMD cash-inflow entry on checking").toBeTruthy();
    expect(rmdCashIn!.basis, "RMD cash inflow basis == amount (cash 1:1)").toBe(
      rmdCashIn!.amount,
    );
  });

  it("contribution legs cross-reference each other via counterpartyId", () => {
    // Inject a default checking account so the savings cash source resolves;
    // the base fixture has none, so without it `defaultChecking` is undefined
    // and the contribution's counterparty (the cash account) can't be named.
    const years = runProjection(
      buildClientData({ accounts: [...sampleAccounts, householdChecking] }),
    );
    const y0 = years[0];
    // sampleSavingsRules contributes to acct-401k from the household checking
    // account (acct-checking). The dest credit should name that cash source.
    const dest = y0.accountLedgers["acct-401k"];
    const contrib = dest?.entries.find((e) => e.category === "savings_contribution");
    expect(contrib, "expected a savings_contribution entry on acct-401k").toBeTruthy();
    expect(
      contrib?.counterpartyId,
      "contribution should name its cash source",
    ).toBe("acct-checking");
  });
});
