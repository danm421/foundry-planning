// Margin loans at death (spec 2026-10-13). The projection holds a margined
// account at NET in `accountBalances` and its live loan in `marginMap`. A death
// must hand that loan to every account it produces, drop the share that leaves
// the household, and step basis up to the SECURITIES value (net + loan) —
// §1014 resets basis to the fair market value of the securities held, not of
// the equity left after the loan.

import { describe, it, expect } from "vitest";
import { applyFirstDeath } from "../death-event/first-death";
import { applyFinalDeath } from "../death-event/final-death";
import { applyBusinessSuccession } from "../death-event/business-succession";
import type { DeathEventInput } from "../death-event/shared";
import { runProjection, runProjectionWithEvents } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";
import type {
  Account, EntitySummary, FamilyMember, GiftEvent, PlanSettings, ProjectionYear,
} from "../types";

// ── Death-event inputs (from partition-mixed-account-integration.test.ts) ────

const clientFm: FamilyMember = {
  id: LEGACY_FM_CLIENT, role: "client", relationship: "other",
  firstName: "Client", lastName: "Test", dateOfBirth: "1970-01-01",
};
const spouseFm: FamilyMember = {
  id: LEGACY_FM_SPOUSE, role: "spouse", relationship: "other",
  firstName: "Co-client", lastName: "Test", dateOfBirth: "1972-01-01",
};
const kids = (n: number): FamilyMember[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `kid-${i + 1}`, role: "child", relationship: "child",
    firstName: `Kid${i + 1}`, lastName: "Test", dateOfBirth: "2000-01-01",
  }));

const ps: PlanSettings = {
  flatFederalRate: 0, flatStateRate: 0, inflationRate: 0.025,
  planStartYear: 2026, planEndYear: 2080, taxInflationRate: 0.025,
  estateAdminExpenses: 0, flatStateEstateRate: 0,
};

type Over = Partial<DeathEventInput> & {
  balances?: Record<string, number>;
  basis?: Record<string, number>;
};

function mkInput(over: Over): DeathEventInput {
  const { balances, basis, ...rest } = over;
  const accounts = rest.accounts ?? [];
  const accountBalances: Record<string, number> = { ...(rest.accountBalances ?? balances ?? {}) };
  const basisMap: Record<string, number> = { ...(rest.basisMap ?? basis ?? {}) };
  for (const a of accounts) {
    if (accountBalances[a.id] == null) accountBalances[a.id] = a.value;
    if (basisMap[a.id] == null) basisMap[a.id] = a.basis;
  }
  return {
    year: 2045, deceased: "client", survivor: "spouse", will: null,
    incomes: [], liabilities: [],
    familyMembers: [clientFm, spouseFm],
    externalBeneficiaries: [], entities: [], planSettings: ps, gifts: [],
    annualExclusionsByYear: {}, dsueReceived: 0,
    priorTaxableGifts: { client: 0, spouse: 0 },
    ...rest,
    accounts, accountBalances, basisMap,
  };
}

function mkFinalDeathInput(over: Over & { children?: number }): DeathEventInput {
  const { children = 1, ...rest } = over;
  return mkInput({
    year: 2052, survivor: "client",
    familyMembers: [clientFm, ...kids(children)],
    ...rest,
  });
}

const NET = 8_000_000;
const LOAN = 2_000_000;
/** The loan the account was AUTHORED with at plan start. Deliberately not the
 *  live loan in `marginMap`, so every assertion can only pass on the live one. */
const AUTHORED_LOAN = 1_000_000;

const margined = (id: string, owners: Account["owners"], basis = 5_000_000): Account => ({
  id, name: "Brokerage", category: "taxable", subType: "brokerage", titlingType: "jtwros",
  value: NET + AUTHORED_LOAN, basis, growthRate: 0, rmdEnabled: false, owners,
  marginBalance: AUTHORED_LOAN, marginInterestRate: 0,
});

const CLIENT_SOLE: Account["owners"] = [
  { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 },
];
const JOINT: Account["owners"] = [
  { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
  { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
];
const jointMargined = margined("j", JOINT);
const soleMargined = margined("s", CLIENT_SOLE);

const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);

describe("margin loans at death", () => {
  it("first death to spouse (in place, jtwros): loan stays whole on the same id; half step-up on GROSS", () => {
    const res = applyFirstDeath(mkInput({ accounts: [jointMargined], balances: { j: NET },
      basis: { j: 5_000_000 }, marginMap: { j: LOAN } }));
    expect(res.marginMap.j).toBeCloseTo(2_000_000, 2);
    expect(res.basisMap.j).toBeCloseTo(0.5 * 5_000_000 + 0.5 * 10_000_000, 2); // 7.5M
  });

  it("sole-owned at death: full step-up to the securities value", () => {
    const res = applyFirstDeath(mkInput({ accounts: [soleMargined], balances: { s: NET },
      basis: { s: 5_000_000 }, marginMap: { s: LOAN } }));
    const heirIds = res.accounts
      .filter((a) => a.sliceOf === "s" || a.id === "s" || a.name.startsWith("Brokerage"))
      .map((a) => a.id);
    const basis = heirIds.reduce((t, id) => t + (res.basisMap[id] ?? 0), 0);
    expect(basis).toBeCloseTo(10_000_000, 2);
  });

  it("final death to two children: total loan is conserved and each heir keeps the parent's leverage", () => {
    const res = applyFinalDeath(mkFinalDeathInput({ accounts: [soleMargined], balances: { s: NET },
      basis: { s: NET }, marginMap: { s: LOAN }, children: 2 }));
    const loans = Object.values(res.marginMap);
    expect(loans.reduce((a, b) => a + b, 0)).toBeCloseTo(2_000_000, 2);
    const heirs = res.accounts.filter((x) => (res.marginMap[x.id] ?? 0) > 0);
    expect(heirs).toHaveLength(2);
    for (const a of heirs) {
      expect(res.marginMap[a.id] / res.accountBalances[a.id]).toBeCloseTo(0.25, 6);
    }
  });

  it("a mixed 70% client / 30% entity account conserves the whole loan through BOTH deaths", () => {
    const llc: EntitySummary = {
      id: "llc", name: "Family LLC", entityType: "llc", includeInPortfolio: false,
      isGrantor: false, isIrrevocable: true,
    };
    const mixed = margined("m", [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.7 },
      { kind: "entity", entityId: "llc", percent: 0.3 },
    ]);
    const first = applyFirstDeath(mkInput({ accounts: [mixed], entities: [llc],
      balances: { m: NET }, marginMap: { m: LOAN } }));
    expect(sum(first.marginMap)).toBeCloseTo(LOAN, 2);
    const slice = first.accounts.find((a) => a.sliceOf === "m")!;
    expect(first.marginMap[slice.id]).toBeCloseTo(0.3 * LOAN, 2);
    expect(first.marginMap.m).toBeCloseTo(0.7 * LOAN, 2);

    const final = applyFinalDeath(mkFinalDeathInput({
      deceased: "spouse", survivor: "spouse",
      familyMembers: [clientFm, spouseFm, ...kids(2)],
      accounts: first.accounts, accountBalances: first.accountBalances,
      basisMap: first.basisMap, marginMap: first.marginMap,
      liabilities: first.liabilities, entities: first.entities, incomes: first.incomes,
    }));
    // The pool split between two children; the LLC's slice kept its share.
    expect(sum(final.marginMap)).toBeCloseTo(LOAN, 2);
    expect(Object.keys(final.marginMap)).toHaveLength(3);
    expect(final.marginMap[slice.id]).toBeCloseTo(0.3 * LOAN, 2);
  });

  it("drops the loan with an account that leaves the household", () => {
    // No children and no will at the final death → "Other Heirs" (removed).
    const res = applyFinalDeath(mkFinalDeathInput({ accounts: [soleMargined], balances: { s: NET },
      marginMap: { s: LOAN }, children: 0 }));
    expect(res.accounts.find((a) => a.id === "s")).toBeUndefined();
    expect(res.marginMap).toEqual({});
  });

  it("an account with no loan adds nothing to the map", () => {
    // Every loaded account carries `marginBalance: 0`.
    const loaded: Account = { ...soleMargined, marginBalance: 0 };
    const res = applyFirstDeath(mkInput({ accounts: [loaded], balances: { s: NET } }));
    expect(res.marginMap).toEqual({});
  });

  it("a revocable trust's pour-out steps its margined slice up to the securities value", () => {
    const rlt: EntitySummary = {
      id: "rlt", name: "Living Trust", entityType: "trust", includeInPortfolio: true,
      isGrantor: true, isIrrevocable: false, grantor: "client",
      beneficiaries: [{ id: "b1", tier: "primary", percentage: 100, familyMemberId: LEGACY_FM_SPOUSE, sortOrder: 0 }],
    };
    // The trust's 30% is peeled into its own slice by the chain, so the
    // pour-out must read the loan the CHAIN handed that new slice.
    const mixed = margined("m", [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.7 },
      { kind: "entity", entityId: "rlt", percent: 0.3 },
    ]);
    const res = applyFirstDeath(mkInput({ accounts: [mixed], entities: [rlt],
      balances: { m: NET }, marginMap: { m: LOAN } }));
    const pour = res.transfers.filter((t) => t.via === "trust_pour_out");
    expect(pour).toHaveLength(1);
    expect(pour[0].amount).toBeCloseTo(0.3 * NET, 2);
    expect(pour[0].basis).toBeCloseTo(0.3 * (NET + LOAN), 2);
  });

  it("business succession steps a margined child account up to the securities value", () => {
    const biz: Account = {
      id: "biz", name: "Family Business", category: "business", subType: "llc",
      businessType: "llc", parentAccountId: null, value: 10_000, basis: 4_000,
      growthRate: 0, rmdEnabled: false, titlingType: "jtwros", owners: CLIENT_SOLE,
    };
    const child: Account = { ...margined("biz-brokerage", []), parentAccountId: "biz" };
    const r = applyBusinessSuccession({
      deceased: "client", deceasedFmId: LEGACY_FM_CLIENT, survivorFmId: LEGACY_FM_SPOUSE,
      deathOrder: 1, accounts: [biz, child],
      accountBalances: { biz: 10_000, "biz-brokerage": NET },
      basisMap: { biz: 4_000, "biz-brokerage": 5_000_000 },
      marginMap: { "biz-brokerage": LOAN },
      will: null, familyMembers: [clientFm, spouseFm], externalBeneficiaries: [], year: 2045,
    });
    expect(r.basisUpdates.find((u) => u.accountId === "biz-brokerage")?.newBasis)
      .toBeCloseTo(NET + LOAN, 2);
  });
});

// ── Projection (plan() from death-partition-gift-overlay.test.ts) ────────────

const ACC = "acct-x";
const TRUST = "trust-1";
const KID = "kid-a";
const PROJ_LOAN = 200_000;

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

const toTrust = (year: number, percent: number): GiftEvent => ({
  kind: "asset", year, accountId: ACC, percent, grantor: "client", recipientEntityId: TRUST,
});

/** One $1M brokerage ($800k net of the loan), growth 0, margin rate 0 unless
 *  `marginRate`. Client dies 2029 (1960 + 69); the spouse dies 2031 when
 *  `spouseDies`. */
function plan(opts: {
  gifts?: GiftEvent[];
  owners?: Account["owners"];
  spouseDies?: boolean;
  margin?: number;
  marginRate?: number;
}) {
  const acct: Account = {
    id: ACC, name: "Brokerage", category: "taxable", subType: "brokerage",
    titlingType: "jtwros",
    value: 1_000_000, basis: 400_000, growthRate: 0, rmdEnabled: false,
    owners: opts.owners ?? CLIENT_SOLE,
    ...(opts.margin != null
      ? { marginBalance: opts.margin, marginInterestRate: opts.marginRate ?? 0 }
      : {}),
  };
  const checking: Account = {
    id: "acct-checking", name: "Checking", category: "cash", subType: "checking",
    titlingType: "jtwros", value: 1000, basis: 1000, growthRate: 0,
    rmdEnabled: false, isDefaultChecking: true, owners: JOINT,
  };
  return buildClientData({
    client: { ...baseClient, dateOfBirth: "1960-01-01", spouseDob: "1972-06-15",
      lifeExpectancy: 69, spouseLifeExpectancy: opts.spouseDies ? 59 : 95 },
    familyMembers: FAMILY, accounts: [checking, acct], entities: [trust],
    incomes: [], liabilities: [], savingsRules: [], expenses: [],
    withdrawalStrategy: [{ accountId: ACC, priorityOrder: 1, startYear: 2026, endYear: 2033 }],
    giftEvents: opts.gifts ?? [],
    wills: [],
    planSettings: { ...basePlanSettings, flatFederalRate: 0, flatStateRate: 0,
      planStartYear: 2026, planEndYear: 2033, estateAdminExpenses: 0 },
  });
}

const at = (years: ProjectionYear[], year: number) => {
  const y = years.find((r) => r.year === year);
  if (!y) throw new Error(`no projection row for ${year}`);
  return y;
};

const loanBoY = (y: ProjectionYear) =>
  Object.values(y.accountLedgers).reduce((t, l) => t + (l.marginBoY ?? 0), 0);

const basisFrom = (transfers: ProjectionYear["deathTransfers"], deathOrder: 1 | 2) =>
  (transfers ?? [])
    .filter((t) => t.deathOrder === deathOrder && t.sourceAccountId === ACC)
    .reduce((s, t) => s + t.basis, 0);

describe("margin loans at death — projection", () => {
  it("projection: a gift of 30% to a trust gives the trust slice 30% of the loan at the death", () => {
    const y2030 = at(runProjection(plan({ gifts: [toTrust(2027, 0.3)], margin: PROJ_LOAN })), 2030);
    const slice = Object.entries(y2030.accountLedgers).find(([id]) => id.startsWith("entity-slice"))![1];
    expect(slice.marginBoY).toBeCloseTo(60_000, 2);
  });

  it("a mixed 70% client / 30% trust account carries the whole loan through both deaths", () => {
    const years = runProjection(plan({ spouseDies: true, margin: PROJ_LOAN, owners: [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.7 },
      { kind: "entity", entityId: TRUST, percent: 0.3 },
    ] }));
    // Between the deaths: the trust's slice holds 30%, the survivor's pool 70%.
    for (const year of [2030, 2031]) {
      const y = at(years, year);
      expect(loanBoY(y)).toBeCloseTo(PROJ_LOAN, 2);
      expect(y.accountLedgers[ACC].marginBoY).toBeCloseTo(0.7 * PROJ_LOAN, 2);
    }
    // The projection ends at the final death, so the pool's loan shows in the
    // step-up it gets there: $560k net + $140k loan.
    expect(basisFrom(at(years, 2031).deathTransfers, 2)).toBeCloseTo(560_000 + 140_000, 2);
  });

  it("the hypothetical deaths step up to the LIVE securities value, before and after the real first death", () => {
    // 5% interest moves the live loan off the authored $200k every year, so a
    // death pass that fell back to the account's authored loan would miss it.
    const years = runProjection(plan({ margin: PROJ_LOAN, marginRate: 0.05 }));
    // 2027: both die now. 2030: the frozen real death, then the survivor at N.
    for (const year of [2027, 2030]) {
      const y = at(years, year);
      const l = y.accountLedgers[ACC];
      const securities = l.endingValue + l.marginEoY!;
      expect(l.marginEoY).not.toBeCloseTo(PROJ_LOAN, 0);
      expect(basisFrom(y.hypotheticalEstateTax.primaryFirst.finalDeathTransfers, 2))
        .toBeCloseTo(securities, 2);
    }
  });

  it("today's hypothetical estate counts a margined account at its net value", () => {
    const today = runProjectionWithEvents(plan({ margin: PROJ_LOAN })).todayHypotheticalEstateTax;
    const line = today.primaryFirst.firstDeath.grossEstateLines.find((l) => l.accountId === ACC);
    expect(line?.amount).toBeCloseTo(800_000, 2);
    expect(basisFrom(today.primaryFirst.finalDeathTransfers, 2)).toBeCloseTo(1_000_000, 2);
  });
});
