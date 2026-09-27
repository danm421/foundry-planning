import { describe, it, expect } from "vitest";
import { computeFamilyAccountShares } from "../family-cashflow";
import { runProjection } from "../projection";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE, ownersForYear, type AccountOwner } from "../ownership";
import { resolveOwnerSlices } from "@/lib/estate/account-owner-slices";
import { buildClientData, basePlanSettings, sampleFamilyMembers } from "./fixtures";
import type {
  ProjectionYear, AccountLedger, Income, GiftEvent, Account, ClientData, FamilyMember,
} from "../types";

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

type FamilyOwners = Array<{ familyMemberId: string; percent: number }>;
/** Year-invariant resolver over a fixed owner map — the shape every case
 *  below the asset-gift block was written against. */
function ownersFrom(map: Map<string, FamilyOwners>) {
  return {
    accountFamilyOwnersAt: (id: string) => map.get(id) ?? [],
    candidateAccountIds: [...map.keys()],
  };
}

describe("computeFamilyAccountShares — year-0 init + passive growth", () => {
  it("initializes locked shares from account.value × ownerPercent in year 0", () => {
    const year0 = makeYear(2026, {
      acctA: { beginningValue: 100_000, endingValue: 105_000, growth: 5_000, entries: [] },
    });
    computeFamilyAccountShares({
      years: [year0],
      ...ownersFrom(new Map([
        [
          "acctA",
          [
            { familyMemberId: "fm-client", percent: 0.5 },
            { familyMemberId: "fm-spouse", percent: 0.5 },
          ],
        ],
      ])),
      planStartYear: 2026,
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
      ...ownersFrom(new Map([
        [
          "acctA",
          [
            { familyMemberId: "fm-client", percent: 0.6 },
            { familyMemberId: "fm-spouse", percent: 0.4 },
          ],
        ],
      ])),
      planStartYear: 2026,
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
      ...ownersFrom(new Map([
        [
          "acctA",
          [
            { familyMemberId: "fm-client", percent: 0.5 },
            { familyMemberId: "fm-spouse", percent: 0.5 },
          ],
        ],
      ])),
      planStartYear: 2026,
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
      ...ownersFrom(new Map([
        [
          "acctA",
          [
            { familyMemberId: "fm-client", percent: 0.6 },
            { familyMemberId: "fm-spouse", percent: 0.4 },
          ],
        ],
      ])),
      planStartYear: 2026,
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
      ...ownersFrom(new Map()), // no entries → no ledger
      planStartYear: 2026,
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
      ...ownersFrom(new Map([
        [
          "acctA",
          [
            { familyMemberId: "fm-client", percent: 0.15 },
            { familyMemberId: "fm-spouse", percent: 0.15 },
          ],
        ],
      ])),
      planStartYear: 2026,
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
      ...ownersFrom(new Map([
        [
          "acctA",
          [
            { familyMemberId: "fm-client", percent: 0.15 },
            { familyMemberId: "fm-spouse", percent: 0.15 },
          ],
        ],
      ])),
      planStartYear: 2026,
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
      ...ownersFrom(new Map([
        [
          "acctA",
          [
            { familyMemberId: "fm-client", percent: 0.5 },
            { familyMemberId: "fm-spouse", percent: 0.5 },
          ],
        ],
      ])),
      planStartYear: 2026,
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
      ...ownersFrom(new Map([
        [
          "acctA",
          [
            { familyMemberId: "fm-client", percent: 0.5 },
            { familyMemberId: "fm-spouse", percent: 0.5 },
          ],
        ],
      ])),
      planStartYear: 2026,
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
      ...ownersFrom(new Map([
        [
          "acctA",
          [
            { familyMemberId: "fm-client", percent: 0.5 },
            { familyMemberId: "fm-spouse", percent: 0.5 },
          ],
        ],
      ])),
      planStartYear: 2026,
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
      ...ownersFrom(new Map([
        [
          "acctA",
          [
            { familyMemberId: "fm-client", percent: 0.5 },
            { familyMemberId: "fm-spouse", percent: 0.5 },
          ],
        ],
      ])),
      planStartYear: 2026,
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
      ...ownersFrom(new Map([
        [
          "acctA",
          [
            { familyMemberId: "fm-client", percent: 0.8 },
            { familyMemberId: "fm-spouse", percent: 0.2 },
          ],
        ],
      ])),
      planStartYear: 2026,
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

describe("family account shares — asset gifts", () => {
  /** Flat $1M `acc-1` rows: no growth, no flows. */
  const flatYears = (yrs: number[]) =>
    yrs.map((y) =>
      makeYear(y, {
        "acc-1": { beginningValue: 1_000_000, endingValue: 1_000_000, growth: 0, entries: [] },
      }),
    );
  /** The ownership snapshot's real answer for a joint 50/50 account after a
   *  20% gift to a trust: `composeOwnersForYear` shrinks EVERY household row
   *  proportionally (0.5 → 0.4 each). The ledger — not the percent — is what
   *  says the client funded it. */
  const jointThenGift = (giftYear: number) => (_id: string, year: number) =>
    year >= giftYear
      ? [
          { familyMemberId: "fm-c", percent: 0.4 },
          { familyMemberId: "fm-s", percent: 0.4 },
        ]
      : [
          { familyMemberId: "fm-c", percent: 0.5 },
          { familyMemberId: "fm-s", percent: 0.5 },
        ];
  const trustLock = (years: ProjectionYear[], from: number) => {
    for (const y of years) {
      if (y.year >= from) y.entityAccountSharesEoY = new Map([["trust-1", new Map([["acc-1", 200_000]])]]);
    }
  };
  const base = {
    candidateAccountIds: ["acc-1"],
    planStartYear: 2026,
    clientFamilyMemberId: "fm-c",
    spouseFamilyMemberId: "fm-s",
    incomes: [],
    familyMembers: [],
  };
  const share = (y: ProjectionYear, fm: string) => y.familyAccountSharesEoY?.get(fm)?.get("acc-1");

  it("debits the grantor's share when an asset gift leaves the household", () => {
    // `gifts` was already an input here; every kind !== "cash" event was
    // dropped on the floor, so an asset gift moved no family share at all and
    // the settle step split the post-gift pool 400k/400k.
    const years = flatYears([2026, 2027]);
    trustLock(years, 2027);
    computeFamilyAccountShares({
      ...base,
      years,
      accountFamilyOwnersAt: jointThenGift(2027),
      gifts: [{ kind: "asset", year: 2027, accountId: "acc-1", percent: 0.2,
        grantor: "client", recipientEntityId: "trust-1" }],
    });
    expect(share(years[0], "fm-c")).toBeCloseTo(500_000, 2);
    expect(share(years[0], "fm-s")).toBeCloseTo(500_000, 2);
    // The client funded the whole gift: 500k → 300k of a $1M account.
    expect(share(years[1], "fm-c")).toBeCloseTo(300_000, 2);
    expect(share(years[1], "fm-s")).toBeCloseTo(500_000, 2);
  });

  it("debits the grantor for a gift in the plan's first year (the seed is pre-gift)", () => {
    // In the first year there is no carry: the shares are SEEDED. The resolver
    // already answers post-gift (0.4/0.4) for that year, so seeding from it and
    // then debiting would take the gift twice (200k/400k → 267k/533k).
    const years = flatYears([2026, 2027]);
    trustLock(years, 2026);
    computeFamilyAccountShares({
      ...base,
      years,
      accountFamilyOwnersAt: jointThenGift(2026),
      gifts: [{ kind: "asset", year: 2026, accountId: "acc-1", percent: 0.2,
        grantor: "client", recipientEntityId: "trust-1" }],
    });
    for (const y of years) {
      expect(share(y, "fm-c")).toBeCloseTo(300_000, 2);
      expect(share(y, "fm-s")).toBeCloseTo(500_000, 2);
    }
  });

  it("leaves family shares alone for a gift dated before planStartYear", () => {
    // Review Focus #3 — the ownership snapshot treats a pre-plan gift as
    // already inside the authored owners and never moves them for it. The
    // debit index mirrors the snapshot's window (skip < planStartYear, clamp
    // the rest to the first projected year), so without the guard this gift
    // would clamp into 2026 and debit the client a second time.
    const years = flatYears([2026, 2027]);
    computeFamilyAccountShares({
      ...base,
      years,
      accountFamilyOwnersAt: () => [
        { familyMemberId: "fm-c", percent: 0.5 },
        { familyMemberId: "fm-s", percent: 0.5 },
      ],
      gifts: [{ kind: "asset", year: 2024, accountId: "acc-1", percent: 0.2,
        grantor: "client", recipientEntityId: "trust-1" }],
    });
    for (const y of years) {
      expect(share(y, "fm-c")).toBeCloseTo(500_000, 2);
      expect(share(y, "fm-s")).toBeCloseTo(500_000, 2);
    }
  });

  it("still attributes a cash gift to its grantor (the pre-existing behavior)", () => {
    const years = [
      makeYear(2026, { "acc-1": { beginningValue: 1_000_000, endingValue: 1_000_000, growth: 0, entries: [] } }),
      makeYear(2027, { "acc-1": { beginningValue: 1_000_000, endingValue: 900_000, growth: 0, entries: [] } }),
    ];
    computeFamilyAccountShares({
      ...base,
      years,
      accountFamilyOwnersAt: () => [
        { familyMemberId: "fm-c", percent: 0.5 },
        { familyMemberId: "fm-s", percent: 0.5 },
      ],
      gifts: [{ kind: "cash", year: 2027, amount: 100_000, grantor: "client",
        sourceAccountId: "acc-1", useCrummeyPowers: false }],
    });
    expect(share(years[1], "fm-c")).toBeCloseTo(400_000, 2);
    expect(share(years[1], "fm-s")).toBeCloseTo(500_000, 2);
  });
});

// ── Integration: runProjection wires computeFamilyAccountShares ──────────────

describe("family account shares via runProjection — asset gifts", () => {
  const FM_KID = "fm-kid";
  const joint = (owners?: Account["owners"]): Account => ({
    id: "acc-joint",
    name: "Joint Brokerage",
    category: "taxable",
    subType: "brokerage",
    titlingType: "jtwros",
    value: 1_000_000,
    basis: 1_000_000,
    growthRate: 0,
    rmdEnabled: false,
    owners: owners ?? [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
      { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
    ],
  });
  /** Married household, one flat $1M account, no income, no expenses, no tax:
   *  only the gift can move a share. */
  const scenario = (account: Account, giftEvents: GiftEvent[]): ClientData =>
    buildClientData({
      accounts: [account],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, flatFederalRate: 0, flatStateRate: 0, planEndYear: 2028 },
      familyMembers: [
        ...sampleFamilyMembers,
        { id: FM_KID, role: "other", relationship: "child", firstName: "Kid",
          lastName: "Smith", dateOfBirth: "2000-01-01" } as FamilyMember,
      ],
      entities: [{ id: "t-gift", name: "Gift Trust", includeInPortfolio: false, isGrantor: false,
        entityType: "trust", isIrrevocable: true, grantor: "client" }],
      giftEvents,
    });
  const giftOf = (recipient: Partial<Extract<GiftEvent, { kind: "asset" }>>): GiftEvent => ({
    kind: "asset", year: 2027, accountId: "acc-joint", percent: 0.2, grantor: "client", ...recipient,
  });
  const fmShare = (y: ProjectionYear, fm: string) =>
    y.familyAccountSharesEoY?.get(fm)?.get("acc-joint");
  /** What the balance sheet shows: gift-aware owners through the locked shares. */
  const slices = (data: ClientData, y: ProjectionYear) =>
    resolveOwnerSlices(
      "acc-joint",
      ownersForYear(data.accounts[0], data.giftEvents ?? [], y.year, 2026),
      y.accountLedgers["acc-joint"].endingValue,
      y.entityAccountSharesEoY,
      y.familyAccountSharesEoY,
    );
  const sliceOf = (s: ReturnType<typeof slices>, pick: (o: AccountOwner) => boolean) =>
    s.filter((x) => pick(x.owner)).reduce((t, x) => t + x.value, 0);
  const fm = (id: string) => (o: AccountOwner) => o.kind === "family_member" && o.familyMemberId === id;
  const awayTo = (id: string) => (o: AccountOwner) => o.kind === "gifted_away" && o.recipient.id === id;

  it("debits the client's share when the client gifts 20% of a joint account to a trust", () => {
    // WIRING PIN: the unit cases stub the resolver and hand `gifts` in directly.
    const data = scenario(joint(), [giftOf({ recipientEntityId: "t-gift" })]);
    const [y2026, y2027, y2028] = runProjection(data);
    expect(fmShare(y2026, LEGACY_FM_CLIENT)).toBeCloseTo(500_000, 2);
    expect(fmShare(y2026, LEGACY_FM_SPOUSE)).toBeCloseTo(500_000, 2);
    for (const y of [y2027, y2028]) {
      const c = fmShare(y, LEGACY_FM_CLIENT)!;
      const s = fmShare(y, LEGACY_FM_SPOUSE)!;
      const trust = y.entityAccountSharesEoY?.get("t-gift")?.get("acc-joint") ?? 0;
      expect(c).toBeCloseTo(300_000, 2);
      expect(s).toBeCloseTo(500_000, 2);
      expect(trust).toBeCloseTo(200_000, 2);
      expect(c + s + trust).toBeCloseTo(y.accountLedgers["acc-joint"].endingValue, 2);
    }
  });

  it("grows and debits the post-gift shares, not the authored ones", () => {
    // WIRING PIN for the per-year resolver. With 10% growth the family pool's
    // share of growth is BoY × Σ family percents — 80% after the gift, not the
    // authored 100% — and a same-year cash gift the client funds is one-sided,
    // so an overstated growth credit leaves a different split behind.
    //   2026: 500k/500k → 550k/550k
    //   2027: BoY 1.1M; asset gift 220k from client → 330k/550k; growth 88k
    //         pro-rata → 363k/605k; cash gift 100k from client → 263k/605k.
    //         Trust locked 220k + 22k = 242k. Account 1.11M.
    const data = scenario(
      { ...joint(), growthRate: 0.1 },
      [
        giftOf({ recipientEntityId: "t-gift" }),
        { kind: "cash", year: 2027, amount: 100_000, grantor: "client",
          sourceAccountId: "acc-joint", recipientFamilyMemberId: FM_KID, useCrummeyPowers: false },
      ],
    );
    const y2027 = runProjection(data)[1];
    const trust = y2027.entityAccountSharesEoY?.get("t-gift")?.get("acc-joint") ?? 0;
    expect(y2027.accountLedgers["acc-joint"].endingValue).toBeCloseTo(1_110_000, 2);
    expect(trust).toBeCloseTo(242_000, 2);
    expect(fmShare(y2027, LEGACY_FM_CLIENT)).toBeCloseTo(263_000, 2);
    expect(fmShare(y2027, LEGACY_FM_SPOUSE)).toBeCloseTo(605_000, 2);
  });

  it("a gift to a child who is not an owner leaves the child's share gifted away, not re-absorbed", () => {
    // A gift to a person becomes a `gifted_away` owner row, never a
    // family_member one, so the recipient has no ledger to credit. The
    // balance sheet subtracts the gifted-away slice from the family pool; the
    // ledger decides who that pool belongs to.
    const data = scenario(joint(), [giftOf({ recipientFamilyMemberId: FM_KID })]);
    const y2027 = runProjection(data)[1];
    const s = slices(data, y2027);
    expect(sliceOf(s, fm(LEGACY_FM_CLIENT))).toBeCloseTo(300_000, 2);
    expect(sliceOf(s, fm(LEGACY_FM_SPOUSE))).toBeCloseTo(500_000, 2);
    expect(sliceOf(s, awayTo(FM_KID))).toBeCloseTo(200_000, 2);
    expect(sliceOf(s, () => true)).toBeCloseTo(1_000_000, 2);
  });

  it("a gift to a child who already co-owns the account is not counted twice", () => {
    // Authored 40/40/20. The child keeps its own 200k AND receives 200k as a
    // gifted-away slice. Crediting the child's ledger as well would book the
    // gift twice (the child would show 520k of a $1M account).
    const data = scenario(
      joint([
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.4 },
        { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.4 },
        { kind: "family_member", familyMemberId: FM_KID, percent: 0.2 },
      ]),
      [giftOf({ recipientFamilyMemberId: FM_KID })],
    );
    const y2027 = runProjection(data)[1];
    const s = slices(data, y2027);
    expect(sliceOf(s, fm(LEGACY_FM_CLIENT))).toBeCloseTo(200_000, 2);
    expect(sliceOf(s, fm(LEGACY_FM_SPOUSE))).toBeCloseTo(400_000, 2);
    expect(sliceOf(s, fm(FM_KID))).toBeCloseTo(200_000, 2);
    expect(sliceOf(s, awayTo(FM_KID))).toBeCloseTo(200_000, 2);
    expect(sliceOf(s, () => true)).toBeCloseTo(1_000_000, 2);
  });
});
