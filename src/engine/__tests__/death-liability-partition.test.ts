// A liability gift at the death event.
//
// A gift of a debt (a note, or the mortgage bundled with a gifted house) moves
// a share of it to a trust or out of the household. The gross estate books only
// the decedent's share (Task 10) — but every death-time consumer AFTER it read
// the debt's authored rows as dollars: the chain handed the whole mortgage to
// the spouse with the house (and the marital deduction netted all of it), the
// unlinked-debt distribution handed the spouse the trust's share of a note, the
// final death's creditor drain and bequests paid the trust's share from the
// estate. And a debt kept under its original id got the same gift taken out of
// it again at the next death.
//
// `partitionGiftedLiabilities` cuts each gifted debt ONCE, after the gross
// estate: a `[trust 1]` row per entity recipient, nothing for a share gifted to
// a person, and the household's pool under the original id, marked
// `giftsReflectedThrough` so no later read re-applies the gift.
//
// One $1M client brokerage + $1,000 joint checking, growth 0, flat tax 0, an
// irrevocable non-grantor trust. Gifts in 2027 by the client unless noted. The
// client dies in 2029; the spouse survives the horizon, or dies in 2031 when
// `spouseDies`. A note is $500k unlinked; a house $600k with a $300k linked
// mortgage. Interest 0 — a `pay` variant amortizes at a flat payment.

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";
import type {
  Account, EntitySummary, EstateTaxResult, FamilyMember, GiftEvent, Liability, ProjectionYear, Will,
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

const CLIENT: Account["owners"] = [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }];
const JOINT: Account["owners"] = [
  { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
  { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
];
const JOINT_70_30: Account["owners"] = [
  { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.7 },
  { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.3 },
];

function plan(o: {
  gifts: GiftEvent[];
  liabilities: Liability[];
  extraAccounts?: Account[];
  spouseDies?: boolean;
  single?: boolean;
  wills?: Will[];
}) {
  const acct: Account = {
    id: ACC, name: "Brokerage", category: "taxable", subType: "brokerage", titlingType: "jtwros",
    value: 1_000_000, basis: 400_000, growthRate: 0, rmdEnabled: false, owners: CLIENT,
  };
  const checking: Account = {
    id: "acct-checking", name: "Checking", category: "cash", subType: "checking", titlingType: "jtwros",
    value: 1000, basis: 1000, growthRate: 0, rmdEnabled: false, isDefaultChecking: true,
    owners: o.single ? CLIENT : JOINT,
  };
  return buildClientData({
    client: o.single
      ? { ...baseClient, dateOfBirth: "1960-01-01", spouseDob: undefined, spouseName: undefined,
          filingStatus: "single", lifeExpectancy: 69 }
      : { ...baseClient, dateOfBirth: "1960-01-01", spouseDob: "1972-06-15",
          lifeExpectancy: 69, spouseLifeExpectancy: o.spouseDies ? 59 : 95 },
    familyMembers: o.single ? FAMILY.filter((f) => f.role !== "spouse") : FAMILY,
    accounts: [checking, acct, ...(o.extraAccounts ?? [])], entities: [trust],
    incomes: [], liabilities: o.liabilities, savingsRules: [], expenses: [],
    withdrawalStrategy: [{ accountId: ACC, priorityOrder: 1, startYear: 2026, endYear: 2033 }],
    giftEvents: o.gifts, wills: o.wills ?? [], assetTransactions: [],
    planSettings: { ...basePlanSettings, flatFederalRate: 0, flatStateRate: 0,
      planStartYear: 2026, planEndYear: 2033, estateAdminExpenses: 0 },
  });
}

const note = (owners: Account["owners"], over: Partial<Liability> = {}): Liability => ({
  id: "note", name: "Note", balance: 500_000, interestRate: 0, monthlyPayment: 0,
  startYear: 2026, startMonth: 1, termMonths: 0, extraPayments: [], owners, ...over,
});
const house = (owners: Account["owners"]): Account => ({
  id: "house", name: "House", category: "real_estate", subType: "primary_residence", titlingType: "jtwros",
  value: 600_000, basis: 300_000, growthRate: 0, rmdEnabled: false, owners,
});
const mortgage = (owners: Account["owners"], over: Partial<Liability> = {}): Liability => ({
  id: "mortgage", name: "Mortgage", balance: 300_000, interestRate: 0, monthlyPayment: 0,
  startYear: 2026, startMonth: 1, termMonths: 0, extraPayments: [], linkedPropertyId: "house",
  owners, ...over,
});
/** Note amortizing at $2,000/mo (24,000/yr) — 404,000 at the end of 2029. */
const PAYING_NOTE = { monthlyPayment: 2000, termMonths: 250 };
/** Mortgage amortizing at $1,500/mo (18,000/yr) — 228,000 at the end of 2029. */
const PAYING_MORTGAGE = { monthlyPayment: 1500, termMonths: 200 };

type Recipient = { recipientEntityId: string } | { recipientFamilyMemberId: string };
const TO_TRUST: Recipient = { recipientEntityId: TRUST };
const TO_KID: Recipient = { recipientFamilyMemberId: KID };
const liabGift = (liabilityId: string, percent: number, to: Recipient = TO_TRUST,
  year = 2027, grantor: "client" | "spouse" = "client"): GiftEvent =>
  ({ kind: "liability", year, liabilityId, percent, grantor, parentGiftId: "g", ...to }) as GiftEvent;
const houseGift = (percent: number, to: Recipient = TO_TRUST, grantor: "client" | "spouse" = "client"): GiftEvent =>
  ({ kind: "asset", year: 2027, accountId: "house", percent, grantor, ...to }) as GiftEvent;

const withHouse = (o: Omit<Parameters<typeof plan>[0], "extraAccounts">, owners = JOINT) =>
  plan({ ...o, extraAccounts: [house(owners)] });

const at = (years: ProjectionYear[], year: number) => {
  const y = years.find((r) => r.year === year);
  if (!y) throw new Error(`no projection row for ${year}`);
  return y;
};
const death = (years: ProjectionYear[], order: 1 | 2): EstateTaxResult => {
  const e = years.map((y) => y.estateTax).find((t) => t?.deathOrder === order);
  if (!e) throw new Error(`no death of order ${order}`);
  return e;
};
/** Schedule K lines of one liability id — a synthetic id by its prefix. */
const liabLine = (e: EstateTaxResult | undefined, id: string) =>
  (e?.grossEstateLines ?? [])
    .filter((l) => l.liabilityId === id || (l.liabilityId ?? "").startsWith(`${id}-`))
    .reduce((s, l) => s + l.amount, 0);
const boy = (years: ProjectionYear[], year: number, id: string) =>
  Object.entries(at(years, year).liabilityBalancesBoY)
    .filter(([k]) => k === id || k.startsWith(`${id}-`))
    .reduce((s, [, v]) => s + v, 0);
const creditorPaid = (e: EstateTaxResult) => e.creditorPayoffDebits.reduce((s, d) => s + d.amount, 0);
const liabilityTransfers = (years: ProjectionYear[], via: string) =>
  years.flatMap((y) => y.deathTransfers ?? []).filter((t) => t.sourceLiabilityId != null && t.via === via);
/** The debt the spouse assumed at the first death — what the marital deduction nets. */
const assumedBySpouse = (years: ProjectionYear[]) =>
  liabilityTransfers(years, "unlinked_liability_proportional")
    .filter((t) => t.deathOrder === 1 && t.recipientKind === "spouse")
    .reduce((s, t) => s + t.amount, 0);

describe("death — an unlinked note, 40% gifted to a trust", () => {
  it("the survivor keeps her own 150k of a joint note, assumes the decedent's 150k, and the trust keeps 200k", () => {
    const years = runProjection(plan({
      gifts: [liabGift("note", 0.4)], liabilities: [note(JOINT)], spouseDies: true,
    }));
    const first = death(years, 1);
    expect(first.taxableEstate).toBeCloseTo(0, 2);
    expect(assumedBySpouse(years)).toBeCloseTo(-150_000, 2);
    expect(boy(years, 2030, "note")).toBeCloseTo(150_000, 2);
    expect(boy(years, 2030, "death-liab")).toBeCloseTo(150_000, 2);
    expect(boy(years, 2030, "liab-slice")).toBeCloseTo(200_000, 2);
    // The spouse's death: her own pool is NOT gifted a second time (−90,000 if it were).
    const final = death(years, 2);
    expect(liabLine(final, "note")).toBeCloseTo(-150_000, 2);
    expect(liabLine(final, "death-liab")).toBeCloseTo(-150_000, 2);
    expect(creditorPaid(final)).toBeCloseTo(300_000, 2);
  });

  it("a later gift of the survivor's pool takes its share of the POOL, once", () => {
    // The spouse gifts 20% of the note in 2030 — of her 150k pool: 30k.
    const years = runProjection(plan({
      gifts: [liabGift("note", 0.4), liabGift("note", 0.2, TO_TRUST, 2030, "spouse")],
      liabilities: [note(JOINT)], spouseDies: true,
    }));
    const final = death(years, 2);
    expect(liabLine(final, "note")).toBeCloseTo(-120_000, 2);
    expect(creditorPaid(final)).toBeCloseTo(270_000, 2);
  });

  it("the trust keeps paying its share of an amortizing note after the death", () => {
    // 24,000/yr: 9,600 is the trust's from 2027 on. 500,000 − 5 × 9,600.
    const trustChecking: Account = {
      id: "trust-chk", name: "Trust Checking", category: "cash", subType: "checking", titlingType: "jtwros",
      value: 500_000, basis: 500_000, growthRate: 0, rmdEnabled: false, isDefaultChecking: true,
      owners: [{ kind: "entity", entityId: TRUST, percent: 1 }],
    };
    const years = runProjection(plan({
      gifts: [liabGift("note", 0.4)], liabilities: [note(CLIENT, PAYING_NOTE)],
      extraAccounts: [trustChecking], spouseDies: true,
    }));
    expect(at(years, 2031).accountLedgers["trust-chk"].endingValue).toBeCloseTo(452_000, 2);
  });

  it("the spouse's 60% amortizes as a 60% debt — its schedule is the share's, not the whole note's", () => {
    // 404,000 at the death: spouse 242,400 at 14,400/yr, trust 161,600 at 9,600/yr.
    const years = runProjection(plan({
      gifts: [liabGift("note", 0.4)], liabilities: [note(CLIENT, PAYING_NOTE)], spouseDies: true,
    }));
    expect(boy(years, 2030, "death-liab")).toBeCloseTo(242_400, 2);
    expect(boy(years, 2031, "death-liab")).toBeCloseTo(228_000, 2);
    expect(boy(years, 2031, "liab-slice")).toBeCloseTo(152_000, 2);
    expect(at(years, 2030).expenses.liabilities).toBeCloseTo(14_400, 2);
    // 242,400 − 2 × 14,400.
    expect(liabLine(death(years, 2), "death-liab")).toBeCloseTo(-213_600, 2);
  });

  it("a person's share leaves with the person — nothing of it is handed to the spouse", () => {
    const years = runProjection(plan({
      gifts: [liabGift("note", 0.4, TO_KID)], liabilities: [note(CLIENT)], spouseDies: true,
    }));
    expect(death(years, 1).taxableEstate).toBeCloseTo(0, 2);
    expect(boy(years, 2030, "death-liab")).toBeCloseTo(300_000, 2);
    expect(boy(years, 2030, "liab-slice")).toBe(0);
  });
});

describe("death — a single filer's note, 40% gifted to a trust", () => {
  const years = (o: { wills?: Will[]; liquid?: number } = {}) => {
    const d = plan({ gifts: [liabGift("note", 0.4)], liabilities: [note(CLIENT)], single: true, wills: o.wills });
    return runProjection(o.liquid == null ? d : {
      ...d, accounts: d.accounts.map((a) => (a.id === ACC ? { ...a, value: o.liquid!, basis: o.liquid! } : a)),
    });
  };

  it("the creditor drain pays the household's 300k, not the trust's 200k", () => {
    expect(creditorPaid(death(years(), 2))).toBeCloseTo(300_000, 2);
  });

  it("a will bequeathing the note hands the heir the household's 300k", () => {
    const will = {
      id: "will-c", grantor: "client",
      bequests: [{ id: "bq", name: "Note to kid", kind: "liability", assetMode: null, accountId: null,
        liabilityId: "note", entityId: null, percentage: 100, condition: "always", sortOrder: 0,
        recipients: [{ recipientKind: "family_member", recipientId: KID, percentage: 100, sortOrder: 0 }] }],
    } as unknown as Will;
    const bequest = liabilityTransfers(years({ wills: [will] }), "will_liability_bequest");
    expect(bequest.reduce((s, t) => s + t.amount, 0)).toBeCloseTo(-300_000, 2);
  });

  it("an illiquid estate distributes only the household's unpaid share to the heirs", () => {
    // 101,000 liquid against the household's 300,000: 199,000 falls to the kid.
    const rest = liabilityTransfers(years({ liquid: 100_000 }), "unlinked_liability_proportional");
    expect(rest.reduce((s, t) => s + t.amount, 0)).toBeCloseTo(-199_000, 2);
  });
});

describe("death — a house and its mortgage, gifted together", () => {
  const bundled = (percent: number, to: Recipient = TO_TRUST) =>
    [houseGift(percent, to), liabGift("mortgage", percent, to)];

  it("the spouse's death books the pool's mortgage once", () => {
    const years = runProjection(withHouse({
      gifts: bundled(0.4), liabilities: [mortgage(JOINT)], spouseDies: true,
    }));
    expect(boy(years, 2030, "mortgage")).toBeCloseTo(180_000, 2);
    expect(boy(years, 2030, "liab-slice")).toBeCloseTo(120_000, 2);
    expect(liabLine(death(years, 2), "mortgage")).toBeCloseTo(-180_000, 2);
  });

  it("an amortizing mortgage's pool amortizes as the household's 60%", () => {
    // 228,000 at the end of 2029: pool 136,800 at 10,800/yr, trust 91,200.
    const years = runProjection(withHouse({
      gifts: bundled(0.4), liabilities: [mortgage(JOINT, PAYING_MORTGAGE)], spouseDies: true,
    }));
    expect(boy(years, 2030, "mortgage")).toBeCloseTo(136_800, 2);
    expect(boy(years, 2030, "liab-slice")).toBeCloseTo(91_200, 2);
    expect(at(years, 2030).expenses.liabilities).toBeCloseTo(10_800, 2);
    // 0.6 × 192,000 at the end of 2031.
    expect(liabLine(death(years, 2), "mortgage")).toBeCloseTo(-115_200, 2);
  });

  it("a mortgage share gifted to a person leaves the spouse's encumbrance", () => {
    const years = runProjection(withHouse({
      gifts: bundled(0.4, TO_KID), liabilities: [mortgage(JOINT)], spouseDies: true,
    }));
    expect(death(years, 1).taxableEstate).toBeCloseTo(0, 2);
    expect(boy(years, 2030, "mortgage")).toBeCloseTo(180_000, 2);
  });
});

describe("death — the split keys on the DEBT's own gift, not the house's", () => {
  it("a mortgage gifted without its house: the trust's share still leaves the encumbrance", () => {
    const years = runProjection(withHouse({
      gifts: [liabGift("mortgage", 0.4)], liabilities: [mortgage(JOINT)], spouseDies: true,
    }));
    expect(death(years, 1).taxableEstate).toBeCloseTo(0, 2);
    expect(boy(years, 2030, "mortgage")).toBeCloseTo(180_000, 2);
  });

  it("a house gifted WITHOUT its mortgage: the household still owes all of it", () => {
    // The debt was not gifted, so nothing is cut: the whole 300k follows the
    // household's pool of the house to the spouse and is hers at her death.
    const years = runProjection(withHouse({
      gifts: [houseGift(0.4)], liabilities: [mortgage(JOINT)], spouseDies: true,
    }));
    const first = death(years, 1);
    expect(liabLine(first, "mortgage")).toBeCloseTo(-150_000, 2);
    expect(first.taxableEstate).toBeCloseTo(0, 2);
    expect(boy(years, 2030, "mortgage")).toBeCloseTo(300_000, 2);
    expect(boy(years, 2030, "liab-slice")).toBe(0);
    expect(liabLine(death(years, 2), "mortgage")).toBeCloseTo(-300_000, 2);
  });
});

describe("death — a gifted 70/30 joint note, and a 70/30 mortgage on a JOINT house: Schedule K books the joint half", () => {
  // The composer shrinks both rows pro rata: [c .42, s .18, trust .4]. The
  // unlinked distribution, and the encumbrance netting on a JOINTLY held house,
  // take half of the household's pool at the first death; the gross estate
  // books the same half, so the marital deduction nets exactly what Schedule K
  // subtracted. (A house held by ONE spouse: the next describe.)
  it("a note: the decedent's half of the 300k pool on both sides", () => {
    const years = runProjection(plan({ gifts: [liabGift("note", 0.4)], liabilities: [note(JOINT_70_30)] }));
    const first = death(years, 1);
    expect(liabLine(first, "note")).toBeCloseTo(-150_000, 2);
    expect(assumedBySpouse(years)).toBeCloseTo(-150_000, 2);
    expect(first.maritalDeduction).toBeCloseTo(first.grossEstate, 2);
    expect(first.taxableEstate).toBeCloseTo(0, 2);
  });

  it("a house and mortgage: the decedent's half of the 180k pool, in every ordering", () => {
    const years = runProjection(withHouse({
      gifts: [houseGift(0.4), liabGift("mortgage", 0.4)], liabilities: [mortgage(JOINT_70_30)],
    }, JOINT_70_30));
    const first = death(years, 1);
    expect(liabLine(first, "mortgage")).toBeCloseTo(-90_000, 2);
    expect(first.maritalDeduction).toBeCloseTo(first.grossEstate, 2);
    // Spouse first, in a year both are alive: the same pool, the same half.
    expect(at(years, 2029).hypotheticalEstateTax.spouseFirst?.firstDeath.taxableEstate).toBeCloseTo(0, 2);
  });
});

describe("death — a gifted JOINT mortgage on a house ONE spouse owns: the property decides, as it does ungifted", () => {
  // A joint $300k mortgage on a $600k house one spouse holds alone; the house's
  // owner gifts 40% of both to the trust. The mortgage composes to
  // [c .3, s .3, trust .4] — the household keeps 60% (180k). Ungifted, a debt
  // linked to the decedent's own house is wholly the decedent's and one linked
  // to the survivor's house is not the decedent's at all; the gifted rung takes
  // that same fraction of the household's 60%. The encumbrance netting reads
  // the house's includible share the same way (1 or 0), so the two agree.
  it("the decedent's house: Schedule K books the household's whole 180k, which the spouse assumes with the house", () => {
    const years = runProjection(withHouse({
      gifts: [houseGift(0.4), liabGift("mortgage", 0.4)], liabilities: [mortgage(JOINT)],
    }, CLIENT));
    const first = death(years, 1);
    // −(1 × 0.6 × 300,000). The joint half (0.3) booked −90,000 against a 180,000 encumbrance.
    expect(liabLine(first, "mortgage")).toBeCloseTo(-180_000, 2);
    // 1,000,000 brokerage + 500 checking + 360,000 house pool − 180,000.
    expect(first.grossEstate).toBeCloseTo(1_180_500, 2);
    // Everything to the spouse; the house pool nets its 180,000 encumbrance.
    expect(first.maritalDeduction).toBeCloseTo(1_180_500, 2);
    expect(first.taxableEstate).toBeCloseTo(0, 2);
  });

  it("the survivor's house: the decedent's death books none of it; her own first death books her 180k", () => {
    const years = runProjection(withHouse({
      gifts: [houseGift(0.4, TO_TRUST, "spouse"), liabGift("mortgage", 0.4, TO_TRUST, 2027, "spouse")],
      liabilities: [mortgage(JOINT)],
    }, [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }]));
    // The client's real death: a debt against the survivor's house is not his
    // (the ungifted twin books nothing either). The joint half booked −90,000.
    const first = death(years, 1);
    expect(liabLine(first, "mortgage")).toBe(0);
    expect(first.grossEstate).toBeCloseTo(1_000_500, 2);
    // Spouse first, in a year both are alive: 500 checking + 360,000 house pool
    // − 180,000, all to the client with its encumbrance.
    const spouseFirst = at(years, 2029).hypotheticalEstateTax.spouseFirst!.firstDeath;
    expect(liabLine(spouseFirst, "mortgage")).toBeCloseTo(-180_000, 2);
    expect(spouseFirst.grossEstate).toBeCloseTo(180_500, 2);
    expect(spouseFirst.taxableEstate).toBeCloseTo(0, 2);
  });
});
