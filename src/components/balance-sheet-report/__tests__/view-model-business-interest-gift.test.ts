// src/components/balance-sheet-report/__tests__/view-model-business-interest-gift.test.ts
//
// A gift of an interest in a business ENTITY writes a gift row and no
// `entity_owners` row — owner rows are the authored, pre-gift baseline and the
// gift is an overlay. The household columns and the client/spouse views read
// the business's owner rows, so they must resolve them per year
// (`entityOwnersForYearSafe`) or a 30%-gifted business shows as 100% household.

import { describe, it, expect } from "vitest";
import type { FamilyMember, GiftEvent } from "@/engine/types";
import { buildViewModel, type BuildViewModelInput } from "../view-model";
import { buildHouseholdColumns } from "../household-columns";

const FM_CLIENT = "fm-client";
const FM_SPOUSE = "fm-spouse";

const familyMembers: FamilyMember[] = [
  { id: FM_CLIENT, role: "client", relationship: "child", firstName: "Emmanuel", lastName: null, dateOfBirth: null },
  { id: FM_SPOUSE, role: "spouse", relationship: "child", firstName: "Ana", lastName: null, dateOfBirth: null },
];

/** A $1M flat-valued LLC the client owns outright, beside an irrevocable trust. */
const entities = [
  {
    id: "llc-1", name: "Acme LLC", entityType: "llc", value: 1_000_000, valueGrowthRate: 0,
    owners: [{ kind: "family_member" as const, familyMemberId: FM_CLIENT, percent: 1 }],
  },
  { id: "trust-1", name: "SLAT", entityType: "trust", isIrrevocable: true },
];

function year(y: number) {
  return {
    year: y,
    portfolioAssets: {
      cash: {}, taxable: {}, retirement: {}, realEstate: {}, business: {}, lifeInsurance: {},
      total: 0,
    },
    liabilityBalancesBoY: {},
    accountLedgers: {},
  };
}
const projectionYears = [year(2026), year(2027)];

/** 30% of the LLC to the trust in the first projection year. */
const GIFT: GiftEvent = {
  kind: "business_interest", year: 2026, entityId: "llc-1", percent: 0.3,
  grantor: "client", recipientEntityId: "trust-1",
};

function householdColumns(giftEvents: GiftEvent[], asOfMode: "today" | "eoy" = "eoy") {
  const model = buildHouseholdColumns({
    accounts: [], liabilities: [], entities, notesReceivable: [], familyMembers,
    projectionYears, selectedYear: 2027, asOfMode, giftEvents,
  });
  return model.assetCategories.flatMap((c) => c.rows).find((r) => r.key === "flat:llc-1");
}

function clientView(giftEvents: GiftEvent[]) {
  const model = buildViewModel({
    accounts: [], liabilities: [], entities, familyMembers, projectionYears,
    selectedYear: 2027, view: "client", asOfMode: "eoy", giftEvents,
  } as BuildViewModelInput);
  return model.assetCategories.find((c) => c.key === "business")?.total ?? 0;
}

describe("balance sheet after a gift of an interest in a business entity", () => {
  it("credits the household column only the retained 70%", () => {
    expect(householdColumns([GIFT])?.client).toBeCloseTo(700_000, 2);
    expect(householdColumns([])?.client).toBeCloseTo(1_000_000, 2);
  });

  it("credits the client view only the retained 70%", () => {
    expect(clientView([GIFT])).toBeCloseTo(700_000, 2);
    expect(clientView([])).toBeCloseTo(1_000_000, 2);
  });

  it("drops the business from the household table once all of it is gifted", () => {
    const all: GiftEvent = { ...GIFT, percent: 1 };
    expect(householdColumns([all])).toBeUndefined();
    expect(clientView([all])).toBe(0);
  });

  it("reads the authored owners for the Today snapshot, as the accounts do", () => {
    // "Today" is the plan's opening balance sheet; the gift lands during it.
    expect(householdColumns([GIFT], "today")?.client).toBeCloseTo(1_000_000, 2);
  });
});
