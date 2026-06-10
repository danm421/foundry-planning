import { describe, it, expect } from "vitest";
import { computeGrossEstate, computeProbateEstate } from "../estate-tax";
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
  isProbate: false,
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
        { label: "mortgage", accountId: null, liabilityId: "l1", percentage: 1, amount: -200_000, isProbate: false },
      ],
      total: 300_000,
    };
    expect(computeProbateEstate({ gross, accounts, deathOrder: 1 })).toBe(500_000);
  });

  it("tags each gross-estate line with isProbate, summing to probateEstate", () => {
    // Mix of probate (sole-owned taxable) and non-probate (IRA with a primary
    // beneficiary), plus a household mortgage (liability — never probate).
    const accounts: Account[] = [
      acct({
        id: "tax-1",
        category: "taxable",
        owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
      }),
      acct({
        id: "ira-1",
        category: "retirement",
        owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
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
    const grossInput = {
      deceased: "client" as const,
      deathOrder: 1 as const,
      accounts,
      accountBalances: { "tax-1": 500_000, "ira-1": 300_000 },
      liabilities: [
        {
          id: "l1",
          name: "Mortgage",
          balance: 200_000,
          linkedPropertyId: null,
          ownerFamilyMemberId: null,
          owners: [],
        },
      ] as unknown as import("../../types").Liability[],
      entities: [],
      deceasedFmId: "fm-c",
      survivorFmId: "fm-s",
    };

    const gross = computeGrossEstate(grossInput);
    const probateEstate = computeProbateEstate({
      gross,
      accounts: grossInput.accounts,
      deathOrder: grossInput.deathOrder,
    });

    // The flagged asset lines sum exactly to the probate base.
    const flaggedSum = gross.lines
      .filter((l) => l.isProbate)
      .reduce((s, l) => s + l.amount, 0);
    expect(flaggedSum).toBe(probateEstate);

    // Liabilities (negative) are never probate.
    for (const ln of gross.lines) {
      if (ln.amount < 0) expect(ln.isProbate).toBe(false);
    }

    // Per-asset: the sole-owned taxable account is probate; the IRA with a
    // primary beneficiary is explicitly non-probate (stronger than a bare
    // typeof check — guards against the flag drifting from `base` accumulation).
    const taxLine = gross.lines.find((l) => l.accountId === "tax-1");
    const iraLine = gross.lines.find((l) => l.accountId === "ira-1");
    expect(taxLine?.isProbate).toBe(true);
    expect(iraLine?.isProbate).toBe(false);

    // Sanity: the taxable account is probate; the IRA (primary bene) is not.
    expect(probateEstate).toBe(500_000);
  });
});

describe("revocable-trust probate exclusion", () => {
  const grossBase = {
    deceased: "client" as const,
    deathOrder: 1 as const,
    liabilities: [],
    entities: [],
    deceasedFmId: "fm-c",
    survivorFmId: "fm-s",
  };

  it("tagged account is in the gross estate but excluded from probate", () => {
    const tagged = acct({
      id: "tagged",
      category: "taxable",
      owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
      revocableTrustName: "Smith Family Trust",
    });
    const gross = computeGrossEstate({
      ...grossBase,
      accounts: [tagged],
      accountBalances: { tagged: 100_000 },
    });

    // Ownership still drives inclusion — the tag does not remove it from gross.
    expect(gross.total).toBe(100_000);

    const probate = computeProbateEstate({
      gross,
      accounts: [tagged],
      deathOrder: 1,
    });
    // ...but the tag pulls it out of the probate base.
    expect(probate).toBe(0);

    const line = gross.lines.find((l) => l.accountId === "tagged");
    expect(line?.isProbate).toBe(false);
    expect(line?.revocableTrustName).toBe("Smith Family Trust");
  });

  it("an identical untagged account IS in the probate base", () => {
    const plain = acct({
      id: "plain",
      category: "taxable",
      owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
    });
    const gross = computeGrossEstate({
      ...grossBase,
      accounts: [plain],
      accountBalances: { plain: 100_000 },
    });

    const probate = computeProbateEstate({
      gross,
      accounts: [plain],
      deathOrder: 1,
    });
    expect(probate).toBe(100_000);

    const line = gross.lines.find((l) => l.accountId === "plain");
    expect(line?.isProbate).toBe(true);
  });
});
