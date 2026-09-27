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

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";
import type {
  Account,
  EntitySummary,
  Expense,
  FamilyMember,
  GiftEvent,
  ProjectionYear,
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

describe("death partition — estate costs are not paid out of a fully gifted account", () => {
  it("leaves a 100%-gifted account whole when the first death owes $50k of admin expenses", () => {
    // The skip leaves the account's AUTHORED rows naming the decedent, and the
    // estate drain read them: it took the $50k from the child's account.
    const years = runProjection(plan({ gifts: [toKid(2027, 1)], estateAdminExpenses: 50_000 }));
    expect(at(years, 2029).estateTax?.estateAdminExpenses).toBeCloseTo(50_000, 2);
    expect(at(years, 2030).accountLedgers[ACC].endingValue).toBeCloseTo(1_000_000, 2);
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

describe("death partition — a wholly gifted account keeps its authored rows", () => {
  it("runs past the owner's death for a 100%-gifted IRA with RMDs due", () => {
    // Why the chain leaves a wholly gifted account's rows alone instead of
    // retitling them to the resolved `gifted_away` row: every authored-owner
    // reader would then see an owner that is neither a family member nor an
    // entity, and the RMD block throws "must have a single owner" the first
    // year an RMD falls due. (A gift of an IRA is not legal, but nothing stops
    // one being entered.)
    const ira: Account = {
      id: "ira", name: "IRA", category: "retirement", subType: "traditional_ira",
      titlingType: "jtwros", value: 500_000, basis: 0, growthRate: 0, rmdEnabled: true,
      owners: CLIENT_ONLY,
    };
    const data = plan({ gifts: [] });
    data.client = { ...data.client, dateOfBirth: "1955-01-01", lifeExpectancy: 74 };
    data.familyMembers = FAMILY.map((f) => f.role === "client" ? { ...f, dateOfBirth: "1955-01-01" } : f);
    data.accounts = [...data.accounts, ira];
    data.giftEvents = [{ kind: "asset", year: 2027, accountId: "ira", percent: 1,
      grantor: "client", recipientFamilyMemberId: KID }];
    const years = runProjection(data);
    expect(at(years, 2029).estateTax?.deathOrder).toBe(1);
    expect(at(years, 2033).accountLedgers["ira"]).toBeDefined();
  });
});
