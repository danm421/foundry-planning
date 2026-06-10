import { describe, it, expect } from "vitest";
import { runProjection } from "..";
import { applyRothConversions } from "../roth-conversions";
import { buildClientData, sampleAccounts, sampleFamilyMembers } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, AccountLedger, RothConversion } from "../types";

/** Per-account basis-reconciliation tolerance ($1, matching the view-model). */
const TOL = 1;

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

  it("roth-conversion legs carry basis == the actual basisMap delta (Form-8606 pro-rata)", () => {
    // Trad IRA pool = 600k (ira-a 400k + ira-b 200k); 150k after-tax basis on
    // ira-a. Per Form 8606 the nontaxable (basis) fraction is computed on the
    // AGGREGATED pool: 150k/600k = 25% × 100k slice = 25k of basis leaves the
    // source — strictly less than the 100k slice (non-tautological: basisMoved
    // < slice, so basis !== amount). The same 25% pool fraction drives the
    // taxable figure in classifyTransferTax, so the basis decrement and the
    // taxable calc agree and pool basis is conserved.
    const iraA: Account = {
      id: "ira-a", name: "IRA A", category: "retirement", subType: "traditional_ira",
      titlingType: "jtwros", value: 400_000, basis: 150_000, growthRate: 0,
      rmdEnabled: false, owners: [],
    };
    const iraB: Account = {
      id: "ira-b", name: "IRA B", category: "retirement", subType: "traditional_ira",
      titlingType: "jtwros", value: 200_000, basis: 0, growthRate: 0,
      rmdEnabled: false, owners: [],
    };
    const rothDest: Account = {
      id: "roth-1", name: "Roth IRA", category: "retirement", subType: "roth_ira",
      titlingType: "jtwros", value: 0, basis: 0, growthRate: 0,
      rmdEnabled: false, owners: [],
    };
    const mkLedger = (value: number): AccountLedger => ({
      beginningValue: value, growth: 0, contributions: 0, distributions: 0,
      internalContributions: 0, internalDistributions: 0, rmdAmount: 0, fees: 0,
      endingValue: value, entries: [],
    });

    const accountBalances: Record<string, number> = { "ira-a": 400_000, "ira-b": 200_000, "roth-1": 0 };
    const basisMap: Record<string, number> = { "ira-a": 150_000, "ira-b": 0, "roth-1": 0 };
    const accountLedgers: Record<string, AccountLedger> = {
      "ira-a": mkLedger(400_000),
      "ira-b": mkLedger(200_000),
      "roth-1": mkLedger(0),
    };

    // Snapshot pre-conversion basis so we can compare the entry basis against
    // the EXACT delta the engine applied to basisMap.
    const srcBasisBefore = basisMap["ira-a"];
    const destBasisBefore = basisMap["roth-1"];

    const conv: RothConversion = {
      id: "rc-prorata", name: "Pro-rata convert", destinationAccountId: "roth-1",
      sourceAccountIds: ["ira-a"], conversionType: "fixed_amount",
      fixedAmount: 100_000, startYear: 2026, indexingRate: 0,
    };
    applyRothConversions({
      conversions: [conv],
      accounts: [iraA, iraB, rothDest],
      accountBalances,
      basisMap,
      accountLedgers,
      year: 2026,
      ownerAges: { client: 60 },
    });

    const srcBasisDelta = basisMap["ira-a"] - srcBasisBefore;
    const destBasisDelta = basisMap["roth-1"] - destBasisBefore;

    // Source (Trad) leg: a withdrawal entry whose basis is the negative
    // pro-rata basis decrease — NOT the full converted amount.
    const srcEntry = accountLedgers["ira-a"].entries.find((e) => e.category === "withdrawal");
    expect(srcEntry, "expected a withdrawal entry on the Trad source").toBeTruthy();
    expect(srcEntry!.amount).toBe(-100_000);
    expect(srcEntry!.basis, "source basis == actual basisMap decrease").toBeCloseTo(srcBasisDelta, 6);
    expect(srcEntry!.basis!, "source basis is negative (basis leaves)").toBeLessThan(0);
    // Non-tautological: pool-ratio basis moved (25k) < slice (100k) → basis ≠ amount.
    expect(Math.abs(srcEntry!.basis!)).toBeLessThan(Math.abs(srcEntry!.amount));
    expect(srcEntry!.basis!).toBeCloseTo(-25_000, 0);

    // Dest (Roth) leg: a contribution entry whose basis is the positive
    // basisMap increase the engine applied.
    const destEntry = accountLedgers["roth-1"].entries.find((e) => e.category === "savings_contribution");
    expect(destEntry, "expected a contribution entry on the Roth dest").toBeTruthy();
    expect(destEntry!.amount).toBe(100_000);
    expect(destEntry!.basis, "dest basis == actual basisMap increase").toBeCloseTo(destBasisDelta, 6);
    expect(destEntry!.basis!, "dest basis is positive (basis arrives)").toBeGreaterThan(0);
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

  // ── Per-account basis-reconciliation invariant (Task 9 Phase 2) ────────────
  //
  // Replaces the Phase-1 sentinel. For every account/year whose ledger tracks
  // basis (basisBoY + basisEoY both defined), the entry basis deltas must sum
  // to the year's basis change within $1:  basisBoY + Σ entry.basis ≈ basisEoY.
  //
  // Each entry's `basis` is the EXACT basisMap delta the engine applied at that
  // site (cash 1:1, growth realization, taxable withdrawal basisReturn, RMD 0,
  // and — added in this task — both Roth-conversion legs). The invariant is the
  // guardrail that keeps those sites honest as the engine evolves.
  //
  // Known Phase-1 basis-recon limits (no current fixture exercises these, so no
  // guard is wired up — add one keyed on the right field when a fixture first does):
  //  • Equity-comp vest/sale basis lives inside applyEquityYear and is stamped on
  //    the entry LABEL ("<ticker> shares vest/sold"), not sourceId — see future-work/engine.md.
  //  • Death-event step-up lands on the next year's basisBoY (no entry), so the
  //    step-up boundary year won't reconcile via entries by design.

  // Per-entry basis reconciliation applies to accounts that ACCRUE basis through
  // discrete entry deltas (taxable: growth-realization + withdrawals; retirement:
  // contributions + Roth legs). Cash accounts are different: basis ≡ value by
  // definition (every dollar in/out is basis 1:1), stamped from the balance at the
  // bookends — not summed from entries. They're verified by the dedicated
  // "cash accounts: basis tracks value" test below, and skipped here. (In the
  // fixture, cash growth carries no entry basis because the sample cash accounts
  // have no realization mix; production cash resolves to pctOrdinaryIncome:1.)
  const CASH_ACCOUNT_IDS = new Set(
    sampleAccounts.filter((a) => a.category === "cash").map((a) => a.id),
  );

  function assertBasisReconciles(years: ReturnType<typeof runProjection>) {
    let asserted = 0;
    for (const y of years) {
      for (const [id, ledger] of Object.entries(y.accountLedgers)) {
        if (CASH_ACCOUNT_IDS.has(id)) continue;
        if (ledger.basisBoY === undefined || ledger.basisEoY === undefined) continue;
        const sum = ledger.entries.reduce((s, e) => s + (e.basis ?? 0), 0);
        expect(
          Math.abs(ledger.basisEoY - ledger.basisBoY - sum),
          `${id}@${y.year}`,
        ).toBeLessThanOrEqual(TOL);
        asserted++;
      }
    }
    return asserted;
  }

  it("every account reconciles on basis: basisBoY + Σ entry.basis ≈ basisEoY", () => {
    const years = runProjection(buildClientData());
    const asserted = assertBasisReconciles(years);
    // Guard against a vacuous pass: the default fixture tracks basis on 5
    // accounts across 30 years (≈150 account-years).
    expect(asserted).toBeGreaterThan(100);
  });

  // The base fixture above has NO default checking, so it never exercises a cash
  // account carrying income/expense/withdrawal activity. A real client always
  // has one — and cash basis is special: cash flows never move basisMap, so the
  // basis must mirror the BALANCE (cash basis ≡ value), not the (frozen) basisMap.
  // Without that, every client's checking showed a stale End-of-Year basis and
  // tripped the reconcile warning. This test injects a default checking so the
  // cash-basis rule is non-vacuously asserted.
  it("cash accounts: basis tracks value, and the basis ledger is as consistent as the amount ledger", () => {
    const years = runProjection(
      buildClientData({ accounts: [...sampleAccounts, householdChecking] }),
    );
    let activeYears = 0;
    for (const y of years) {
      const l = y.accountLedgers["acct-checking"];
      if (!l) continue;
      // Cash has no cost basis distinct from its balance.
      expect(l.basisBoY, `basisBoY@${y.year}`).toBeCloseTo(l.beginningValue, 0);
      expect(l.basisEoY, `basisEoY@${y.year}`).toBeCloseTo(l.endingValue, 0);
      // The basis ledger introduces no drift of its own: its residual must equal
      // the (pre-existing, gross-vs-net) amount residual to the dollar.
      const sumAmt = l.entries.reduce((s, e) => s + e.amount, 0);
      const sumBasis = l.entries.reduce((s, e) => s + (e.basis ?? 0), 0);
      const amtResidual = l.endingValue - l.beginningValue - sumAmt;
      const basisResidual = (l.basisEoY ?? 0) - (l.basisBoY ?? 0) - sumBasis;
      expect(
        Math.abs(basisResidual - amtResidual),
        `basis/amount residual parity@${y.year}`,
      ).toBeLessThanOrEqual(TOL);
      if (l.entries.length > 0) activeYears++;
    }
    // Non-vacuous: checking actually carried activity across many years.
    expect(activeYears).toBeGreaterThan(5);
  });

  it("basis reconciles across a multi-year Roth-conversion fixture (exercises both legs)", () => {
    // A Trad IRA with after-tax basis + a Roth destination + a fixed-amount
    // conversion across 2026–2030. This drives the Roth-conversion basis legs
    // added in this task through a full runProjection, including the source
    // pro-rata decrease and the dest increase, year over year.
    const tradIra: Account = {
      id: "acct-trad-ira",
      name: "John Trad IRA",
      category: "retirement",
      subType: "traditional_ira",
      titlingType: "jtwros",
      value: 400_000,
      basis: 100_000, // 25% after-tax basis → pro-rata conversions
      growthRate: 0.05,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const conv: RothConversion = {
      id: "rc-fixed",
      name: "Annual Roth Conversion",
      destinationAccountId: "acct-roth",
      sourceAccountIds: ["acct-trad-ira"],
      conversionType: "fixed_amount",
      fixedAmount: 40_000,
      startYear: 2026,
      endYear: 2030,
      indexingRate: 0,
    };
    const years = runProjection(
      buildClientData({
        accounts: [...sampleAccounts, tradIra],
        rothConversions: [conv],
      }),
    );

    // Non-vacuous: the conversion actually fired in the start year.
    const trad0 = years[0].accountLedgers["acct-trad-ira"];
    const convLeg = trad0?.entries.find((e) => e.sourceId === "rc-fixed");
    expect(convLeg, "expected a roth-conversion leg on the Trad IRA in 2026").toBeTruthy();
    expect(convLeg!.basis, "conversion source basis is negative").toBeLessThan(0);

    assertBasisReconciles(years);
  });
});
