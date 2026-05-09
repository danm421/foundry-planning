import { describe, it, expect } from "vitest";
import { computeFamilyAccountShares } from "../family-cashflow";
import type { ProjectionYear, AccountLedger, Income, GiftEvent } from "../types";

function makeYear(year: number, accountLedgers: Record<string, Partial<AccountLedger>>): ProjectionYear {
  // Cast — tests only consume fields the pass actually reads.
  return {
    year,
    accountLedgers: accountLedgers as Record<string, AccountLedger>,
    entityCashFlow: new Map(),
    hypotheticalEstateTax: {} as never,
    charitableOutflows: 0,
  } as unknown as ProjectionYear;
}

describe("computeFamilyAccountShares — year-0 init + passive growth", () => {
  it("initializes locked shares from account.value × ownerPercent in year 0", () => {
    const year0 = makeYear(2026, {
      acctA: { beginningValue: 100_000, endingValue: 105_000, growth: 5_000, entries: [] },
    });
    computeFamilyAccountShares({
      years: [year0],
      accountFamilyOwners: new Map([
        [
          "acctA",
          [
            { familyMemberId: "fm-client", percent: 0.5 },
            { familyMemberId: "fm-spouse", percent: 0.5 },
          ],
        ],
      ]),
      clientFamilyMemberId: "fm-client",
      spouseFamilyMemberId: "fm-spouse",
      incomes: [],
      gifts: [],
      familyMembers: [],
    });

    expect(year0.familyAccountSharesEoY?.get("fm-client")?.get("acctA")).toBeCloseTo(52_500);
    expect(year0.familyAccountSharesEoY?.get("fm-spouse")?.get("acctA")).toBeCloseTo(52_500);
  });

  it("passive growth preserves percentages across years (no other flows)", () => {
    const year0 = makeYear(2026, {
      acctA: { beginningValue: 100_000, endingValue: 105_000, growth: 5_000, entries: [] },
    });
    const year1 = makeYear(2027, {
      acctA: { beginningValue: 105_000, endingValue: 110_250, growth: 5_250, entries: [] },
    });
    computeFamilyAccountShares({
      years: [year0, year1],
      accountFamilyOwners: new Map([
        [
          "acctA",
          [
            { familyMemberId: "fm-client", percent: 0.6 },
            { familyMemberId: "fm-spouse", percent: 0.4 },
          ],
        ],
      ]),
      clientFamilyMemberId: "fm-client",
      spouseFamilyMemberId: "fm-spouse",
      incomes: [],
      gifts: [],
      familyMembers: [],
    });

    const y1ClientShare = year1.familyAccountSharesEoY!.get("fm-client")!.get("acctA")!;
    const y1SpouseShare = year1.familyAccountSharesEoY!.get("fm-spouse")!.get("acctA")!;
    const total = y1ClientShare + y1SpouseShare;
    expect(total).toBeCloseTo(110_250);
    expect(y1ClientShare / total).toBeCloseTo(0.6);
    expect(y1SpouseShare / total).toBeCloseTo(0.4);
  });

  it("credits client's share when income.owner === 'client' deposits to a joint account", () => {
    const year0 = makeYear(2026, {
      acctA: {
        beginningValue: 100_000,
        endingValue: 200_000,
        growth: 0,
        entries: [
          { category: "income", label: "Client Salary", amount: 100_000, sourceId: "inc-1" },
        ] as never,
      },
    });
    const incomes: Income[] = [
      {
        id: "inc-1",
        type: "salary",
        name: "Client Salary",
        annualAmount: 100_000,
        startYear: 2026,
        endYear: 2030,
        growthRate: 0,
        owner: "client",
      } as Income,
    ];
    computeFamilyAccountShares({
      years: [year0],
      accountFamilyOwners: new Map([
        [
          "acctA",
          [
            { familyMemberId: "fm-client", percent: 0.5 },
            { familyMemberId: "fm-spouse", percent: 0.5 },
          ],
        ],
      ]),
      clientFamilyMemberId: "fm-client",
      spouseFamilyMemberId: "fm-spouse",
      incomes,
      gifts: [],
      familyMembers: [],
    });

    // BoY 50/50 of $100k = $50k each. Income $100k → all to client.
    // EoY: client=$150k, spouse=$50k.
    expect(year0.familyAccountSharesEoY!.get("fm-client")!.get("acctA")!).toBeCloseTo(150_000);
    expect(year0.familyAccountSharesEoY!.get("fm-spouse")!.get("acctA")!).toBeCloseTo(50_000);
  });

  it("splits joint-owner income pro-rata to current shares", () => {
    const year0 = makeYear(2026, {
      acctA: {
        beginningValue: 100_000,
        endingValue: 110_000,
        growth: 0,
        entries: [
          { category: "income", label: "Joint", amount: 10_000, sourceId: "inc-2" },
        ] as never,
      },
    });
    const incomes: Income[] = [
      {
        id: "inc-2",
        type: "other",
        name: "Joint",
        annualAmount: 10_000,
        startYear: 2026,
        endYear: 2030,
        growthRate: 0,
        owner: "joint",
      } as Income,
    ];
    computeFamilyAccountShares({
      years: [year0],
      accountFamilyOwners: new Map([
        [
          "acctA",
          [
            { familyMemberId: "fm-client", percent: 0.6 },
            { familyMemberId: "fm-spouse", percent: 0.4 },
          ],
        ],
      ]),
      clientFamilyMemberId: "fm-client",
      spouseFamilyMemberId: "fm-spouse",
      incomes,
      gifts: [],
      familyMembers: [],
    });

    // BoY: client=60k, spouse=40k. Joint income $10k → 60/40 split.
    expect(year0.familyAccountSharesEoY!.get("fm-client")!.get("acctA")!).toBeCloseTo(66_000);
    expect(year0.familyAccountSharesEoY!.get("fm-spouse")!.get("acctA")!).toBeCloseTo(44_000);
  });

  it("skips single-owner and unowned accounts", () => {
    const year0 = makeYear(2026, {
      single: { beginningValue: 50_000, endingValue: 51_000, growth: 1_000, entries: [] },
    });
    computeFamilyAccountShares({
      years: [year0],
      accountFamilyOwners: new Map(), // no entries → no ledger
      clientFamilyMemberId: "fm-client",
      spouseFamilyMemberId: "fm-spouse",
      incomes: [],
      gifts: [],
      familyMembers: [],
    });

    expect(year0.familyAccountSharesEoY).toBeUndefined();
  });
});

describe("computeFamilyAccountShares — cash gift attribution", () => {
  it("draws cash gift from the grantor's share first", () => {
    const year0 = makeYear(2026, {
      acctA: {
        beginningValue: 200_000,
        endingValue: 180_000,
        growth: 0,
        entries: [
          // Engine writes sourceId = recipientEntityId on gift outflows.
          { category: "gift", label: "Cash gift", amount: -20_000, sourceId: "ent-1" },
        ] as never,
      },
    });
    const gifts: GiftEvent[] = [
      {
        kind: "cash",
        year: 2026,
        amount: 20_000,
        grantor: "client",
        recipientEntityId: "ent-1",
        sourceAccountId: "acctA",
        useCrummeyPowers: false,
      },
    ];
    computeFamilyAccountShares({
      years: [year0],
      accountFamilyOwners: new Map([
        [
          "acctA",
          [
            { familyMemberId: "fm-client", percent: 0.5 },
            { familyMemberId: "fm-spouse", percent: 0.5 },
          ],
        ],
      ]),
      clientFamilyMemberId: "fm-client",
      spouseFamilyMemberId: "fm-spouse",
      incomes: [],
      gifts,
      familyMembers: [],
    });

    // BoY 100k/100k. Gift -20k entirely from client.
    expect(year0.familyAccountSharesEoY!.get("fm-client")!.get("acctA")!).toBeCloseTo(80_000);
    expect(year0.familyAccountSharesEoY!.get("fm-spouse")!.get("acctA")!).toBeCloseTo(100_000);
  });

  it("clamps grantor's share at 0 and pulls remainder pro-rata from co-owners", () => {
    const year0 = makeYear(2026, {
      acctA: {
        beginningValue: 100_000,
        endingValue: 70_000,
        growth: 0,
        entries: [
          { category: "gift", label: "Cash gift", amount: -30_000, sourceId: "ent-1" },
        ] as never,
      },
    });
    const gifts: GiftEvent[] = [
      {
        kind: "cash",
        year: 2026,
        amount: 30_000,
        grantor: "spouse",
        recipientEntityId: "ent-1",
        sourceAccountId: "acctA",
        useCrummeyPowers: false,
      },
    ];
    computeFamilyAccountShares({
      years: [year0],
      accountFamilyOwners: new Map([
        [
          "acctA",
          [
            { familyMemberId: "fm-client", percent: 0.8 },
            { familyMemberId: "fm-spouse", percent: 0.2 },
          ],
        ],
      ]),
      clientFamilyMemberId: "fm-client",
      spouseFamilyMemberId: "fm-spouse",
      incomes: [],
      gifts,
      familyMembers: [],
    });

    // BoY: client=80k, spouse=20k. Gift -30k from spouse: spouse goes to 0 (-10k overdraw),
    // remaining 10k pulls from client.
    expect(year0.familyAccountSharesEoY!.get("fm-spouse")!.get("acctA")!).toBeCloseTo(0);
    expect(year0.familyAccountSharesEoY!.get("fm-client")!.get("acctA")!).toBeCloseTo(70_000);
  });
});
