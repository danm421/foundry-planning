import { describe, it, expect } from "vitest";
import { runProjection } from "..";
import { buildClientData, sampleAccounts } from "./fixtures";
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
