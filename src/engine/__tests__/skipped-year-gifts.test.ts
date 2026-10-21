import { describe, it, expect } from "vitest";
import { runProjection, runProjectionWithEvents } from "../projection";
import { giftInEffect, ownersForYear, LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE, type AccountOwner } from "../ownership";
import type {
  Account, ClientData, ClientInfo, EntitySummary, FamilyMember, GiftEvent, PlanSettings,
} from "../types";

// "Start the plan next year": a gift dated in the skipped year already
// happened. It was NOT folded into the stored owners at save (it is not
// entered as history), so the engine applies it from the plan's start — once:
// the trust owns its share from the first plan year, no cash leaves in that
// year, the exemption it used is in the opening total, and at death the asset
// is out of the gross estate while the gift sits in adjusted taxable gifts.

const clientFm: FamilyMember = {
  id: LEGACY_FM_CLIENT, role: "client", relationship: "other",
  firstName: "Ada", lastName: "Byron", dateOfBirth: "1960-01-01",
};
const spouseFm: FamilyMember = {
  id: LEGACY_FM_SPOUSE, role: "spouse", relationship: "other",
  firstName: "Bo", lastName: "Byron", dateOfBirth: "1960-01-01",
};

const single: ClientInfo = {
  firstName: "Ada", lastName: "Byron", dateOfBirth: "1960-01-01",
  retirementAge: 65, planEndAge: 95, lifeExpectancy: 80, // dies 2040
  filingStatus: "single",
};

const nextYear: PlanSettings = {
  flatFederalRate: 0, flatStateRate: 0, inflationRate: 0, taxInflationRate: 0,
  planStartYear: 2027, planEndYear: 2045, dataYear: 2026,
};
const thisYear: PlanSettings = { ...nextYear, planStartYear: 2026, dataYear: 2026 };

/** Non-Crummey irrevocable trust: a gift to it consumes full exemption. */
const trust = {
  id: "trust-1", name: "Dynasty Trust", entityType: "trust",
  isIrrevocable: true, crummeyPowers: false,
  includeInPortfolio: false, isGrantor: false, beneficiaries: [],
} as unknown as EntitySummary;

const clientOnly: AccountOwner[] = [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }];

function brokerage(owners: AccountOwner[] = clientOnly): Account {
  return {
    id: "brok", name: "Family Brokerage", category: "taxable", subType: "brokerage",
    titlingType: "jtwros", value: 1_000_000, basis: 1_000_000, growthRate: 0, rmdEnabled: false,
    owners,
  };
}

function halfToTrust(year: number, enteredAsHistory: boolean | undefined): GiftEvent {
  return {
    kind: "asset", year, accountId: "brok", percent: 0.5, grantor: "client",
    recipientEntityId: "trust-1", sourceGiftId: "g1",
    ...(enteredAsHistory === undefined ? {} : { enteredAsHistory }),
  };
}

function makeData(over: Partial<ClientData>): ClientData {
  return {
    client: single,
    accounts: [brokerage()],
    incomes: [], expenses: [], liabilities: [], savingsRules: [], withdrawalStrategy: [],
    planSettings: nextYear,
    familyMembers: [clientFm],
    entities: [trust],
    giftEvents: [halfToTrust(2026, false)],
    ...over,
  } as ClientData;
}

const householdShare = (owners: AccountOwner[]) =>
  owners.filter((o) => o.kind === "family_member").reduce((s, o) => s + o.percent, 0);

describe("giftInEffect", () => {
  it("applies a gift from its own year when it falls inside the plan", () => {
    expect(giftInEffect(halfToTrust(2030, false), 2029, 2027)).toBe(false);
    expect(giftInEffect(halfToTrust(2030, false), 2030, 2027)).toBe(true);
  });

  it("applies a non-history gift dated before the start from the start", () => {
    expect(giftInEffect(halfToTrust(2026, false), 2027, 2027)).toBe(true);
  });

  it("never applies a gift entered as history, nor a legacy pre-start gift", () => {
    expect(giftInEffect(halfToTrust(2020, true), 2027, 2027)).toBe(false);
    expect(giftInEffect(halfToTrust(2025, undefined), 2027, 2026)).toBe(false);
  });
});

describe("a gift dated in the skipped year", () => {
  it("a non-history gift dated before the start is in effect from the start", () => {
    const owners = ownersForYear(brokerage(), [halfToTrust(2026, false)], 2027, 2027);
    expect(householdShare(owners)).toBeCloseTo(0.5, 10);
    expect(owners.find((o) => o.kind === "entity")?.percent).toBeCloseTo(0.5, 10);

    const [y2027] = runProjection(makeData({}));
    expect(y2027.year).toBe(2027);
    expect(y2027.entityAccountOwners?.get("trust-1")?.get("brok")).toBeCloseTo(0.5, 10);
  });

  it("it books no gifted-out in the first year", () => {
    // Client and spouse each own half; the gift moves half the account to the
    // trust. In the first plan year the family pool already starts at 50%, so
    // its members end the year holding exactly that — nothing more leaves.
    const data = makeData({
      client: { ...single, filingStatus: "married_joint", spouseName: "Bo", spouseDob: "1960-01-01", spouseLifeExpectancy: 95 },
      familyMembers: [clientFm, spouseFm],
      accounts: [brokerage([
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
        { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
      ])],
    });
    const [y2027] = runProjection(data);
    const shares = y2027.familyAccountSharesEoY!;
    expect(shares.get(LEGACY_FM_CLIENT)?.get("brok")).toBeCloseTo(250_000, 0);
    expect(shares.get(LEGACY_FM_SPOUSE)?.get("brok")).toBeCloseTo(250_000, 0);
    expect(y2027.entityAccountSharesEoY?.get("trust-1")?.get("brok")).toBeCloseTo(500_000, 0);
  });

  it("the estate counts it exactly once", () => {
    const { years } = runProjectionWithEvents(makeData({}));
    const death = years.find((y) => y.year === 2040)!.estateTax!;
    // Out of the gross estate: only the household's half remains.
    const brokLines = death.grossEstateLines.filter((l) => l.accountId === "brok");
    expect(brokLines.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(500_000, 0);
    // In adjusted taxable gifts at 50% of the opening value.
    expect(death.adjustedTaxableGifts).toBeCloseTo(500_000, 0);
  });

  it("exemption used includes it", () => {
    const { giftLedger } = runProjectionWithEvents(makeData({}));
    const first = giftLedger[0];
    expect(first.year).toBe(2027);
    expect(first.perGrantor.client.cumulativeTaxableGifts).toBeCloseTo(500_000, 0);
    expect(first.perGrantor.client.taxableGiftsThisYear).toBe(0);
    expect(first.giftsGiven).toBe(0);
  });

  it("is valued at the opening balance even when the account grows", () => {
    const growing = { ...brokerage(), category: "real_estate", subType: "vacation_home", growthRate: 0.05 } as Account;
    const { giftLedger } = runProjectionWithEvents(makeData({ accounts: [growing] }));
    expect(giftLedger[0].perGrantor.client.cumulativeTaxableGifts).toBeCloseTo(500_000, 0);
  });

  it("a non-history gift dated this year runs in its own year when the plan starts this year", () => {
    const events = [halfToTrust(2026, false)];
    expect(householdShare(ownersForYear(brokerage(), events, 2025, 2026))).toBeCloseTo(1, 10);
    expect(householdShare(ownersForYear(brokerage(), events, 2026, 2026))).toBeCloseTo(0.5, 10);
    const { giftLedger } = runProjectionWithEvents(makeData({ planSettings: thisYear }));
    expect(giftLedger[0].year).toBe(2026);
    expect(giftLedger[0].perGrantor.client.taxableGiftsThisYear).toBeCloseTo(500_000, 0);
  });

  it("a gift entered as history is never re-applied after the start year moves", () => {
    const folded = brokerage([
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
      { kind: "entity", entityId: "trust-1", percent: 0.5 },
    ]);
    const events = [halfToTrust(2020, true)];
    for (const start of [2026, 2027]) {
      expect(householdShare(ownersForYear(folded, events, start, start))).toBeCloseTo(0.5, 10);
      const ps = { ...nextYear, planStartYear: start, dataYear: 2026 };
      expect(() => runProjection(makeData({ accounts: [folded], giftEvents: events, planSettings: ps }))).not.toThrow();
    }
  });

  it("legacy gifts without the flag keep today's behavior", () => {
    const events = [halfToTrust(2025, undefined)];
    expect(householdShare(ownersForYear(brokerage(), events, 2026, 2026))).toBeCloseTo(1, 10);
    const { giftLedger } = runProjectionWithEvents(makeData({ planSettings: thisYear, giftEvents: events }));
    expect(giftLedger[0].perGrantor.client.cumulativeTaxableGifts).toBe(0);
  });
});
