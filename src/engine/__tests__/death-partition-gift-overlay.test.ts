// A death partition CONSUMES the asset gifts it routed around.
//
// The precedence chain peels a gifted slice off an account at a death and
// routes only the family pool — which keeps the ORIGINAL account id, with its
// value shrunk by the slice. Every gift-aware reader resolves the overlay by
// that id, so without a marker the pool is gifted a second time: the survivor
// could spend $400k of a $700k pool, and the hypothetical estate tax lost the
// same $300k from the gift year on — before anyone had died.
//
// The existing engine and estate suites stayed green on that double
// subtraction. These cases are the only ones that can see it: they read the
// surfaces the rebuilt pool flows into (the withdraw cap through real
// spending, the portfolio snapshot, the hypothetical and real final deaths).
//
// One $1M account, growth 0, a 30% gift in 2027, the client dies in 2029, so
// every number below is a round figure only the gift can explain.

import { describe, it, expect, vi } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";
import type {
  Account,
  AssetTransaction,
  EntitySummary,
  Expense,
  FamilyMember,
  GiftEvent,
  GrossEstateLine,
  Liability,
  ProjectionYear,
  Will,
} from "../types";

const ACC = "acct-x";
const TRUST = "trust-1";
const KID = "kid-a";

const FAMILY: FamilyMember[] = [
  { id: LEGACY_FM_CLIENT, role: "client", relationship: "other",
    firstName: "Client", lastName: "Test", dateOfBirth: "1960-01-01" },
  { id: LEGACY_FM_SPOUSE, role: "spouse", relationship: "other",
    firstName: "Spouse", lastName: "Test", dateOfBirth: "1972-06-15" },
  { id: KID, role: "child", relationship: "child",
    firstName: "Kid", lastName: "Test", dateOfBirth: "1995-01-01" },
];

const trust: EntitySummary = {
  id: TRUST, name: "Trust One", entityType: "trust", trustSubType: "irrevocable",
  isIrrevocable: true, isGrantor: false, includeInPortfolio: false,
  accessibleToClient: false, grantor: "client",
};

const toTrust = (year: number, percent: number, grantor: "client" | "spouse" = "client"): GiftEvent => ({
  kind: "asset", year, accountId: ACC, percent, grantor, recipientEntityId: TRUST,
});
const toKid = (year: number, percent: number): GiftEvent => ({
  kind: "asset", year, accountId: ACC, percent, grantor: "client", recipientFamilyMemberId: KID,
});

const CLIENT_ONLY: Account["owners"] = [
  { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 },
];
const JOINT: Account["owners"] = [
  { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
  { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
];

/** Client dies 2029 (1960 + 69). The spouse dies 2031 when `spouseDies`, else
 *  outlives the horizon. `needs` are one-year living expenses drawn from the
 *  gifted account — the only way to observe the household withdraw cap.
 *  `owners` defaults to the CLIENT ALONE; pass `JOINT` for a joint account. */
function plan(opts: {
  gifts: GiftEvent[];
  owners?: Account["owners"];
  spouseDies?: boolean;
  endYear?: number;
  needs?: Array<{ year: number; amount: number }>;
  estateAdminExpenses?: number;
  wills?: Will[];
  assetTransactions?: AssetTransaction[];
}) {
  const endYear = opts.endYear ?? 2033;
  const acct: Account = {
    id: ACC, name: "Brokerage", category: "taxable", subType: "brokerage",
    // Required by the type, read only for a JOINT account (half vs full
    // step-up). The owners decide jointness — `CLIENT_ONLY` is not joint.
    titlingType: "jtwros",
    value: 1_000_000, basis: 400_000, growthRate: 0, rmdEnabled: false,
    owners: opts.owners ?? CLIENT_ONLY,
  };
  const checking: Account = {
    id: "acct-checking", name: "Checking", category: "cash", subType: "checking",
    titlingType: "jtwros", value: 1000, basis: 1000, growthRate: 0,
    rmdEnabled: false, isDefaultChecking: true,
    owners: [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
      { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
    ],
  };
  const expenses: Expense[] = (opts.needs ?? []).map((n, i) => ({
    id: `need-${i}`, name: "Living", type: "living", annualAmount: n.amount,
    growthRate: 0, startYear: n.year, endYear: n.year,
  }));
  return buildClientData({
    client: { ...baseClient, dateOfBirth: "1960-01-01", spouseDob: "1972-06-15",
      lifeExpectancy: 69, spouseLifeExpectancy: opts.spouseDies ? 59 : 95 },
    familyMembers: FAMILY, accounts: [checking, acct], entities: [trust],
    incomes: [], liabilities: [], savingsRules: [], expenses,
    withdrawalStrategy: [{ accountId: ACC, priorityOrder: 1, startYear: 2026, endYear }],
    giftEvents: opts.gifts,
    wills: opts.wills ?? [],
    assetTransactions: opts.assetTransactions ?? [],
    planSettings: { ...basePlanSettings, flatFederalRate: 0, flatStateRate: 0,
      planStartYear: 2026, planEndYear: endYear,
      estateAdminExpenses: opts.estateAdminExpenses ?? 0 },
  });
}

const at = (years: ProjectionYear[], year: number) => {
  const y = years.find((r) => r.year === year);
  if (!y) throw new Error(`no projection row for ${year}`);
  return y;
};

/** Dollars the given death routed OUT of `acct-x` (the precedence-chain ledger). */
const routedFrom = (y: ProjectionYear, deathOrder: 1 | 2) =>
  (y.deathTransfers ?? [])
    .filter((t) => t.deathOrder === deathOrder && t.sourceAccountId === ACC)
    .reduce((s, t) => s + t.amount, 0);

const estateLine = (y: ProjectionYear) =>
  y.estateTax?.grossEstateLines.find((l) => l.accountId === ACC)?.amount ?? 0;

describe("death partition — a 30% trust gift is taken out of the pool ONCE", () => {
  it("routes only the 700k family pool at the first death, and peels the trust's 300k into its own slice", () => {
    const years = runProjection(plan({ gifts: [toTrust(2027, 0.3)] }));
    expect(routedFrom(at(years, 2029), 1)).toBeCloseTo(700_000, 2);
    const y2030 = at(years, 2030);
    expect(y2030.accountLedgers[ACC].endingValue).toBeCloseTo(700_000, 2);
    const slices = Object.entries(y2030.accountLedgers).filter(([id]) => id.startsWith("entity-slice"));
    expect(slices).toHaveLength(1);
    expect(slices[0][1].endingValue).toBeCloseTo(300_000, 2);
  });

  it("lets the survivor spend the WHOLE 700k pool the year after the death", () => {
    // $800k need in 2030. Re-gifting the pool capped the household at
    // min(700k × 0.7, 700k − the stale 300k lock) = 400k → checking −399,000.
    const years = runProjection(plan({ gifts: [toTrust(2027, 0.3)],
      endYear: 2031, needs: [{ year: 2030, amount: 800_000 }] }));
    const y2030 = at(years, 2030);
    expect(y2030.accountLedgers[ACC].endingValue).toBeCloseTo(0, 2);
    expect(y2030.accountLedgers["acct-checking"].endingValue).toBeCloseTo(-99_000, 2);
  });

  it("shows the pool as 700k household and the trust at its 300k slice on the portfolio", () => {
    // Re-gifted: 490k household / 510k trust (the slice PLUS 30% of the pool).
    const years = runProjection(plan({ gifts: [toTrust(2027, 0.3)] }));
    for (const year of [2029, 2030, 2033]) {
      const pa = at(years, year).portfolioAssets;
      expect(pa.taxable[ACC]).toBeCloseTo(700_000, 2);
      expect(pa.trustsAndBusinessesTotal).toBeCloseTo(300_000, 2);
    }
  });

  it("keeps the 700k pool in the hypothetical survivor's estate from the GIFT year on", () => {
    // The hypothetical runs both deaths inside one year. Its final death saw
    // the first death's pool re-gifted and partitioned it again: 400k, in every
    // year from 2027 — two years before anyone actually dies.
    const years = runProjection(plan({ gifts: [toTrust(2027, 0.3)] }));
    for (const year of [2027, 2028, 2030]) {
      const finalDeath = at(years, year).hypotheticalEstateTax.primaryFirst.finalDeath;
      const line = finalDeath?.grossEstateLines.find((l) => l.accountId === ACC);
      expect(line?.amount).toBeCloseTo(700_000, 2);
    }
  });

  it("routes the 700k pool once at the survivor's death — no second partition", () => {
    const years = runProjection(plan({ gifts: [toTrust(2027, 0.3)], spouseDies: true }));
    const y2031 = at(years, 2031);
    expect(y2031.estateTax?.deathOrder).toBe(2);
    // Re-gifted: gross line 400k and a SECOND 300k slice peeled off the pool.
    expect(estateLine(y2031)).toBeCloseTo(700_000, 2);
    expect(routedFrom(y2031, 2)).toBeCloseTo(700_000, 2);
  });
});

describe("death partition — a 30% gift to a PERSON", () => {
  it("leaves the survivor the whole 700k pool to spend", () => {
    // Re-gifted: the household share of the pool is 0.7 → cap 490k → −309,000.
    const years = runProjection(plan({ gifts: [toKid(2027, 0.3)],
      endYear: 2031, needs: [{ year: 2030, amount: 800_000 }] }));
    const y2030 = at(years, 2030);
    expect(y2030.accountLedgers[ACC].endingValue).toBeCloseTo(0, 2);
    expect(y2030.accountLedgers["acct-checking"].endingValue).toBeCloseTo(-99_000, 2);
  });

  it("puts the whole 700k pool in the survivor's gross estate and routes it once", () => {
    const years = runProjection(plan({ gifts: [toKid(2027, 0.3)], spouseDies: true }));
    expect(routedFrom(at(years, 2029), 1)).toBeCloseTo(700_000, 2);
    const y2031 = at(years, 2031);
    expect(estateLine(y2031)).toBeCloseTo(700_000, 2);
    expect(routedFrom(y2031, 2)).toBeCloseTo(700_000, 2);
  });
});

describe("death partition — a 100%-gifted account", () => {
  // Nothing of the decedent's is left in it. The briefed gate partitions only
  // when the resolved owners hold BOTH a gifted slice and a family row, so a
  // wholly gifted account fell through and the chain routed the authored
  // $1M — while the gross estate, reading the same overlay, showed $0.
  for (const [label, gift] of [
    ["to a child", toKid(2027, 1)],
    ["to a trust", toTrust(2027, 1)],
  ] as const) {
    it(`routes $0 at both deaths when gifted ${label}, and does not throw`, () => {
      const years = runProjection(plan({ gifts: [gift], spouseDies: true }));
      const y2029 = at(years, 2029);
      expect(y2029.estateTax?.deathOrder).toBe(1);
      expect(routedFrom(y2029, 1)).toBe(0);
      expect(estateLine(y2029)).toBe(0);
      const y2031 = at(years, 2031);
      expect(routedFrom(y2031, 2)).toBe(0);
      expect(estateLine(y2031)).toBe(0);
      // The account is untouched by the deaths: whole, and still the gift's.
      expect(y2031.accountLedgers[ACC].endingValue).toBeCloseTo(1_000_000, 2);
    });
  }
});

describe("death partition — a gift of the pool AFTER the death still lands", () => {
  it("locks a fresh 20% slice of the pool, not the pre-death 300k carry", () => {
    // The spouse gives 20% of the pool (700k) to the same trust in 2031, with
    // $800k needs in 2031 and 2032. The trust's new slice is 140k:
    //   2031 cap = min(700k × 0.8, 700k − 140k) = 560k → pool 140k
    //   2032 cap = min(140k × 0.8, 140k − 140k) = 0     → pool holds 140k
    // A carry left over from before the death locks 300k (cap 400k → pool
    // 300k); a snapshot that forgets the post-death gift never locks it, and
    // the pool decays to 28k the following year.
    const years = runProjection(plan({
      gifts: [toTrust(2027, 0.3), toTrust(2031, 0.2, "spouse")],
      endYear: 2032,
      needs: [{ year: 2031, amount: 800_000 }, { year: 2032, amount: 800_000 }],
    }));
    expect(at(years, 2031).accountLedgers[ACC].endingValue).toBeCloseTo(140_000, 2);
    expect(at(years, 2032).accountLedgers[ACC].endingValue).toBeCloseTo(140_000, 2);
  });
});

describe("death partition — a gift dated IN the death year is already in the pool", () => {
  it("does not take a death-year gift out of the pool again (≤, not <)", () => {
    // The 30% gift lands in 2029, the year the client dies. The partition
    // resolves owners through 2029 inclusive, so the pool (700k) is already
    // net of it; the marker must skip it too. Skipping only gifts BEFORE 2029
    // re-applies it: cap min(700k × 0.7, 700k − 210k) = 490k → −309,000.
    const years = runProjection(plan({ gifts: [toTrust(2029, 0.3)],
      endYear: 2031, needs: [{ year: 2030, amount: 800_000 }] }));
    expect(routedFrom(at(years, 2029), 1)).toBeCloseTo(700_000, 2);
    const y2030 = at(years, 2030);
    expect(y2030.accountLedgers[ACC].endingValue).toBeCloseTo(0, 2);
    expect(y2030.accountLedgers["acct-checking"].endingValue).toBeCloseTo(-99_000, 2);
  });
});

describe("death partition — a fully gifted JOINT account", () => {
  // A joint account the household gave away entirely. Nothing of either
  // spouse's is left in it, so neither death may route it — and the account
  // must not look joint to the final death's "no joint accounts survive the
  // first death" check. The hypothetical estate tax runs BOTH deaths in every
  // year, so that check fires from the gift year even when the spouse
  // outlives the plan.
  const cases = [
    ["100% to a trust", [toTrust(2027, 1)]],
    ["100% to a child", [toKid(2027, 1)]],
    ["gift-split: each spouse gives half to the trust", [toTrust(2027, 0.5, "client"), toTrust(2027, 0.5, "spouse")]],
  ] as const;

  for (const [label, gifts] of cases) {
    it(`${label}: runs to the survivor's death and routes $0 at both deaths`, () => {
      const years = runProjection(plan({ owners: JOINT, gifts: [...gifts], spouseDies: true }));
      const y2029 = at(years, 2029);
      expect(y2029.estateTax?.deathOrder).toBe(1);
      expect(routedFrom(y2029, 1)).toBe(0);
      const y2031 = at(years, 2031);
      expect(y2031.estateTax?.deathOrder).toBe(2);
      expect(routedFrom(y2031, 2)).toBe(0);
      expect(y2031.accountLedgers[ACC].endingValue).toBeCloseTo(1_000_000, 2);
    });

    it(`${label}: runs when the spouse outlives the plan, and the hypothetical routes $0`, () => {
      const years = runProjection(plan({ owners: JOINT, gifts: [...gifts] }));
      expect(routedFrom(at(years, 2029), 1)).toBe(0);
      for (const year of [2027, 2030]) {
        const hyp = at(years, year).hypotheticalEstateTax.primaryFirst;
        const hypRouted = [...hyp.firstDeathTransfers, ...(hyp.finalDeathTransfers ?? [])]
          .filter((t) => t.sourceAccountId === ACC)
          .reduce((s, t) => s + t.amount, 0);
        expect(hypRouted).toBe(0);
      }
    });
  }
});

describe("death partition — a wholly gifted account that ALSO has an authored trust row", () => {
  // Authored 70% client / 30% trust; the client gives their whole 70% to the
  // child in 2027, so nothing of the household is left: 30% trust, 70% child.
  // The first death moves only the decedent's own authored row to the
  // survivor. Replacing EVERY row with the survivor erased the trust's row,
  // and the overlay then resolved the account to 30% spouse / 70% child —
  // the survivor spent the trust's money and was taxed on it.
  const MIXED: Account["owners"] = [
    { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.7 },
    { kind: "entity", entityId: TRUST, percent: 0.3 },
  ];

  it("gives the survivor none of the trust's 30% to spend", () => {
    // $400k need in 2030: with the trust's row erased the survivor drew its
    // $300k (checking −99,000).
    const years = runProjection(plan({ owners: MIXED, gifts: [toKid(2027, 0.7)],
      endYear: 2031, needs: [{ year: 2030, amount: 400_000 }] }));
    const y2030 = at(years, 2030);
    expect(y2030.accountLedgers[ACC].endingValue).toBeCloseTo(1_000_000, 2);
    expect(y2030.accountLedgers["acct-checking"].endingValue).toBeCloseTo(-399_000, 2);
  });

  it("keeps it out of the survivor's estate — hypothetical and real", () => {
    const years = runProjection(plan({ owners: MIXED, gifts: [toKid(2027, 0.7)], spouseDies: true }));
    // The hypothetical runs both deaths in 2028; the erased row put 300k of the
    // trust's share in the survivor's estate.
    const hypLine = at(years, 2028).hypotheticalEstateTax.primaryFirst.finalDeath
      ?.grossEstateLines.find((l) => l.accountId === ACC);
    expect(hypLine?.amount ?? 0).toBe(0);
    expect(routedFrom(at(years, 2029), 1)).toBe(0);
    const y2031 = at(years, 2031);
    expect(estateLine(y2031)).toBe(0);
    expect(routedFrom(y2031, 2)).toBe(0);
  });
});

describe("death partition — a fully gifted joint account with no spouse family member", () => {
  // Legacy shape: the plan has a spouse (so there are two deaths) but
  // `familyMembers` names no spouse — or nobody at all. There is no survivor
  // to retitle to, so the account reaches the final death with its authored
  // JOINT rows, and only the pre-check's wholly-gifted exemption stops the
  // "no joint accounts survive the first death" throw.
  const shapes = [
    ["no spouse entry", FAMILY.filter((f) => f.role !== "spouse")],
    ["no family members at all", [] as FamilyMember[]],
  ] as const;
  for (const [label, familyMembers] of shapes) {
    it(`${label}: runs to the final death and routes $0`, () => {
      const data = plan({ owners: JOINT, gifts: [toTrust(2027, 1)], spouseDies: true });
      data.familyMembers = [...familyMembers];
      const years = runProjection(data);
      expect(at(years, 2031).estateTax?.deathOrder).toBe(2);
      expect(routedFrom(at(years, 2029), 1)).toBe(0);
      expect(routedFrom(at(years, 2031), 2)).toBe(0);
    });
  }
});

describe("death partition — estate costs are not paid out of a fully gifted account", () => {
  it("leaves a 100%-gifted account whole when the first death owes $50k of admin expenses", () => {
    // The skip leaves the account's AUTHORED rows naming the decedent, and the
    // estate drain read them: it took the $50k from the child's account.
    const years = runProjection(plan({ gifts: [toKid(2027, 1)], estateAdminExpenses: 50_000 }));
    expect(at(years, 2029).estateTax?.estateAdminExpenses).toBeCloseTo(50_000, 2);
    expect(at(years, 2030).accountLedgers[ACC].endingValue).toBeCloseTo(1_000_000, 2);
  });

  it("leaves it whole in a single filer's hypothetical death, where there is no survivor to retitle it to", () => {
    // A single filer's hypothetical estate tax runs the FIRST-death pipeline
    // with no survivor, so the account keeps its authored rows (naming the
    // decedent) and only the drain's own wholly-gifted check keeps the $50k
    // off it.
    const data = plan({ gifts: [toKid(2027, 1)], estateAdminExpenses: 50_000, endYear: 2028 });
    data.client = { ...data.client, filingStatus: "single", spouseDob: undefined,
      spouseLifeExpectancy: undefined, lifeExpectancy: 95 };
    data.familyMembers = FAMILY.filter((f) => f.role !== "spouse");
    const hyp = at(runProjection(data), 2028).hypotheticalEstateTax.primaryFirst;
    expect(hyp.firstDeath.estateAdminExpenses).toBeCloseTo(50_000, 2);
    expect(hyp.firstDeath.estateTaxDebits.some((d) => d.accountId === ACC)).toBe(false);
  });

  it("leaves it whole at the survivor's death too, when the survivor made the gift", () => {
    // The spouse's own account, 100% given to the child in 2027. The final
    // death drains its costs BEFORE the chain, from the authored rows — which
    // still name the spouse.
    const spouseOnly: Account["owners"] = [
      { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 },
    ];
    const years = runProjection(plan({
      owners: spouseOnly, spouseDies: true, estateAdminExpenses: 50_000,
      gifts: [{ kind: "asset", year: 2027, accountId: ACC, percent: 1,
        grantor: "spouse", recipientFamilyMemberId: KID }],
    }));
    const y2031 = at(years, 2031);
    expect(y2031.estateTax?.deathOrder).toBe(2);
    expect(y2031.estateTax?.estateTaxDebits.some((d) => d.accountId === ACC)).toBe(false);
  });
});

describe("death partition — a wholly gifted IRA after its owner's death", () => {
  // The chain routes nothing out of a wholly gifted account, but it still
  // retitles its AUTHORED rows to the survivor: the readers that ask WHICH
  // principal owns an account read authored rows, and left naming the dead
  // client they sized the IRA's RMD on the dead client's age (18,791 in 2030)
  // and drew it on the dead client's IRA basis pool.
  //
  // (Why not retitle the rows to the resolved `gifted_away` owner instead?
  // Every authored reader would then see an owner that is neither a family
  // member nor an entity, and the RMD block throws "must have a single owner"
  // the first year an RMD falls due. A gift of an IRA is not legal, but
  // nothing stops one being entered.)
  const giftedIra = (spouseDob: string, basis = 0) => {
    const ira: Account = {
      id: "ira", name: "IRA", category: "retirement", subType: "traditional_ira",
      titlingType: "jtwros", value: 500_000, basis, growthRate: 0, rmdEnabled: true,
      owners: CLIENT_ONLY,
    };
    const data = plan({ gifts: [] });
    // Client b.1955 dies in 2029 at 74 — already at RMD age.
    data.client = { ...data.client, dateOfBirth: "1955-01-01", lifeExpectancy: 74,
      spouseDob, spouseLifeExpectancy: 95 };
    data.familyMembers = FAMILY.map((f) =>
      f.role === "client" ? { ...f, dateOfBirth: "1955-01-01" }
        : f.role === "spouse" ? { ...f, dateOfBirth: spouseDob } : f);
    data.accounts = [...data.accounts, ira];
    data.giftEvents = [{ kind: "asset", year: 2027, accountId: "ira", percent: 1,
      grantor: "client", recipientFamilyMemberId: KID }];
    return runProjection(data);
  };

  it("takes no RMD on the survivor's behalf, routes nothing, and stays the child's", () => {
    // Spouse b.1958 is 72 in 2030 — under RMD age.
    const years = giftedIra("1958-01-01");
    const y2029 = at(years, 2029);
    expect(y2029.estateTax?.deathOrder).toBe(1);
    expect((y2029.deathTransfers ?? []).filter((t) => t.sourceAccountId === "ira")).toHaveLength(0);
    const y2030 = at(years, 2030);
    expect(y2030.accountLedgers["ira"].rmdAmount ?? 0).toBe(0);
    // Still wholly the child's: off the household portfolio, and out of the
    // survivor's hypothetical estate.
    expect(y2030.portfolioAssets.retirement["ira"]).toBeUndefined();
    const survivorDeath = y2030.hypotheticalEstateTax.primaryFirst.finalDeath;
    expect(survivorDeath?.grossEstateLines.some((l) => l.accountId === "ira")).toBe(false);
    expect(at(years, 2033).accountLedgers["ira"]).toBeDefined();
  });

  it("draws a later RMD on the SURVIVOR's IRA basis pool, not the dead client's", () => {
    // Spouse b.1950 is 80 in 2030, so an RMD falls due either way. The IRA
    // carries $100k of post-tax basis in the CLIENT's §408(d)(2) pool; the
    // spouse has none. Attributed to the survivor, the RMD returns no basis
    // and is sized on the spouse's age.
    const years = giftedIra("1950-01-01", 100_000);
    const rmd = at(years, 2030).accountLedgers["ira"].entries.find((e) => e.category === "rmd");
    expect(rmd).toBeDefined();
    expect(rmd!.label).toBe("RMD distribution (age 80)");
    expect(rmd!.basis).toBe(0);
  });
});

/** The client's will: everything to the spouse and the kid, half each — so the
 *  first death SPLITS what it routes into two new accounts. */
const SPLIT_WILL: Will = {
  id: "will-c", grantor: "client",
  bequests: [{
    id: "beq", name: "Split", kind: "asset", assetMode: "all_assets",
    accountId: null, liabilityId: null, entityId: null,
    percentage: 100, condition: "always", sortOrder: 0,
    recipients: [
      { recipientKind: "spouse", recipientId: null, percentage: 50, sortOrder: 0 },
      { recipientKind: "family_member", recipientId: KID, percentage: 50, sortOrder: 1 },
    ],
  }],
} as unknown as Will;

describe("death partition — the projection publishes the ownership each ledger was booked under", () => {
  it("publishes the pre-death owners in the death year, then the marked pool and its slice", () => {
    const years = runProjection(plan({ gifts: [toTrust(2027, 0.3)] }));

    // Death year: the ledgers are pre-death, and so is the published ownership.
    const y2029 = at(years, 2029).accountOwners!;
    expect(y2029.get(ACC)!.owners).toEqual([
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: expect.closeTo(0.7, 9) },
      { kind: "entity", entityId: TRUST, percent: expect.closeTo(0.3, 9) },
    ]);
    expect(y2029.get(ACC)!.giftsReflectedThrough).toBeUndefined();
    expect([...y2029.keys()].some((id) => id.startsWith("entity-slice"))).toBe(false);

    // After it: the pool under the original id, already net of the gift…
    const y2030 = at(years, 2030).accountOwners!;
    expect(y2030.get(ACC)).toEqual({
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }],
      giftsReflectedThrough: 2029,
    });
    // …and the trust's 300k as its own 100% account, tagged with its origin.
    const slices = [...y2030].filter(([id]) => id.startsWith("entity-slice"));
    expect(slices).toHaveLength(1);
    expect(slices[0][1]).toEqual({
      owners: [{ kind: "entity", entityId: TRUST, percent: 1 }],
      sliceOf: ACC,
    });
    expect(at(years, 2030).accountLedgers[slices[0][0]].endingValue).toBeCloseTo(300_000, 2);
  });

  it("tags a will's split of a partitioned pool with the account it came from — and leaves a plain split untagged", () => {
    const gifted = runProjection(plan({ gifts: [toTrust(2027, 0.3)], wills: [SPLIT_WILL] }));
    const shares = [...at(gifted, 2030).accountOwners!].filter(([id]) => id.startsWith("death-acct"));
    // The checking account is not partitioned — its split is not tagged.
    const tagged = shares.filter(([, rec]) => rec.sliceOf === ACC);
    expect(tagged).toHaveLength(2);
    const ledgers = at(gifted, 2030).accountLedgers;
    expect(tagged.reduce((s, [id]) => s + ledgers[id].endingValue, 0)).toBeCloseTo(700_000, 2);

    const plain = runProjection(plan({ gifts: [], wills: [SPLIT_WILL] }));
    const plainShares = [...at(plain, 2030).accountOwners!].filter(([id]) => id.startsWith("death-acct"));
    expect(plainShares.length).toBeGreaterThan(0);
    expect(plainShares.every(([, rec]) => rec.sliceOf === undefined)).toBe(true);
  });
});

/** Authored 70% client / 30% trust — the pre-gift precedent the gift overlay
 *  is measured against: partitioned at the death exactly like a 30% gift. */
const CLIENT_AND_TRUST: Account["owners"] = [
  { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.7 },
  { kind: "entity", entityId: TRUST, percent: 0.3 },
];

const trustRow = (y: ProjectionYear) => {
  const row = y.entityCashFlow.get(TRUST);
  if (row?.kind !== "trust") throw new Error(`no trust row in ${y.year}`);
  return row;
};

// After the first death the account is a family pool (original id) plus the
// trust's own slice. The passes that run AFTER the year loop — the trust's
// cash-flow row, the family share ledger, the portfolio re-bucket, the sales
// split — used to re-resolve the AUTHORED account against the pool's ledger
// and never saw the slice. They now read the ownership the loop published.
describe("death partition — the post-loop passes read the published ownership", () => {
  it("keeps the trust's 300k on its row when the survivor spends the whole pool", () => {
    const years = runProjection(plan({
      gifts: [toTrust(2027, 0.3)], endYear: 2031, needs: [{ year: 2030, amount: 800_000 }],
    }));
    expect(at(years, 2030).accountLedgers[ACC].endingValue).toBeCloseTo(0, 2);
    // The row used to read the trust's lock off the drained pool: $0.
    expect(trustRow(at(years, 2030)).endingBalance).toBeCloseTo(300_000, 2);
    expect(trustRow(at(years, 2031)).endingBalance).toBeCloseTo(300_000, 2);
  });

  it("locks a post-death gift of the pool fresh — the pre-death lock went into the slice", () => {
    // 20% of the 700k pool to the same trust the year right after the death.
    const years = runProjection(plan({
      gifts: [toTrust(2027, 0.3), toTrust(2030, 0.2, "spouse")], endYear: 2032,
    }));
    const y = at(years, 2030);
    // 300k slice + 20% × 700k. Resuming the 300k pre-death lock on the pool
    // (a lock only tops UP; 0.2 < 0.3) booked 600k.
    expect(y.entityAccountSharesEoY?.get(TRUST)?.get(ACC)).toBeCloseTo(140_000, 2);
    expect(trustRow(y).endingBalance).toBeCloseTo(440_000, 2);
  });

  it("gives the surviving joint owner the whole 700k pool in the family share ledger", () => {
    const years = runProjection(plan({ gifts: [toTrust(2027, 0.3)], owners: JOINT, spouseDies: true }));
    const shares = at(years, 2030).familyAccountSharesEoY!;
    // Was 400k: settled against the trust's stale 300k lock on the pool.
    expect(shares.get(LEGACY_FM_SPOUSE)?.get(ACC)).toBeCloseTo(700_000, 2);
  });

  it("leaves an account the death did not partition on its authored rows", () => {
    // The joint checking is retitled to the spouse at the death but not
    // partitioned. The reports read its AUTHORED rows, so the family ledger
    // must too: resolved off the retitled rows it dropped the client's entry,
    // and a report then handed the client a pro-rata slice on top of the
    // spouse's locked share.
    const years = runProjection(plan({ gifts: [toTrust(2027, 0.3)] }));
    const shares = at(years, 2030).familyAccountSharesEoY!;
    expect(shares.get(LEGACY_FM_CLIENT)?.get("acct-checking")).toBe(0);
    expect(shares.get(LEGACY_FM_SPOUSE)?.get("acct-checking")).toBeCloseTo(1000, 2);
  });

  it("does not split an authored-mixed account a second time on the portfolio", () => {
    const years = runProjection(plan({ gifts: [], owners: CLIENT_AND_TRUST }));
    // Death year: the snapshot already holds the slice; re-splitting the
    // pre-death ledger added the trust's 300k again (600k).
    expect(at(years, 2029).portfolioAssets.trustsAndBusinessesTotal).toBeCloseTo(300_000, 2);
    // After it the pool is wholly the survivor's — it read 1M-ledger thinking,
    // 700k pool − the trust's stale 300k lock = 400k.
    expect(at(years, 2030).portfolioAssets.taxable[ACC]).toBeCloseTo(700_000, 2);
    expect(at(years, 2030).portfolioAssets.trustsAndBusinessesTotal).toBeCloseTo(300_000, 2);
  });

  it("puts a post-death sale of the pool's gain wholly on the household", () => {
    const years = runProjection(plan({
      gifts: [toTrust(2027, 0.3)], endYear: 2032,
      assetTransactions: [{ id: "sell", name: "Sell", type: "sell", year: 2031,
        accountId: ACC, overrideSaleValue: 900_000 }],
    }));
    const y = at(years, 2031);
    // Pool basis stepped up to 700k at the death: gain 200k, all the survivor's.
    // Resolving the authored account sent 30% (60k) to the trust's 1041.
    expect(y.trustTaxByEntity?.get(TRUST)?.recognizedCapGains ?? 0).toBeCloseTo(0, 2);
    expect(y.taxDetail?.capitalGains).toBeCloseTo(200_000, 2);
  });
});

describe("death — the 40% of a note gifted to a trust leaves the decedent's Schedule K", () => {
  // The same household, plus a $500k client-owned note, 40% of it gifted to the
  // trust in 2027. The gross estate's liabilities loop read the AUTHORED owners
  // — the only one of its three loops that did — so the trust's 40% stayed on
  // the client's Schedule K at the real death and in every hypothetical from
  // the gift year on. The estate suites stayed green on it: no death test
  // carried a liability gift. Interest 0 and no payment hold the balance flat.
  const NOTE = "note-1";
  const note: Liability = {
    id: NOTE, name: "Note", balance: 500_000, interestRate: 0, monthlyPayment: 0,
    startYear: 2026, startMonth: 1, termMonths: 0, extraPayments: [],
    owners: CLIENT_ONLY,
  };
  const noteToTrust: GiftEvent = {
    kind: "liability", year: 2027, liabilityId: NOTE, percent: 0.4, grantor: "client",
    recipientEntityId: TRUST, parentGiftId: "gift-1",
  };
  const noteLine = (lines: GrossEstateLine[] | undefined) =>
    lines?.find((l) => l.liabilityId === NOTE)?.amount;

  it("books the retained 60% at the real first death and in the hypothetical, without a fallback warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const years = runProjection({ ...plan({ gifts: [noteToTrust] }), liabilities: [note] });

      const death = at(years, 2029).estateTax;
      expect(death?.deathOrder).toBe(1);
      expect(noteLine(death?.grossEstateLines)).toBeCloseTo(-300_000, 2);

      // "Both die this year" — the gift year, the year before the death, and the
      // death year itself. Client first, and spouse first with the client as the
      // FINAL death (the note is still the client's authored row there, so the
      // gift resolves at deathOrder 2 too). The client-first ordering's final
      // death is not pinned: its first death still hands the survivor the whole
      // note gift-blind — that is the unlinked-debt distribution, not this loop.
      for (const year of [2027, 2028, 2029]) {
        const hyp = at(years, year).hypotheticalEstateTax;
        expect(noteLine(hyp.primaryFirst.firstDeath.grossEstateLines)).toBeCloseTo(-300_000, 2);
        expect(noteLine(hyp.spouseFirst?.finalDeath?.grossEstateLines)).toBeCloseTo(-300_000, 2);
      }
      // Control: before the gift the whole note is the client's.
      const before = at(years, 2026).hypotheticalEstateTax.primaryFirst.firstDeath;
      expect(noteLine(before.grossEstateLines)).toBeCloseTo(-500_000, 2);

      // The gift is funded (0.4 of a 1.0 household share): the aggregate guard
      // never declines it, in any year or either death.
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  // SENTINEL — passes while its body FAILS. Correct: taxable estate 0. Gross is
  // 700,500 (1M + 500 checking − 300k retained note) and all of it passes to the
  // spouse, who assumes the retained 300k: marital 700,500. HEAD: 200,000 — the
  // unlinked-debt distribution still hands the spouse the WHOLE 500k note, and
  // the marital deduction nets all 500k (marital 500,500). Before this loop was
  // gift-aware both sides read 500k and cancelled to 0.
  // Flip `it.fails` → `it` in Task 13, when the first-death chain distributes /
  // partitions liabilities gift-aware. (The pin above runs this same fixture
  // green, so a throw cannot be what makes this pass.)
  it.fails("taxes nothing at the first death when everything passes to the spouse", () => {
    const years = runProjection({ ...plan({ gifts: [noteToTrust] }), liabilities: [note] });
    expect(at(years, 2029).estateTax?.taxableEstate).toBeCloseTo(0, 2);
  });
});

describe("death — a joint house gifted 40% with its bundled mortgage", () => {
  // The brief's motivating shape: a $600k joint house with a linked $300k joint
  // mortgage; 40% of the house goes to the trust in 2027 with its bundled 40%
  // mortgage child. Both compose to [client .3, spouse .3, trust .4]. The
  // client dies in 2029; the spouse survives. Flat balances, growth 0.
  const HOUSE = "house";
  const MORTGAGE = "mortgage";
  const house: Account = {
    id: HOUSE, name: "House", category: "real_estate", subType: "primary_residence",
    titlingType: "jtwros", value: 600_000, basis: 300_000, growthRate: 0, rmdEnabled: false,
    owners: JOINT,
  };
  const mortgage: Liability = {
    id: MORTGAGE, name: "Mortgage", balance: 300_000, interestRate: 0, monthlyPayment: 0,
    startYear: 2026, startMonth: 1, termMonths: 0, extraPayments: [],
    linkedPropertyId: HOUSE, owners: JOINT,
  };
  const houseGift: GiftEvent[] = [
    { kind: "asset", year: 2027, accountId: HOUSE, percent: 0.4, grantor: "client",
      recipientEntityId: TRUST },
    { kind: "liability", year: 2027, liabilityId: MORTGAGE, percent: 0.4, grantor: "client",
      recipientEntityId: TRUST, parentGiftId: "gift-house" },
  ];
  const run = () => {
    const base = plan({ gifts: houseGift });
    return runProjection({ ...base, accounts: [...base.accounts, house], liabilities: [mortgage] });
  };

  it("books the decedent's retained 30% of the mortgage on the first death's Schedule K", () => {
    // −(1 − 0.4) × the decedent's 0.5 × 300k. The authored joint read booked the
    // linked-property 50% default: −150,000.
    const line = at(run(), 2029).estateTax?.grossEstateLines.find((l) => l.liabilityId === MORTGAGE);
    expect(line?.percentage).toBeCloseTo(0.3, 9);
    expect(line?.amount).toBeCloseTo(-90_000, 2);
  });

  // SENTINEL — passes while its body FAILS. Correct: taxable estate 0. Gross is
  // 1,090,500 (1M + 500 checking + 180k house pool − 90k mortgage) and all of it
  // passes to the spouse, who assumes the decedent's 90k: marital 1,090,500.
  // HEAD: 60,000 — the partition never splits the linked mortgage, so the whole
  // mortgage follows the pool to the spouse and the encumbrance netting takes
  // 150k (marital 1,030,500). Before this loop was gift-aware both sides read
  // 150k and cancelled to 0.
  // Flip `it.fails` → `it` in Task 13, when the first-death chain distributes /
  // partitions liabilities gift-aware. (The case above runs this same fixture
  // green, so a throw cannot be what makes this pass.)
  it.fails("taxes nothing at the first death when everything passes to the spouse", () => {
    expect(at(run(), 2029).estateTax?.taxableEstate).toBeCloseTo(0, 2);
  });
});
