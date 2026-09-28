import { describe, it, expect } from "vitest";
import { entityOwnersForYear, LEGACY_FM_CLIENT } from "../ownership";
import { runProjectionWithEvents } from "../projection";
import type {
  ClientData, ClientInfo, EntitySummary, FamilyMember, GiftEvent, PlanSettings,
} from "../types";

const ENT = { id: "biz-1", owners: [
  { kind: "family_member" as const, familyMemberId: "fm-c", percent: 0.5 },
  { kind: "family_member" as const, familyMemberId: "fm-s", percent: 0.5 },
]};

describe("entityOwnersForYear", () => {
  it("moves the gifted percent from the household to the recipient trust", () => {
    const g: GiftEvent[] = [{ kind: "business_interest", year: 2028, entityId: "biz-1",
      percent: 0.3, grantor: "client", recipientEntityId: "trust-1" }];
    expect(entityOwnersForYear(ENT, g, 2030, 2026)).toEqual([
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.35 },
      { kind: "family_member", familyMemberId: "fm-s", percent: 0.35 },
      { kind: "entity", entityId: "trust-1", percent: 0.3 },
    ]);
  });

  it("does not apply the gift before its year", () => {
    const g: GiftEvent[] = [{ kind: "business_interest", year: 2028, entityId: "biz-1",
      percent: 0.3, grantor: "client", recipientEntityId: "trust-1" }];
    expect(entityOwnersForYear(ENT, g, 2027, 2026)).toEqual(ENT.owners);
  });

  it("ignores a business-interest gift of ANOTHER entity", () => {
    const g: GiftEvent[] = [{ kind: "business_interest", year: 2027, entityId: "biz-2",
      percent: 0.3, grantor: "client", recipientEntityId: "trust-1" }];
    expect(entityOwnersForYear(ENT, g, 2030, 2026)).toEqual(ENT.owners);
  });

  it("ignores an event of another kind even when it carries this entity's id", () => {
    // The three resolvers must not cross-select: each owns exactly one event
    // kind. No well-typed non-business event has an `entityId`, so the cast
    // exists only to reach the kind clause — without it the id clause alone
    // would already reject the event and the kind clause would be unpinned.
    const g = [{ kind: "asset", accountId: "x", entityId: "biz-1", year: 2027,
      percent: 0.3, grantor: "client", recipientEntityId: "trust-1" } as unknown as GiftEvent];
    expect(entityOwnersForYear(ENT, g, 2030, 2026)).toEqual(ENT.owners);
  });

  it("ignores an event dated before projectionStartYear", () => {
    const g: GiftEvent[] = [{ kind: "business_interest", year: 2024, entityId: "biz-1",
      percent: 0.3, grantor: "client", recipientEntityId: "trust-1" }];
    expect(entityOwnersForYear(ENT, g, 2030, 2026)).toEqual(ENT.owners);
  });
});

describe("a business_interest gift with no explicit amount values at the business's worth", () => {
  const clientFm: FamilyMember = {
    id: LEGACY_FM_CLIENT, role: "client", relationship: "other",
    firstName: "Ada", lastName: "Byron", dateOfBirth: "1960-01-01",
  };
  const client: ClientInfo = {
    firstName: "Ada", lastName: "Byron", dateOfBirth: "1960-01-01",
    retirementAge: 65, planEndAge: 95, filingStatus: "single",
  };
  const planSettings: PlanSettings = {
    flatFederalRate: 0, flatStateRate: 0, inflationRate: 0, taxInflationRate: 0,
    planStartYear: 2026, planEndYear: 2030,
  };
  /** A $1,000,000 LLC at 0% growth, no income or expense rows: its cash-flow
   *  row's endingTotalValue is exactly $1,000,000 in every year. */
  const llc = {
    id: "biz-1", name: "Family LLC", entityType: "llc",
    value: 1_000_000, basis: 1_000_000, valueGrowthRate: 0,
    includeInPortfolio: false, isGrantor: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  } as unknown as EntitySummary;
  /** Non-Crummey irrevocable trust — the gift consumes full exemption, so the
   *  taxable figure reads the gift value with no exclusion netting. */
  const dynastyTrust = {
    id: "trust-1", name: "Dynasty Trust", entityType: "trust",
    isIrrevocable: true, crummeyPowers: false,
    includeInPortfolio: false, isGrantor: false, beneficiaries: [],
  } as unknown as EntitySummary;

  it("a 30% gift of a $1,000,000 business with no amountOverride consumes $300,000 — not $0", () => {
    const data = {
      client,
      accounts: [], incomes: [], expenses: [], liabilities: [],
      savingsRules: [], withdrawalStrategy: [],
      planSettings,
      familyMembers: [clientFm],
      entities: [llc, dynastyTrust],
      giftEvents: [{ kind: "business_interest", year: 2028, entityId: "biz-1",
        percent: 0.3, grantor: "client", recipientEntityId: "trust-1" }],
    } as unknown as ClientData;
    const y = runProjectionWithEvents(data).giftLedger.find((r) => r.year === 2028)!;
    expect(y.giftsGiven).toBeCloseTo(300_000, 4);
    expect(y.perGrantor.client.taxableGiftsThisYear).toBeCloseTo(300_000, 4);
  });
});
