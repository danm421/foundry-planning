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

describe("computeFamilyAccountShares — mixed entity + family ownership", () => {
  it("family shares fill the family pool only (account value minus entity shares)", () => {
    // Account: 70% trust, 15% client, 15% spouse. EoY value 100k. Trust locked share: 70k.
    // Family pool = 30k. With 15/15 family seed → each gets 15k EoY (no flows).
    const year0 = makeYear(2026, {
      acctA: {
        beginningValue: 100_000,
        endingValue: 100_000,
        growth: 0,
        entries: [],
      },
    });
    year0.entityAccountSharesEoY = new Map([["ent-trust", new Map([["acctA", 70_000]])]]);
    computeFamilyAccountShares({
      years: [year0],
      accountFamilyOwners: new Map([
        [
          "acctA",
          [
            { familyMemberId: "fm-client", percent: 0.15 },
            { familyMemberId: "fm-spouse", percent: 0.15 },
          ],
        ],
      ]),
      clientFamilyMemberId: "fm-client",
      spouseFamilyMemberId: "fm-spouse",
      incomes: [],
      gifts: [],
      familyMembers: [],
    });

    const c = year0.familyAccountSharesEoY!.get("fm-client")!.get("acctA")!;
    const s = year0.familyAccountSharesEoY!.get("fm-spouse")!.get("acctA")!;
    expect(c).toBeCloseTo(15_000);
    expect(s).toBeCloseTo(15_000);
    expect(c + s + 70_000).toBeCloseTo(100_000); // full sum invariant
  });

  it("family pool growth tracks (account growth − entity-locked growth) across years", () => {
    // Year 0: account 100k → 105k (5% growth). Entity locks 70k → 73.5k.
    // Family pool: 30k → 31.5k. Family shares should sum to 31.5k, not 35k
    // (which is what naive `ledger.growth × familyShare/total` would yield).
    const year0 = makeYear(2026, {
      acctA: { beginningValue: 100_000, endingValue: 105_000, growth: 5_000, entries: [] },
    });
    year0.entityAccountSharesEoY = new Map([["ent-trust", new Map([["acctA", 73_500]])]]);
    const year1 = makeYear(2027, {
      acctA: { beginningValue: 105_000, endingValue: 110_250, growth: 5_250, entries: [] },
    });
    year1.entityAccountSharesEoY = new Map([["ent-trust", new Map([["acctA", 77_175]])]]);
    computeFamilyAccountShares({
      years: [year0, year1],
      accountFamilyOwners: new Map([
        [
          "acctA",
          [
            { familyMemberId: "fm-client", percent: 0.15 },
            { familyMemberId: "fm-spouse", percent: 0.15 },
          ],
        ],
      ]),
      clientFamilyMemberId: "fm-client",
      spouseFamilyMemberId: "fm-spouse",
      incomes: [],
      gifts: [],
      familyMembers: [],
    });

    // Year 0: family pool EoY = 105k - 73.5k = 31.5k.
    const c0 = year0.familyAccountSharesEoY!.get("fm-client")!.get("acctA")!;
    const s0 = year0.familyAccountSharesEoY!.get("fm-spouse")!.get("acctA")!;
    expect(c0 + s0).toBeCloseTo(31_500);
    expect(c0 + s0 + 73_500).toBeCloseTo(105_000);

    // Year 1: family pool EoY = 110.25k - 77.175k = 33.075k.
    const c1 = year1.familyAccountSharesEoY!.get("fm-client")!.get("acctA")!;
    const s1 = year1.familyAccountSharesEoY!.get("fm-spouse")!.get("acctA")!;
    expect(c1 + s1).toBeCloseTo(33_075);
    expect(c1 + s1 + 77_175).toBeCloseTo(110_250);
  });
});

describe("computeFamilyAccountShares — death event", () => {
  it("survivor absorbs deceased's share at the next BoY", () => {
    // Year 0: drift to client=70%, spouse=30% via 40k client salary into joint
    // 100k account. Year 1: spouse dies during year. Year 2 BoY: client = 100%.
    const year0 = makeYear(2026, {
      acctA: {
        beginningValue: 100_000,
        endingValue: 140_000,
        growth: 0,
        entries: [
          { category: "income", label: "Salary", amount: 40_000, sourceId: "inc-1" },
        ] as never,
      },
    });
    const year1 = makeYear(2027, {
      acctA: {
        beginningValue: 140_000,
        endingValue: 140_000,
        growth: 0,
        entries: [] as never,
      },
    });
    // Engine emits deathTransfers on the year OF death; field is `deceased`
    // ("client" | "spouse") per src/engine/types.ts:73.
    (year1 as { deathTransfers?: Array<{ deceased: "client" | "spouse" }> }).deathTransfers = [
      { deceased: "spouse" },
    ];
    const year2 = makeYear(2028, {
      acctA: {
        beginningValue: 140_000,
        endingValue: 140_000,
        growth: 0,
        entries: [] as never,
      },
    });
    const incomes: Income[] = [
      {
        id: "inc-1",
        type: "salary",
        name: "Salary",
        annualAmount: 40_000,
        startYear: 2026,
        endYear: 2026,
        growthRate: 0,
        owner: "client",
      } as Income,
    ];
    computeFamilyAccountShares({
      years: [year0, year1, year2],
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

    // Year 2 BoY = year 1 EoY → spouse's share absorbed by client.
    expect(year2.familyAccountSharesEoY!.get("fm-client")!.get("acctA")!).toBeCloseTo(140_000);
    expect(year2.familyAccountSharesEoY!.get("fm-spouse")?.get("acctA") ?? 0).toBeCloseTo(0);
  });
});

describe("computeFamilyAccountShares — invariants", () => {
  it("sum of family shares equals account EoY value across years with mixed flows", () => {
    // Year 0: BoY 100k 50/50, +50k client salary, growth 5k → EoY 155k.
    // Year 1: BoY 155k carried, growth 7.75k, withdrawal 30k → EoY 132.75k.
    const year0 = makeYear(2026, {
      acctA: {
        beginningValue: 100_000,
        endingValue: 155_000,
        growth: 5_000,
        entries: [
          { category: "income", label: "Salary", amount: 50_000, sourceId: "inc-1" },
        ] as never,
      },
    });
    const year1 = makeYear(2027, {
      acctA: {
        beginningValue: 155_000,
        endingValue: 132_750,
        growth: 7_750,
        entries: [
          { category: "withdrawal", label: "Household draw", amount: -30_000 },
        ] as never,
      },
    });
    const incomes: Income[] = [
      {
        id: "inc-1",
        type: "salary",
        name: "Salary",
        annualAmount: 50_000,
        startYear: 2026,
        endYear: 2026,
        growthRate: 0,
        owner: "client",
      } as Income,
    ];
    computeFamilyAccountShares({
      years: [year0, year1],
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

    const sumYear = (y: ProjectionYear) =>
      (y.familyAccountSharesEoY?.get("fm-client")?.get("acctA") ?? 0) +
      (y.familyAccountSharesEoY?.get("fm-spouse")?.get("acctA") ?? 0);

    expect(sumYear(year0)).toBeCloseTo(155_000);
    expect(sumYear(year1)).toBeCloseTo(132_750);
  });

  it("pro-rata withdrawals preserve drift built up by attributed deposits", () => {
    // Saving year drives client to 75/25. Retirement year withdraws 20% of the account.
    // Expected: percentages stay ~75/25, not revert to 50/50.
    const year0 = makeYear(2026, {
      acctA: {
        beginningValue: 100_000,
        endingValue: 200_000,
        growth: 0,
        entries: [
          { category: "income", label: "Salary", amount: 100_000, sourceId: "inc-1" },
        ] as never,
      },
    });
    const year1 = makeYear(2027, {
      acctA: {
        beginningValue: 200_000,
        endingValue: 160_000,
        growth: 0,
        entries: [
          { category: "withdrawal", label: "Retirement spend", amount: -40_000 },
        ] as never,
      },
    });
    const incomes: Income[] = [
      {
        id: "inc-1",
        type: "salary",
        name: "Salary",
        annualAmount: 100_000,
        startYear: 2026,
        endYear: 2026,
        growthRate: 0,
        owner: "client",
      } as Income,
    ];
    computeFamilyAccountShares({
      years: [year0, year1],
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

    const c = year1.familyAccountSharesEoY!.get("fm-client")!.get("acctA")!;
    const s = year1.familyAccountSharesEoY!.get("fm-spouse")!.get("acctA")!;
    expect(c / (c + s)).toBeCloseTo(0.75, 2);
    expect(s / (c + s)).toBeCloseTo(0.25, 2);
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
