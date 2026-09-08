import { describe, it, expect } from "vitest";
import type {
  Account, ClientData, ClientInfo, EntitySummary, FamilyMember,
  GiftEvent, PlanSettings,
} from "../types";
import { LEGACY_FM_CLIENT, ownersForYear } from "../ownership";
import { runProjectionWithEvents } from "../projection";

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
  flatFederalRate: 0, flatStateRate: 0,
  inflationRate: 0, taxInflationRate: 0,
  planStartYear: 2026, planEndYear: 2030,
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
const brokerage: Account = {
  id: "brok", name: "Family Brokerage",
  category: "taxable", subType: "brokerage",
  // Inert here — the engine only consults titlingType on joint-household
  // accounts, and this one is 100% client-owned with no spouse in the plan.
  titlingType: "jtwros",
  value: 400_000, basis: 400_000,
  growthRate: 0, rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const plainGift: GiftEvent = {
  kind: "asset", year: 2028, accountId: "brok", percent: 0.4,
  grantor: "client", recipientEntityId: "trust-1",
};
const discountedGift: GiftEvent = { ...plainGift, valuationDiscount: 0.45 };

describe("valuation discount NEVER touches ownership", () => {
  it("ownersForYear produces identical owner percentages with and without a discount", () => {
    const withDiscount = ownersForYear(brokerage, [discountedGift], 2029, 2026);
    const without = ownersForYear(brokerage, [plainGift], 2029, 2026);
    expect(withDiscount).toEqual(without);
  });

  it("the recipient trust's percentage is the FULL gifted percent, not the discounted one", () => {
    const owners = ownersForYear(brokerage, [discountedGift], 2029, 2026);
    const trustRow = owners.find((o) => o.kind === "entity")!;
    expect(trustRow.percent).toBeCloseTo(0.4, 6);
    // The discounted percent (0.4 × 0.55 = 0.22) must NOT appear anywhere.
    expect(trustRow.percent).not.toBeCloseTo(0.22, 4);
    const householdShare = owners
      .filter((o) => o.kind === "family_member")
      .reduce((s, o) => s + o.percent, 0);
    expect(householdShare).toBeCloseTo(0.6, 6);
  });
});

describe("valuation discount NEVER touches the balance sheet", () => {
  function project(gift: GiftEvent) {
    return runProjectionWithEvents({
      client,
      accounts: [brokerage],
      incomes: [], expenses: [], liabilities: [],
      savingsRules: [], withdrawalStrategy: [],
      planSettings,
      familyMembers: [clientFm],
      entities: [dynastyTrust],
      giftEvents: [gift],
    } as unknown as ClientData);
  }

  it("the account's ending value in the gift year is the same with or without a discount", () => {
    const a = project(discountedGift).years.find((y) => y.year === 2028)!;
    const b = project(plainGift).years.find((y) => y.year === 2028)!;
    expect(a.accountLedgers["brok"].endingValue).toBeCloseTo(
      b.accountLedgers["brok"].endingValue, 4,
    );
    expect(a.accountLedgers["brok"].endingValue).toBeCloseTo(400_000, 4);
  });

  it("the trust receives $160,000 of value (40% of $400,000) while consuming $88,000 of exemption", () => {
    const result = project(discountedGift);
    const owners = ownersForYear(brokerage, [discountedGift], 2028, 2026);
    const trustPct = owners.find((o) => o.kind === "entity")!.percent;
    const endingValue = result.years.find((y) => y.year === 2028)!
      .accountLedgers["brok"].endingValue;

    // Balance sheet: full value.
    expect(endingValue * trustPct).toBeCloseTo(160_000, 4);
    // Transfer tax: discounted value. THIS gap is the strategy.
    const taxable = result.giftLedger.find((r) => r.year === 2028)!
      .perGrantor.client.taxableGiftsThisYear;
    expect(taxable).toBeCloseTo(88_000, 4);
    expect(endingValue * trustPct - taxable).toBeCloseTo(72_000, 4);
  });
});
