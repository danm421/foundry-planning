import { describe, it, expect } from "vitest";
import { runProjectionWithEvents } from "../projection";
import type {
  Account, ClientData, ClientInfo, EntitySummary, FamilyMember,
  GiftEvent, PlanSettings,
} from "../types";
import { LEGACY_FM_CLIENT } from "../ownership";

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
