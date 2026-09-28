// src/engine/__tests__/gift-overlay-cross-surface.test.ts
//
// THE STRUCTURAL GUARD.
//
// A mid-horizon gift moves 40% of one account into one trust. Five surfaces
// compute that trust's holding independently:
//
//   1. the balance sheet        — accountSlicesAtYear (ownersForYear + resolveOwnerSlices)
//   2. the trust's cash flow    — year.entityCashFlow
//   3. the locked share         — year.entityAccountSharesEoY
//   4. the family shares ledger — year.familyAccountSharesEoY (the OTHER side of the split)
//   5. the Cash Flow portfolio  — year.portfolioAssets (trusts bucket + household bucket)
//
// They MUST agree. They did not: the balance sheet showed the trust holding
// the account while its own cash-flow page showed $0, because two of the
// surfaces read a year-invariant owner map built from the AUTHORED owners. The
// portfolio kept doing it longest: its post-pass picked split accounts off
// `acct.owners`, so a gifted account (authored 100% household) was never
// re-split, and the trust's bucket decayed with every household draw while the
// trust's own row held its locked share.
//
// If this test fails, some surface has gone back to reading `account.owners`
// directly. Find it before changing this file:
//   - surfaces 2-4 resolve owners through `liveOwnersAt` in projection.ts
//     (the ownership snapshot, or the owners the loop published);
//   - surface 5 is projection.ts's "Post-pass: rewrite portfolioAssets", which
//     must resolve owners the same way;
//   - the balances themselves depend on the in-loop withdraw cap and the EoY
//     carry roll, both of which ask `ownershipSnapshot.ownersAt`.
// The checks are soft and labelled with the surface number, so one failing run
// lists EVERY surface that disagrees — start from the odd one out.
//
// Every number is hand-derived in the comments. The main fixture has no
// growth, no income and no death, so only the gift can produce its numbers;
// the carried cases at the bottom add one death each. Do not loosen a number
// to go green.

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { ownersForYear, LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { accountSlicesAtYear } from "@/lib/estate/account-owner-slices";
import type {
  Account,
  ClientData,
  EntitySummary,
  Expense,
  FamilyMember,
  GiftEvent,
  ProjectionYear,
} from "../types";

const TRUST = "trust-slat";
const ACC = "acc-brokerage";
const FM_CLIENT = "fm-client";
const FM_SPOUSE = "fm-spouse";
const PLAN_START = 2026;
const PLAN_END = 2035;
const GIFT_YEAR = 2030;
const GIFT_PCT = 0.4;
const START_VALUE = 10_000_000;
/** The trust's holding from the gift on: 40% of a $10M account nothing moves. */
const TRUST_SHARE = START_VALUE * GIFT_PCT; // 4,000,000

// Not in the household's portfolio and not accessible to it: an IIP trust is
// bundled into the household bucket, which would hide the slice on surface 5.
const slat: EntitySummary = {
  id: TRUST, name: "SLAT", entityType: "trust", trustSubType: "irrevocable",
  isIrrevocable: true, isGrantor: false, includeInPortfolio: false,
  accessibleToClient: false, grantor: "client",
};

/** One $10M joint account (joint, so the family ledger — surface 4 — exists:
 *  it books only accounts with two family owners), one trust, one 40% gift in
 *  2030. No growth, no income, no death (no life expectancy is set). `spend`
 *  adds a household need drawn from the account after the gift — the only
 *  way to tell a locked share from `balance × percent`. */
function fixture(opts: { spendPerYear?: number } = {}): ClientData {
  const account: Account = {
    id: ACC, name: "Brokerage", category: "taxable", subType: "brokerage",
    titlingType: "jtwros", value: START_VALUE, basis: START_VALUE,
    growthRate: 0, rmdEnabled: false,
    owners: [
      { kind: "family_member", familyMemberId: FM_CLIENT, percent: 0.5 },
      { kind: "family_member", familyMemberId: FM_SPOUSE, percent: 0.5 },
    ],
  };
  const checking: Account = {
    id: "acc-checking", name: "Checking", category: "cash", subType: "checking",
    titlingType: "jtwros", value: 0, basis: 0, growthRate: 0, rmdEnabled: false,
    isDefaultChecking: true,
    owners: [
      { kind: "family_member", familyMemberId: FM_CLIENT, percent: 0.5 },
      { kind: "family_member", familyMemberId: FM_SPOUSE, percent: 0.5 },
    ],
  };
  const familyMembers: FamilyMember[] = [
    { id: FM_CLIENT, role: "client", relationship: "other",
      firstName: "Guard", lastName: "Test", dateOfBirth: "1970-01-01" },
    { id: FM_SPOUSE, role: "spouse", relationship: "other",
      firstName: "Guard", lastName: "Spouse", dateOfBirth: "1972-06-15" },
  ];
  const expenses: Expense[] = opts.spendPerYear
    ? [{ id: "need", name: "Living", type: "living", annualAmount: opts.spendPerYear,
        growthRate: 0, startYear: GIFT_YEAR + 1, endYear: PLAN_END }]
    : [];
  const gift: GiftEvent = {
    kind: "asset", year: GIFT_YEAR, accountId: ACC, percent: GIFT_PCT,
    grantor: "client", recipientEntityId: TRUST,
  };
  return buildClientData({
    client: { ...baseClient, dateOfBirth: "1970-01-01" },
    familyMembers,
    // A checking account only for the spending arm: the need is paid from it
    // and refilled from the account, and it takes the shortfall once the
    // household's own share is spent.
    accounts: opts.spendPerYear ? [checking, account] : [account],
    entities: [slat],
    incomes: [], expenses, liabilities: [], savingsRules: [],
    withdrawalStrategy: [{ accountId: ACC, priorityOrder: 1, startYear: PLAN_START, endYear: PLAN_END }],
    giftEvents: [gift],
    planSettings: {
      ...basePlanSettings, flatFederalRate: 0, flatStateRate: 0, inflationRate: 0,
      planStartYear: PLAN_START, planEndYear: PLAN_END,
    },
  });
}

/** Each surface's own reading of what the trust holds in `ACC`, plus the
 *  household side where the surface has one. */
function readSurfaces(data: ClientData, y: ProjectionYear) {
  const account = data.accounts.find((a) => a.id === ACC)!;
  const value = y.accountLedgers[ACC].endingValue;

  // 1 — the balance sheet, called the way its view-model calls it (EoY).
  const slices = accountSlicesAtYear({
    account,
    yearRow: y,
    valueOf: (id) => y.accountLedgers[id]?.endingValue ?? 0,
    fallbackOwners: () => ownersForYear(account, data.giftEvents ?? [], y.year, PLAN_START),
  });
  const balanceSheet = slices
    .filter((s) => s.owner.kind === "entity" && s.owner.entityId === TRUST)
    .reduce((sum, s) => sum + s.value, 0);

  // 2 — the trust's own cash flow.
  const row = y.entityCashFlow.get(TRUST);
  const cashFlow = row?.kind === "trust" ? row.endingBalance : 0;

  // 3 — the locked entity share.
  const locked = y.entityAccountSharesEoY?.get(TRUST)?.get(ACC) ?? 0;

  // 4 — the family ledger: both spouses' shares, the OTHER side of the split.
  const family = [FM_CLIENT, FM_SPOUSE].reduce(
    (sum, fm) => sum + (y.familyAccountSharesEoY?.get(fm)?.get(ACC) ?? 0),
    0,
  );

  // 5 — the Cash Flow portfolio: the trust's bucket, and the household's.
  const portfolioTrust = y.portfolioAssets.trustsAndBusinesses[ACC] ?? 0;
  const portfolioHousehold = y.portfolioAssets.taxable[ACC] ?? 0;

  return { value, balanceSheet, cashFlow, locked, family, portfolioTrust, portfolioHousehold };
}

/** Every surface against the one split, SOFT so a failure names each surface
 *  that disagrees — which is the diagnosis, not just the first symptom. */
function expectOneSplit(
  s: ReturnType<typeof readSurfaces>,
  split: { value: number; trust: number; household: number },
) {
  expect.soft(s.value, "the account's balance").toBeCloseTo(split.value, 2);
  expect.soft(s.balanceSheet, "1 balance sheet — the trust's slice").toBeCloseTo(split.trust, 2);
  expect.soft(s.cashFlow, "2 trust cash flow — endingBalance").toBeCloseTo(split.trust, 2);
  expect.soft(s.locked, "3 locked share — entityAccountSharesEoY").toBeCloseTo(split.trust, 2);
  expect.soft(s.family, "4 family ledger — familyAccountSharesEoY").toBeCloseTo(split.household, 2);
  expect.soft(s.portfolioTrust, "5 portfolio — trustsAndBusinesses").toBeCloseTo(split.trust, 2);
  expect.soft(s.portfolioHousehold, "5 portfolio — taxable").toBeCloseTo(split.household, 2);
}

const yearOf = (years: ProjectionYear[], year: number) => {
  const y = years.find((r) => r.year === year);
  if (!y) throw new Error(`no projection row for ${year}`);
  return y;
};

describe("gift overlay — every surface reports the same number", () => {
  // The brief's checks, on a fixture where nothing is drawn. Here the in-loop
  // snapshot's `balance × 40%` IS the lock, so these cannot tell surface 5
  // from a post-pass that ignores the gift: the spending arm below carries the
  // surface-5 discrimination. What each check here does catch (measured):
  //   - "the year AFTER" and "does not decay": flipping the post-loop
  //     resolver's snapshot read (`liveOwnersAt`) to `acct.owners` reds
  //     surfaces 2, 3 and 4 and the no-decay lock (0, not > 0);
  //   - "the year BEFORE": a snapshot that answers the gift in every year
  //     (the step lookup ignoring `from <= year`) reds surfaces 2, 3, 4 and 5.
  // The two portfolio lines of "does not decay" are controls here: 4M comes
  // out of the in-loop snapshot with or without the post-pass.
  const data = fixture();
  const years = runProjection(data);

  it("agrees across all five surfaces in the year AFTER the gift", () => {
    // Nothing moves the account, and the overlay gives the trust 40% of it.
    const overlay = ownersForYear(data.accounts.find((a) => a.id === ACC)!, data.giftEvents ?? [], GIFT_YEAR + 1, PLAN_START);
    const trustPercent = overlay
      .filter((o) => o.kind === "entity" && o.entityId === TRUST)
      .reduce((sum, o) => sum + o.percent, 0);
    expect(trustPercent).toBeCloseTo(GIFT_PCT, 9);
    expectOneSplit(readSurfaces(data, yearOf(years, GIFT_YEAR + 1)), {
      value: START_VALUE, trust: TRUST_SHARE, household: START_VALUE - TRUST_SHARE,
    });
  });

  it("reports ZERO on every surface in the year BEFORE the gift", () => {
    expectOneSplit(readSurfaces(data, yearOf(years, GIFT_YEAR - 1)), {
      value: START_VALUE, trust: 0, household: START_VALUE,
    });
  });

  it("does not decay the trust's share over the remaining horizon", () => {
    // The locked-share defect: lockedTotal stayed 0, so the household cap was
    // re-derived against a SHRINKING balance every year and the trust's slice
    // decayed geometrically toward zero.
    const first = readSurfaces(data, yearOf(years, GIFT_YEAR));
    const last = readSurfaces(data, yearOf(years, PLAN_END));
    expect(first.locked).toBeGreaterThan(0);
    expect(last.locked).toBeCloseTo(first.locked, 2);
    expect(first.portfolioTrust).toBeCloseTo(first.locked, 2);
    expect(last.portfolioTrust).toBeCloseTo(first.locked, 2);
  });
});

describe("gift overlay — the surfaces still agree while the household spends the account down", () => {
  // $2M a year of household need from 2031, drawn from the account. The
  // household may spend only its own $6M: the withdraw cap is
  // min(balance × 0.6, balance − the trust's $4M lock).
  //   2031  cap min(6.0M, 6M) = 6M → draws 2M → 8M
  //   2032  cap min(4.8M, 4M) = 4M → draws 2M → 6M
  //   2033  cap min(3.6M, 2M) = 2M → draws 2M → 4M
  //   2034  cap min(2.4M, 0)  = 0  → 4M (the need lands in checking)
  //   2035  cap 0 → 4M
  // The trust holds $4M on every surface throughout; the household holds the
  // rest. A surface that values the trust at balance × 40% instead shows
  // 3.2M, 2.4M, 1.6M, 1.6M, 1.6M — the decay.
  const data = fixture({ spendPerYear: 2_000_000 });
  const years = runProjection(data);
  const expectedValue: Record<number, number> = {
    2030: 10_000_000, 2031: 8_000_000, 2032: 6_000_000,
    2033: 4_000_000, 2034: 4_000_000, 2035: 4_000_000,
  };

  for (const year of Object.keys(expectedValue).map(Number)) {
    it(`${year}: the trust holds $4M on all five surfaces, the household the rest`, () => {
      expectOneSplit(readSurfaces(data, yearOf(years, year)), {
        value: expectedValue[year], trust: TRUST_SHARE, household: expectedValue[year] - TRUST_SHARE,
      });
    });
  }
});

// ── Carried cases: the portfolio post-pass on accounts gifted around a death
// and on accounts with a second, authored trust row. Legacy principal ids and
// the death-partition fixture shape (client born 1960, spouse 1972).

const FAMILY: FamilyMember[] = [
  { id: LEGACY_FM_CLIENT, role: "client", relationship: "other",
    firstName: "Client", lastName: "Test", dateOfBirth: "1960-01-01" },
  { id: LEGACY_FM_SPOUSE, role: "spouse", relationship: "other",
    firstName: "Spouse", lastName: "Test", dateOfBirth: "1972-06-15" },
];
const irrevocable = (id: string, name: string): EntitySummary => ({
  id, name, entityType: "trust", trustSubType: "irrevocable", isIrrevocable: true,
  isGrantor: false, includeInPortfolio: false, accessibleToClient: false, grantor: "client",
});
const legacyChecking = (): Account => ({
  id: "acct-checking", name: "Checking", category: "cash", subType: "checking",
  titlingType: "jtwros", value: 1000, basis: 1000, growthRate: 0,
  rmdEnabled: false, isDefaultChecking: true,
  owners: [
    { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
    { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
  ],
});
const trustRow = (y: ProjectionYear, entityId: string) => {
  const row = y.entityCashFlow.get(entityId);
  return row?.kind === "trust" ? row.endingBalance : 0;
};

describe("gift overlay — a pool gifted AFTER a death splits on the portfolio as it is locked", () => {
  // $1M authored [client 70%, trust A 30%], growth 0, $200k/yr need from it.
  // The client dies in 2026 (1960 + 66): trust A's 30% is peeled into its own
  // 100% slice (300k) and the pool keeps the account id, the survivor's.
  //   2026  1,000,000 − 199,000 drawn (1,000 in checking) = 801,000 → pool 501,000
  //   2027  501,000 − 200,000 = 301,000
  //   2028  the survivor gives 25% of the pool to trust B: lock 25% × 301,000 BoY
  //         = 75,250; cap min(301,000 × 0.75, 301,000 − 75,250) = 225,750 ≥ 200k
  //         → pool 101,000 = household 25,750 + trust B 75,250
  //   2029+ cap min(101,000 × 0.75, 101,000 − 75,250) = 25,750 → pool 75,250,
  //         all of it trust B's, flat to the horizon.
  // The in-loop snapshot values trust B at pool × 25% — 25,250 in 2028 and
  // 18,812.50 after — the decay shape the lock exists to stop.
  const POOL = "acct-mixed";
  const TRUST_A = "trust-a";
  const TRUST_B = "trust-b";
  const data = buildClientData({
    client: { ...baseClient, dateOfBirth: "1960-01-01", spouseDob: "1972-06-15",
      lifeExpectancy: 66, spouseLifeExpectancy: undefined },
    familyMembers: FAMILY,
    accounts: [legacyChecking(), {
      id: POOL, name: "Joint+SLAT Brokerage", category: "taxable", subType: "brokerage",
      titlingType: "jtwros", value: 1_000_000, basis: 1_000_000, growthRate: 0, rmdEnabled: false,
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.7 },
        { kind: "entity", entityId: TRUST_A, percent: 0.3 },
      ],
    }],
    entities: [irrevocable(TRUST_A, "Locked SLAT"), irrevocable(TRUST_B, "Trust Two")],
    incomes: [], liabilities: [], savingsRules: [],
    expenses: [{ id: "need", name: "Living", type: "living", annualAmount: 200_000,
      growthRate: 0, startYear: 2026, endYear: 2034 }],
    withdrawalStrategy: [{ accountId: POOL, priorityOrder: 1, startYear: 2026, endYear: 2034 }],
    giftEvents: [{ kind: "asset", year: 2028, accountId: POOL, percent: 0.25,
      grantor: "spouse", recipientEntityId: TRUST_B }],
    planSettings: { ...basePlanSettings, flatFederalRate: 0, flatStateRate: 0,
      planStartYear: 2026, planEndYear: 2034 },
  });
  const years = runProjection(data);

  const expectPoolSplit = (year: number, split: { pool: number; trustB: number; household: number }) => {
    const y = yearOf(years, year);
    expect.soft(y.accountLedgers[POOL].endingValue, `${year} the pool's balance`).toBeCloseTo(split.pool, 2);
    expect.soft(trustRow(y, TRUST_B), `${year} 2 trust B cash flow`).toBeCloseTo(split.trustB, 2);
    expect.soft(y.entityAccountSharesEoY?.get(TRUST_B)?.get(POOL) ?? 0, `${year} 3 trust B locked share`)
      .toBeCloseTo(split.trustB, 2);
    expect.soft(y.portfolioAssets.trustsAndBusinesses[POOL] ?? 0, `${year} 5 portfolio — trustsAndBusinesses`)
      .toBeCloseTo(split.trustB, 2);
    expect.soft(y.portfolioAssets.taxable[POOL] ?? 0, `${year} 5 portfolio — taxable`)
      .toBeCloseTo(split.household, 2);
  };

  it("gives trust B its 75,250 lock and the survivor the 25,750 rest in the gift year", () => {
    expectPoolSplit(2028, { pool: 101_000, trustB: 75_250, household: 25_750 });
  });

  it("keeps the whole 75,250 pool in trust B's bucket once the survivor has spent down to it", () => {
    for (const year of [2029, 2034]) expectPoolSplit(year, { pool: 75_250, trustB: 75_250, household: 0 });
  });
});

describe("gift overlay — a gift to a second trust of an account a first trust already part-owns", () => {
  // $1M authored [client 80%, trust 2 20%], growth 0. The client gives 30% to
  // trust 1 in 2027 → [client 50%, trust 2 20%, trust 1 30%]. The client dies
  // in 2029 (1960 + 69); the spouse outlives the horizon.
  //   2027–28  household 500k, trusts 200k + 300k = 500k
  //   2029     the death peels each trust's share into its own slice; the 500k
  //            pool is the survivor's — the same 500k + 500k
  // Reading only the AUTHORED entity row re-split the account around trust
  // 2's 200k alone and put trust 1's 300k back in the household bucket:
  // 800k + 200k in 2027–28. (The death year already held: the post-pass
  // skips an account the death routed.)
  const ACCT = "acct-x";
  const T1 = "trust-1";
  const T2 = "trust-2";
  const data = buildClientData({
    client: { ...baseClient, dateOfBirth: "1960-01-01", spouseDob: "1972-06-15",
      lifeExpectancy: 69, spouseLifeExpectancy: 95 },
    familyMembers: FAMILY,
    accounts: [legacyChecking(), {
      id: ACCT, name: "Brokerage", category: "taxable", subType: "brokerage",
      titlingType: "jtwros", value: 1_000_000, basis: 400_000, growthRate: 0, rmdEnabled: false,
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.8 },
        { kind: "entity", entityId: T2, percent: 0.2 },
      ],
    }],
    entities: [irrevocable(T1, "Trust One"), irrevocable(T2, "Trust Two")],
    incomes: [], expenses: [], liabilities: [], savingsRules: [],
    withdrawalStrategy: [{ accountId: ACCT, priorityOrder: 1, startYear: 2026, endYear: 2031 }],
    giftEvents: [{ kind: "asset", year: 2027, accountId: ACCT, percent: 0.3,
      grantor: "client", recipientEntityId: T1 }],
    planSettings: { ...basePlanSettings, flatFederalRate: 0, flatStateRate: 0,
      planStartYear: 2026, planEndYear: 2031 },
  });
  const years = runProjection(data);

  // Trust 2's row, and the household total in 2029, are CONTROLS: no mutation
  // we know of reds them; they hold the fixture's shape. Trust 2's share is
  // authored, and in the death year the post-pass skips the account the death
  // routed — deleting that skip reds 2029's trusts total (1,000,000: the
  // slices plus a re-split of the pre-death ledger).
  for (const year of [2027, 2028, 2029]) {
    it(`${year}: shows 500k household and 500k in trusts on the $1M account`, () => {
      const y = yearOf(years, year);
      expect.soft(trustRow(y, T1), "2 trust 1 cash flow").toBeCloseTo(300_000, 2);
      expect.soft(trustRow(y, T2), "2 trust 2 cash flow (control)").toBeCloseTo(200_000, 2);
      expect.soft(y.portfolioAssets.taxableTotal, "5 portfolio — taxable").toBeCloseTo(500_000, 2);
      expect.soft(y.portfolioAssets.trustsAndBusinessesTotal, "5 portfolio — trustsAndBusinesses")
        .toBeCloseTo(500_000, 2);
    });
  }
});

describe("gift overlay — a partly gifted note receivable or 529 stays out of the portfolio", () => {
  // Neither category has a portfolio bucket: the snapshot leaves the account
  // out of every bucket. Re-splitting a gifted one around its lock fell back to
  // `taxable` for a category with no bucket, which put the household's 60% of
  // a $1M note — $600k — into the liquid portfolio from the gift year on.
  // Control: the same plan without the account. Adding it must not move the
  // portfolio.
  const OTHER = "acc-not-portfolio";
  const control = fixture();
  const controlYears = runProjection(control);

  for (const [category, subType] of [["notes_receivable", "other"], ["education_savings", "529"]] as const) {
    it(`${category}: no household bucket in any year, and the liquid total the control has`, () => {
      const data: ClientData = {
        ...control,
        accounts: [...control.accounts, {
          id: OTHER, name: category, category, subType, titlingType: "jtwros",
          value: 1_000_000, basis: 1_000_000, growthRate: 0, rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: FM_CLIENT, percent: 1 }],
        }],
        giftEvents: [...(control.giftEvents ?? []), {
          kind: "asset", year: GIFT_YEAR, accountId: OTHER, percent: GIFT_PCT,
          grantor: "client", recipientEntityId: TRUST,
        }],
      };
      const years = runProjection(data);
      // Not vacuous: the gift landed — the trust holds a $400k lock on it.
      expect(yearOf(years, GIFT_YEAR + 1).entityAccountSharesEoY?.get(TRUST)?.get(OTHER))
        .toBeCloseTo(400_000, 2);
      for (const y of years) {
        const c = yearOf(controlYears, y.year);
        expect.soft(y.portfolioAssets.taxable[OTHER], `${y.year} 5 portfolio — taxable`).toBeUndefined();
        expect.soft(y.portfolioAssets.liquidTotal, `${y.year} 5 portfolio — liquidTotal`)
          .toBeCloseTo(c.portfolioAssets.liquidTotal, 2);
      }
    });
  }
});
