import { describe, it, expect } from "vitest";
import { categorizeDraw, planSupplementalWithdrawal } from "../withdrawal";
import type { Account, WithdrawalPriority } from "../types";

const ira = (over: Partial<Account> & { id: string }): Account =>
  ({
    name: over.id,
    category: "retirement",
    subType: "traditional_ira",
    value: 0,
    basis: 0,
    owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
    ...over,
  }) as Account;

describe("categorizeDraw — Traditional IRA post-tax basis (Form 8606)", () => {
  it("shelters the pro-rata basis slice instead of taxing the whole draw", () => {
    // 150k post-tax basis in a 600k pool → 25% of the draw is a return of
    // already-taxed dollars and 75% is ordinary income.
    const draw = categorizeDraw({
      account: ira({ id: "a" }),
      amount: 100_000,
      balance: 400_000,
      basisMap: { a: 150_000 },
      ownerAge: 70,
      tradIraPool: { balance: 600_000, basis: 150_000 },
    });
    expect(draw.ordinaryIncome).toBe(75_000);
    expect(draw.basisReturn).toBe(25_000);
  });

  // The regression this whole change exists to fix.
  it("no longer taxes 100% of a draw from an IRA that holds post-tax basis", () => {
    const draw = categorizeDraw({
      account: ira({ id: "a" }),
      amount: 100_000,
      balance: 400_000,
      basisMap: { a: 150_000 },
      ownerAge: 70,
      tradIraPool: { balance: 600_000, basis: 150_000 },
    });
    expect(draw.ordinaryIncome).not.toBe(100_000);
  });

  it("still taxes the entire draw when the pool holds no post-tax basis", () => {
    const draw = categorizeDraw({
      account: ira({ id: "a" }),
      amount: 100_000,
      balance: 400_000,
      basisMap: { a: 0 },
      ownerAge: 70,
      tradIraPool: { balance: 600_000, basis: 0 },
    });
    expect(draw.ordinaryIncome).toBe(100_000);
    expect(draw.basisReturn).toBe(0);
  });

  // §72(t) is an additional tax on the amount INCLUDIBLE IN GROSS INCOME.
  // Post-tax dollars coming back are not includible, so they carry no penalty.
  it("charges the 10% early penalty on the taxable slice only", () => {
    const draw = categorizeDraw({
      account: ira({ id: "a" }),
      amount: 100_000,
      balance: 400_000,
      basisMap: { a: 150_000 },
      ownerAge: 50,
      tradIraPool: { balance: 600_000, basis: 150_000 },
    });
    expect(draw.ordinaryIncome).toBe(75_000);
    expect(draw.earlyWithdrawalPenalty).toBe(7_500);
  });

  it("falls back to fully taxable when the caller supplies no pool", () => {
    const draw = categorizeDraw({
      account: ira({ id: "a" }),
      amount: 100_000,
      balance: 400_000,
      basisMap: { a: 150_000 },
      ownerAge: 70,
    });
    expect(draw.ordinaryIncome).toBe(100_000);
    expect(draw.basisReturn).toBe(0);
  });

  // 401(k)/403(b) track already-taxed dollars in rothValue, never in `basis`.
  it("does not apply IRA pro-rata to a 401(k)", () => {
    const draw = categorizeDraw({
      account: ira({ id: "k", subType: "401k" }),
      amount: 100_000,
      balance: 400_000,
      basisMap: { k: 150_000 },
      ownerAge: 70,
      tradIraPool: { balance: 600_000, basis: 150_000 },
    });
    expect(draw.ordinaryIncome).toBe(100_000);
    expect(draw.basisReturn).toBe(0);
  });
});

describe("planSupplementalWithdrawal — pool walks down across draws", () => {
  const accounts = [
    ira({ id: "a" }),
    ira({ id: "b" }),
    ira({ id: "spouse", owners: [{ kind: "family_member", familyMemberId: "fm-spouse", percent: 1 }] }),
  ];
  const strategy: WithdrawalPriority[] = [
    { accountId: "a", priorityOrder: 1, startYear: 2000, endYear: 2100 },
    { accountId: "b", priorityOrder: 2, startYear: 2000, endYear: 2100 },
  ] as WithdrawalPriority[];

  it("shelters the pro-rata slice of a supplemental draw", () => {
    const plan = planSupplementalWithdrawal({
      shortfall: 100_000,
      strategy,
      householdBalances: { a: 400_000, b: 200_000, spouse: 100_000 },
      basisMap: { a: 150_000, b: 0, spouse: 100_000 },
      accounts,
      ages: { client: 70, spouse: 70 },
      isSpouseAccount: (acct) => acct.id === "spouse",
      year: 2030,
    });
    // Pool for fm-client = 600k balance / 150k basis → 25% tax-free.
    expect(plan.recognizedIncome.ordinaryIncome).toBe(75_000);
    expect(plan.draws[0].basisReturn).toBe(25_000);
  });

  // The spouse's fully post-tax IRA must not shelter the client's draw.
  it("does not let a spouse's basis shelter the client's distribution", () => {
    const plan = planSupplementalWithdrawal({
      shortfall: 100_000,
      strategy,
      householdBalances: { a: 400_000, b: 200_000, spouse: 100_000 },
      basisMap: { a: 0, b: 0, spouse: 100_000 },
      accounts,
      ages: { client: 70, spouse: 70 },
      isSpouseAccount: (acct) => acct.id === "spouse",
      year: 2030,
    });
    expect(plan.recognizedIncome.ordinaryIncome).toBe(100_000);
  });

  // Two draws inside ONE plan: the second must see the basis the first used,
  // otherwise the same post-tax dollars shelter income twice.
  it("does not re-shelter basis the earlier draw in the same plan consumed", () => {
    const plan = planSupplementalWithdrawal({
      shortfall: 600_000, // drains a (400k) then b (200k) — the entire pool
      strategy,
      householdBalances: { a: 400_000, b: 200_000, spouse: 0 },
      basisMap: { a: 150_000, b: 0, spouse: 0 },
      accounts,
      ages: { client: 70, spouse: 70 },
      isSpouseAccount: (acct) => acct.id === "spouse",
      year: 2030,
    });
    // Draining the whole pool recognizes exactly balance − basis.
    expect(plan.recognizedIncome.ordinaryIncome).toBeCloseTo(450_000, 6);
    const totalBasisReturn = plan.draws.reduce((s, d) => s + d.basisReturn, 0);
    expect(totalBasisReturn).toBeCloseTo(150_000, 6);
  });
});

describe("classifyTransferTax — IRA distribution to a non-retirement account", () => {
  const base = {
    sourceCategory: "retirement" as const,
    sourceSubType: "traditional_ira",
    targetCategory: "cash" as const,
    targetSubType: "checking",
    amount: 100_000,
    sourceAccountValue: 400_000,
    sourceAccountBasis: 150_000,
    allTraditionalIraBasis: 0,
    allTraditionalIraBalance: 0,
    ownerAge: 70,
    rothBasis: 0,
  };

  it("shelters the pro-rata post-tax slice instead of taxing the whole transfer", async () => {
    const { classifyTransferTax } = await import("../tax-classification");
    const r = classifyTransferTax({
      ...base,
      sourceTradIraPool: { balance: 600_000, basis: 150_000 },
    });
    expect(r.taxableOrdinaryIncome).toBe(75_000);
    expect(r.basisReturn).toBe(25_000);
    expect(r.label).toBe("taxable_distribution");
  });

  it("still fully taxes a $0-basis IRA", async () => {
    const { classifyTransferTax } = await import("../tax-classification");
    const r = classifyTransferTax({ ...base, sourceTradIraPool: { balance: 600_000, basis: 0 } });
    expect(r.taxableOrdinaryIncome).toBe(100_000);
    expect(r.basisReturn).toBe(0);
  });

  it("charges the pre-59.5 penalty on the taxable slice only", async () => {
    const { classifyTransferTax } = await import("../tax-classification");
    const r = classifyTransferTax({
      ...base,
      ownerAge: 50,
      sourceTradIraPool: { balance: 600_000, basis: 150_000 },
    });
    expect(r.taxableOrdinaryIncome).toBe(75_000);
    expect(r.earlyWithdrawalPenalty).toBe(7_500);
    expect(r.label).toBe("early_distribution");
  });
});
