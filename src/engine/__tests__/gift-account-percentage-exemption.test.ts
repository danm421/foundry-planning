import { describe, it, expect } from "vitest";
import { runProjectionWithEvents } from "../projection";
import type {
  Account, ClientData, ClientInfo, EntitySummary, EstateTaxResult, FamilyMember,
  GiftEvent, PlanSettings,
} from "../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

const clientFm: FamilyMember = {
  id: LEGACY_FM_CLIENT, role: "client", relationship: "other",
  firstName: "Ada", lastName: "Byron", dateOfBirth: "1960-01-01",
};

const client: ClientInfo = {
  firstName: "Ada", lastName: "Byron",
  dateOfBirth: "1960-01-01",
  retirementAge: 65, planEndAge: 95,
  filingStatus: "single",
};

const planSettings: PlanSettings = {
  flatFederalRate: 0,
  flatStateRate: 0,
  inflationRate: 0,
  taxInflationRate: 0,
  planStartYear: 2026,
  planEndYear: 2030,
};

/** Non-Crummey irrevocable trust — every gift to it consumes full exemption,
 *  so the assertions read the gift value directly with no exclusion netting. */
const dynastyTrust = {
  id: "trust-1", name: "Dynasty Trust", entityType: "trust",
  isIrrevocable: true, crummeyPowers: false,
  includeInPortfolio: false, isGrantor: false, beneficiaries: [],
} as unknown as EntitySummary;

/** One $400,000 brokerage account, zero growth, client-owned outright.
 *  Zero growth keeps endingValue at exactly $400,000 in every year. */
function accounts(over: Partial<Account> = {}): Account[] {
  return [{
    id: "brok", name: "Family Brokerage",
    category: "taxable", subType: "brokerage",
    // Inert here — the engine only consults titlingType on joint-household
    // accounts, and this one is 100% client-owned with no spouse in the plan.
    titlingType: "jtwros",
    value: 400_000, basis: 400_000,
    growthRate: 0, rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    ...over,
  }];
}

function makeData(giftEvents: GiftEvent[], acct: Account[] = accounts()): ClientData {
  return {
    client,
    accounts: acct,
    incomes: [], expenses: [], liabilities: [],
    savingsRules: [], withdrawalStrategy: [],
    planSettings,
    familyMembers: [clientFm],
    entities: [dynastyTrust],
    giftEvents,
  } as unknown as ClientData;
}

describe("account-percentage gifts consume real exemption (the () => 0 fix)", () => {
  it("a 25% gift of a $400,000 account consumes $100,000 of exemption — not $0", () => {
    const result = runProjectionWithEvents(makeData([
      { kind: "asset", year: 2028, accountId: "brok", percent: 0.25,
        grantor: "client", recipientEntityId: "trust-1" },
    ]));
    const y = result.giftLedger.find((r) => r.year === 2028)!;
    expect(y.perGrantor.client.taxableGiftsThisYear).toBeCloseTo(100_000, 4);
    expect(y.giftsGiven).toBeCloseTo(100_000, 4);
  });

  it("the same gift at a 30% valuation discount consumes $70,000", () => {
    const result = runProjectionWithEvents(makeData([
      { kind: "asset", year: 2028, accountId: "brok", percent: 0.25,
        grantor: "client", recipientEntityId: "trust-1", valuationDiscount: 0.3 },
    ]));
    const y = result.giftLedger.find((r) => r.year === 2028)!;
    expect(y.perGrantor.client.taxableGiftsThisYear).toBeCloseTo(70_000, 4);
  });

  it("a gift year before planStartYear resolves to 0 without throwing (documented gap)", () => {
    // Pre-plan-start in-kind gifts have no ProjectionYear row to read. They stay
    // at $0 in the ledger by design — advisors capture them via
    // planSettings.priorTaxableGifts on the Assumptions screen instead.
    const data = makeData([
      { kind: "asset", year: 2020, accountId: "brok", percent: 0.25,
        grantor: "client", recipientEntityId: "trust-1" },
    ]);
    expect(() => runProjectionWithEvents(data)).not.toThrow();
    const result = runProjectionWithEvents(data);
    const total = result.giftLedger.reduce(
      (s, r) => s + r.perGrantor.client.taxableGiftsThisYear, 0,
    );
    expect(total).toBe(0);
  });

  it("an account not yet activated in the gift year resolves to 0 (correct — nothing to give)", () => {
    const notYetActive = accounts({ activationYear: 2030 });
    const result = runProjectionWithEvents(makeData([
      { kind: "asset", year: 2027, accountId: "brok", percent: 0.25,
        grantor: "client", recipientEntityId: "trust-1" },
    ], notYetActive));
    const y = result.giftLedger.find((r) => r.year === 2027)!;
    expect(y.perGrantor.client.taxableGiftsThisYear).toBe(0);
  });
});

// ── A gift of a BUSINESS is valued on the whole business ────────────────────
//
// A top-level business account is valued as ONE thing: its own value plus every
// account under it via `parentAccountId`. The gross estate already removes the
// gifted share of that consolidated value; the gift ledger and the adjusted-
// taxable-gifts add-back at death read the parent's own balance, so a gift of a
// business with children left the estate at one value and consumed exemption
// at another.

/** A $`parentValue` top-level business, zero growth, client-owned outright,
 *  plus — when `childValue` is given — one child cash account under it, owned
 *  by the business itself (as the app models a business's own cash). */
function businessTree(parentValue: number, childValue?: number): Account[] {
  const parent = {
    id: "biz", name: "Family LLC",
    category: "business", subType: "llc", businessType: "llc",
    titlingType: "jtwros",
    value: parentValue, basis: parentValue,
    growthRate: 0, rmdEnabled: false,
    parentAccountId: null,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  } as Account;
  if (childValue == null) return [parent];
  const child = {
    id: "biz-cash", name: "Family LLC Cash",
    category: "cash", subType: "checking",
    titlingType: "jtwros",
    value: childValue, basis: childValue,
    growthRate: 0, rmdEnabled: false,
    parentAccountId: "biz",
    owners: [{ kind: "entity", entityId: "biz", percent: 1 }],
  } as Account;
  return [parent, child];
}

const GIFT_15_PCT_OF_BIZ: GiftEvent = {
  kind: "asset", year: 2028, accountId: "biz", percent: 0.15,
  grantor: "client", recipientEntityId: "trust-1",
};

const spouseFm: FamilyMember = {
  id: LEGACY_FM_SPOUSE, role: "spouse", relationship: "other",
  firstName: "William", lastName: "Byron", dateOfBirth: "1962-01-01",
};

/** The client dies in 2029 (1960 + 69), the year after the 2028 gift. Single,
 *  that is the FINAL death; `married` adds a spouse who outlives the horizon,
 *  making it the FIRST death. The two run different death-event code. */
function clientDiesIn2029(data: ClientData, married: boolean): ClientData {
  if (!married) return { ...data, client: { ...data.client, lifeExpectancy: 69 } };
  return {
    ...data,
    client: {
      ...data.client, filingStatus: "married_joint", lifeExpectancy: 69,
      spouseName: "William Byron", spouseDob: "1962-01-01", spouseLifeExpectancy: 95,
    },
    familyMembers: [...(data.familyMembers ?? []), spouseFm],
  };
}

describe("a gift of a business consumes exemption on the value that leaves the estate", () => {
  it("consumes exemption on the CONSOLIDATED business value, matching the estate side", () => {
    // $100M parent + $20M child. The estate side removes 15% × $120M; the gift
    // side consumed exemption on 15% × $100M. Same gift, two values.
    const result = runProjectionWithEvents(
      makeData([GIFT_15_PCT_OF_BIZ], businessTree(100_000_000, 20_000_000)),
    );
    const y = result.giftLedger.find((r) => r.year === 2028)!;
    expect(y.giftsGiven).toBeCloseTo(18_000_000, 2);
    expect(y.perGrantor.client.taxableGiftsThisYear).toBeCloseTo(18_000_000, 2);
  });

  it("is unchanged for a business with no children", () => {
    const result = runProjectionWithEvents(
      makeData([GIFT_15_PCT_OF_BIZ], businessTree(100_000_000)),
    );
    const y = result.giftLedger.find((r) => r.year === 2028)!;
    expect(y.giftsGiven).toBeCloseTo(15_000_000, 2);
    expect(y.perGrantor.client.taxableGiftsThisYear).toBeCloseTo(15_000_000, 2);
  });

  it.each([
    { death: "first", married: true, deathOrder: 1 },
    { death: "final", married: false, deathOrder: 2 },
  ] as const)(
    "adds the gift back at the client's $death death on the same consolidated value",
    ({ married, deathOrder }) => {
      const result = runProjectionWithEvents(clientDiesIn2029(
        makeData([GIFT_15_PCT_OF_BIZ], businessTree(100_000_000, 20_000_000)),
        married,
      ));
      const death = result.years.find((y) => y.year === 2029)!.estateTax!;
      expect(death.deathOrder).toBe(deathOrder);
      expect(death.deceased).toBe("client");
      // §2001(b) add-back: 15% × ($100M + $20M), not 15% × $100M.
      expect(death.adjustedTaxableGifts).toBeCloseTo(18_000_000, 2);
    },
  );
});

// ── …even after the business is sold ────────────────────────────────────────
//
// The gift ledger reads the business tree from the plan's own account list. A
// full sale removes the business AND its children from the death-year account
// list, so a death closure that read the tree from there could no longer find
// the business and fell back to the parent's own balance: the ledger charged
// $18M, the add-back at death $15M. The death closures now read the same list
// the ledger does (`giftValuationAccounts`).

/** Married: 15% of the business gifted in 2028, the whole business sold at the
 *  start of 2029 (proceeds to household checking), deaths from 2030 on. */
function giftThenSell(opts: { clientLE: number; spouseLE: number }): ClientData {
  const checking = {
    id: "hh", name: "Household Checking",
    category: "cash", subType: "checking", titlingType: "jtwros",
    value: 1_000, basis: 1_000, growthRate: 0, rmdEnabled: false,
    isDefaultChecking: true,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  } as Account;
  const data = clientDiesIn2029(
    makeData([GIFT_15_PCT_OF_BIZ], [checking, ...businessTree(100_000_000, 20_000_000)]),
    true,
  );
  return {
    ...data,
    client: { ...data.client, lifeExpectancy: opts.clientLE, spouseLifeExpectancy: opts.spouseLE },
    planSettings: { ...data.planSettings, planEndYear: 2034 },
    assetTransactions: [{
      id: "sell-biz", name: "Sell Family LLC", type: "sell", year: 2029,
      businessAccountId: "biz", proceedsAccountId: "hh",
    }],
  };
}

/** The §2001(b) add-back a death pass computed, rounded to whole dollars. */
const addBack = (et: EstateTaxResult | undefined) =>
  et ? Math.round(et.adjustedTaxableGifts) : undefined;

describe("a business sold between the gift and the death still adds back its consolidated value", () => {
  it("client dies first (2030): the real first death and both 2029 hypothetical orderings", () => {
    const result = runProjectionWithEvents(giftThenSell({ clientLE: 70, spouseLE: 95 }));
    const y2029 = result.years.find((y) => y.year === 2029)!;
    const y2030 = result.years.find((y) => y.year === 2030)!;
    // The sale really happened before anyone died: it cascaded to the child.
    expect(y2029.accountLedgers["biz-cash"]?.endingValue ?? 0).toBe(0);
    expect(y2030.estateTax?.deathOrder).toBe(1);
    expect(y2030.estateTax?.deceased).toBe("client");
    expect({
      realFirstDeath: addBack(y2030.estateTax),
      hypotheticalClientFirst: addBack(y2029.hypotheticalEstateTax.primaryFirst.firstDeath),
      hypotheticalClientSecond: addBack(y2029.hypotheticalEstateTax.spouseFirst?.finalDeath),
    }).toEqual({
      realFirstDeath: 18_000_000,
      hypotheticalClientFirst: 18_000_000,
      hypotheticalClientSecond: 18_000_000,
    });
  });

  it("spouse dies first (2030), client in 2032: the real final death and the anchored hypothetical", () => {
    const result = runProjectionWithEvents(giftThenSell({ clientLE: 72, spouseLE: 68 }));
    const y2031 = result.years.find((y) => y.year === 2031)!;
    const y2032 = result.years.find((y) => y.year === 2032)!;
    expect(result.years.find((y) => y.year === 2030)!.estateTax?.deceased).toBe("spouse");
    expect(y2032.estateTax?.deathOrder).toBe(2);
    expect(y2032.estateTax?.deceased).toBe("client");
    expect({
      realFinalDeath: addBack(y2032.estateTax),
      anchoredHypotheticalClientDeath: addBack(y2031.hypotheticalEstateTax.primaryFirst.finalDeath),
    }).toEqual({
      realFinalDeath: 18_000_000,
      anchoredHypotheticalClientDeath: 18_000_000,
    });
  });
});
