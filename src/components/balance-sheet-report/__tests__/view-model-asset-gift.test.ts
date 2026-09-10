// src/components/balance-sheet-report/__tests__/view-model-asset-gift.test.ts
//
// A percentage of an asset gifted during life must leave the household's
// balance sheet. `buildViewModel` read the authored `acct.owners`, so a $100M
// LLC gifted 15% to an IDGT in 2026 still showed the household owning the full
// $100M in 2027 and every year after — while the gift-tax side correctly
// charged $15M against lifetime exemption.
//
// Ownership is now resolved per picked year via `ownersForYearSafe`, the same
// resolver the estate-flow report and the death-time gross estate use.

import { describe, it, expect } from "vitest";
import type { FamilyMember, GiftEvent } from "@/engine/types";
import type { AccountOwner } from "@/engine/ownership";
import { buildViewModel, type BuildViewModelInput } from "../view-model";
import { buildHouseholdColumns } from "../household-columns";

const FM_CLIENT = "fm-client";

const familyMembers: FamilyMember[] = [
  { id: FM_CLIENT, role: "client", relationship: "child", firstName: "Emmanuel", lastName: null, dateOfBirth: null },
];

const clientOnly: AccountOwner[] = [
  { kind: "family_member", familyMemberId: FM_CLIENT, percent: 1 },
];

const accounts = [
  {
    id: "biz-1",
    name: "Whatnot",
    category: "business",
    owners: clientOnly,
    parentAccountId: null,
    businessType: "llc",
    titlingType: null,
  },
];

const entities = [
  { id: "trust-1", name: "New Trust", entityType: "trust", isIrrevocable: true },
];

function year(y: number) {
  return {
    year: y,
    portfolioAssets: {
      cash: {}, taxable: {}, retirement: {}, realEstate: {},
      business: { "biz-1": 100_000_000 }, lifeInsurance: {},
      total: 100_000_000,
    },
    liabilityBalancesBoY: {},
    accountLedgers: {
      "biz-1": { beginningValue: 100_000_000, endingValue: 100_000_000 },
    },
  };
}

const projectionYears = [year(2026), year(2027)];

/** 15% of the LLC to an irrevocable trust, in the first projection year. */
const GIFT: GiftEvent = {
  kind: "asset",
  year: 2026,
  accountId: "biz-1",
  percent: 0.15,
  grantor: "client",
  recipientEntityId: "trust-1",
  valuationDiscount: 0.3,
  eventKind: "outright",
};

function vm(overrides: Partial<BuildViewModelInput> = {}) {
  return buildViewModel({
    accounts, liabilities: [], entities, familyMembers, projectionYears,
    selectedYear: 2027, view: "consolidated", asOfMode: "eoy",
    giftEvents: [GIFT],
    ...overrides,
  } as BuildViewModelInput);
}

function businessTotal(model: ReturnType<typeof buildViewModel>): number {
  return model.assetCategories.find((c) => c.key === "business")?.total ?? 0;
}

describe("balance sheet after a percentage gift of an asset", () => {
  it("leaves the household only the retained share", () => {
    expect(businessTotal(vm())).toBeCloseTo(85_000_000, 2);
  });

  it("routes the gifted share to out-of-estate under the recipient trust", () => {
    const model = vm();
    const trustOwner = model.outOfEstateOwnerRows?.find((r) => r.ownerName === "New Trust");
    expect(trustOwner, "the IDGT should hold the gifted share out of estate").toBeDefined();
    expect(trustOwner!.assetTotal).toBeCloseTo(15_000_000, 2);
  });

  it("still shows the full value before the gift year", () => {
    // "Today" reads the first projection year — the gift lands during 2026, so
    // the opening snapshot is pre-gift.
    const model = vm({ selectedYear: 2026, asOfMode: "today" });
    expect(businessTotal(model)).toBeCloseTo(100_000_000, 2);
  });

  it("shows the full value when there is no gift", () => {
    expect(businessTotal(vm({ giftEvents: [] }))).toBeCloseTo(100_000_000, 2);
  });

  it("drops the gifted share out of the per-person household columns", () => {
    const model = buildHouseholdColumns({
      accounts, liabilities: [], entities, notesReceivable: [], familyMembers,
      projectionYears, selectedYear: 2027, asOfMode: "eoy", giftEvents: [GIFT],
    });
    expect(model.totalAssets.total).toBeCloseTo(85_000_000, 2);
    const bizRow = model.assetCategories
      .flatMap((c) => c.rows)
      .find((r) => r.key === "biz-1");
    expect(bizRow!.client).toBeCloseTo(85_000_000, 2);
  });
});

describe("balance sheet after a percentage gift to a PERSON", () => {
  // A gift to a person resolves to a `gifted_away` owner rather than an
  // `entity` one. `resolveOwnerSlices` deliberately subtracts those dollars
  // from the family pool, so nothing else absorbs them — if the row isn't
  // emitted, 15% of the estate simply disappears from the report.
  const TO_CHILD: GiftEvent = {
    kind: "asset", year: 2026, accountId: "biz-1", percent: 0.15,
    grantor: "client", recipientFamilyMemberId: "fm-child", eventKind: "outright",
  };

  it("keeps the gifted share visible as out-of-estate", () => {
    const model = buildViewModel({
      accounts, liabilities: [], entities, familyMembers, projectionYears,
      selectedYear: 2027, view: "consolidated", asOfMode: "eoy",
      giftEvents: [TO_CHILD],
    } as BuildViewModelInput);

    expect(businessTotal(model)).toBeCloseTo(85_000_000, 2);
    const ooeTotal = (model.outOfEstateOwnerRows ?? [])
      .reduce((s, r) => s + r.assetTotal, 0);
    expect(ooeTotal, "the 15% given to a child must not vanish").toBeCloseTo(
      15_000_000, 2,
    );
  });
});

describe("joint titling survives a partial gift", () => {
  // `isJointTitledClientSpouseHalfHalf` bailed on `owners.length !== 2`. A
  // gift adds a third owner row, so a jtwros account silently stopped
  // reporting as Joint and split into Client / Spouse columns instead.
  const FM_SPOUSE = "fm-spouse";
  const jointAccounts = [
    {
      id: "a-brok",
      name: "Joint Brokerage",
      category: "taxable",
      owners: [
        { kind: "family_member" as const, familyMemberId: FM_CLIENT, percent: 0.5 },
        { kind: "family_member" as const, familyMemberId: FM_SPOUSE, percent: 0.5 },
      ],
      parentAccountId: null,
      titlingType: "jtwros" as const,
    },
  ];
  const twoFm: FamilyMember[] = [
    ...familyMembers,
    { id: FM_SPOUSE, role: "spouse", relationship: "child", firstName: "Ana", lastName: null, dateOfBirth: null },
  ];
  const yr = (y: number) => ({
    ...year(y),
    accountLedgers: { "a-brok": { beginningValue: 1_000_000, endingValue: 1_000_000 } },
  });

  it("still reports the retained share in the Joint column", () => {
    const model = buildHouseholdColumns({
      accounts: jointAccounts, liabilities: [], entities: [], notesReceivable: [],
      familyMembers: twoFm, projectionYears: [yr(2026), yr(2027)],
      selectedYear: 2027, asOfMode: "eoy",
      giftEvents: [{
        kind: "asset", year: 2026, accountId: "a-brok", percent: 0.15,
        grantor: "client", recipientEntityId: "trust-1", eventKind: "outright",
      }],
    });
    const row = model.assetCategories.flatMap((c) => c.rows).find((r) => r.key === "a-brok");
    expect(row!.joint).toBeCloseTo(850_000, 2);
    expect(row!.client).toBe(0);
    expect(row!.spouse).toBe(0);
  });
});

describe("By-Entity cards after a percentage gift of a business", () => {
  // KNOWN GAP, pinned deliberately (Dan's call, 2026-09-09). Business-tree
  // accounts are stripped from every entity card, so this tab cannot express a
  // partially-gifted business: the trust gets no card and the business card
  // still reads at full value. The Household tab and the Out-of-Estate section
  // ARE correct — see the suites above. These assertions exist so the day
  // someone changes the convention, they find this note instead of a silent
  // behaviour flip.
  function entityView(giftEvents: GiftEvent[]) {
    const model = buildViewModel({
      accounts, liabilities: [], entities, familyMembers, projectionYears,
      selectedYear: 2027, view: "entities", asOfMode: "eoy", giftEvents,
    } as BuildViewModelInput);
    return model.entityGroups ?? [];
  }

  it("still shows the business card at full value, and no card for the trust", () => {
    const groups = entityView([GIFT]);
    expect(groups.map((g) => g.entityId)).toEqual(["biz-1"]);
    expect(groups[0].assetTotal).toBeCloseTo(100_000_000, 2);
  });

  it("is identical with and without the gift", () => {
    const withGift = entityView([GIFT]).map((g) => [g.entityId, g.assetTotal]);
    const without = entityView([]).map((g) => [g.entityId, g.assetTotal]);
    expect(withGift).toEqual(without);
  });
});
