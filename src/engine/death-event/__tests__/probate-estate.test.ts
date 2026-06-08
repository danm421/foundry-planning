import { describe, it, expect } from "vitest";
import { computeProbateEstate } from "../estate-tax";
import type { Account, GrossEstateLine } from "../../types";

const acct = (
  partial: Partial<Account> & Pick<Account, "id" | "category">,
): Account =>
  ({
    name: partial.id,
    subType: "brokerage",
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    titlingType: "jtwros",
    owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
    ...partial,
  }) as unknown as Account;

const line = (accountId: string, amount: number): GrossEstateLine => ({
  label: accountId,
  accountId,
  liabilityId: null,
  percentage: 1,
  amount,
});

describe("computeProbateEstate", () => {
  it("includes a solely-owned taxable account", () => {
    const accounts = [acct({ id: "a1", category: "taxable" })];
    const gross = { lines: [line("a1", 500_000)], total: 500_000 };
    expect(computeProbateEstate({ gross, accounts, deathOrder: 1 })).toBe(500_000);
  });

  it("excludes a jointly-titled account at first death, includes it at final death", () => {
    const accounts = [
      acct({
        id: "a1",
        category: "taxable",
        owners: [
          { kind: "family_member", familyMemberId: "fm-c", percent: 0.5 },
          { kind: "family_member", familyMemberId: "fm-s", percent: 0.5 },
        ],
      }),
    ];
    const grossFirst = { lines: [line("a1", 250_000)], total: 250_000 };
    expect(computeProbateEstate({ gross: grossFirst, accounts, deathOrder: 1 })).toBe(0);
    const grossFinal = { lines: [line("a1", 500_000)], total: 500_000 };
    expect(computeProbateEstate({ gross: grossFinal, accounts, deathOrder: 2 })).toBe(500_000);
  });

  it("excludes a trust-owned account", () => {
    const accounts = [
      acct({
        id: "a1",
        category: "taxable",
        owners: [{ kind: "entity", entityId: "trust-1", percent: 1 }],
      }),
    ];
    const gross = { lines: [line("a1", 500_000)], total: 500_000 };
    expect(computeProbateEstate({ gross, accounts, deathOrder: 1 })).toBe(0);
  });

  it("excludes an account with a primary beneficiary designation", () => {
    const accounts = [
      acct({
        id: "a1",
        category: "taxable",
        beneficiaries: [
          {
            id: "b1",
            tier: "primary",
            percentage: 1,
            familyMemberId: "fm-child",
            sortOrder: 0,
          },
        ],
      }),
    ];
    const gross = { lines: [line("a1", 500_000)], total: 500_000 };
    expect(computeProbateEstate({ gross, accounts, deathOrder: 1 })).toBe(0);
  });

  it("excludes retirement, annuity and life-insurance categories", () => {
    const accounts = [
      acct({ id: "ira", category: "retirement" }),
      acct({ id: "ann", category: "annuity" }),
      acct({ id: "li", category: "life_insurance" }),
    ];
    const gross = {
      lines: [line("ira", 300_000), line("ann", 100_000), line("li", 400_000)],
      total: 800_000,
    };
    expect(computeProbateEstate({ gross, accounts, deathOrder: 2 })).toBe(0);
  });

  it("includes a directly-owned business interest", () => {
    const accounts = [acct({ id: "biz", category: "business" })];
    const gross = { lines: [line("biz", 750_000)], total: 750_000 };
    expect(computeProbateEstate({ gross, accounts, deathOrder: 2 })).toBe(750_000);
  });

  it("ignores liability (negative) lines", () => {
    const accounts = [acct({ id: "a1", category: "taxable" })];
    const gross = {
      lines: [
        line("a1", 500_000),
        { label: "mortgage", accountId: null, liabilityId: "l1", percentage: 1, amount: -200_000 },
      ],
      total: 300_000,
    };
    expect(computeProbateEstate({ gross, accounts, deathOrder: 1 })).toBe(500_000);
  });
});
