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
  // CONVENTION (Dan's call, 2026-09-10). `account.owners` is the AUTHORED
  // baseline and a gift is an OVERLAY on top of it, so the By-Entity tab shows
  // the business as authored and a gift moves a slice OUT of its card onto the
  // recipient's. Both sides name the share against the whole enterprise value
  // ("85% of $100,000,000") so a scaled card never reads as the business having
  // shrunk. Cards then reconcile to enterprise value.
  //
  // AUTHORED entity ownership is untouched: a business a trust owns outright
  // still gets its own card and is still excluded from the trust's — see
  // view-model.test.ts, "does not also roll a trust-owned business-as-asset
  // account into the trust card".
  function entityView(giftEvents: GiftEvent[], overrides: Partial<BuildViewModelInput> = {}) {
    const model = buildViewModel({
      accounts, liabilities: [], entities, familyMembers, projectionYears,
      selectedYear: 2027, view: "entities", asOfMode: "eoy", giftEvents,
      ...overrides,
    } as BuildViewModelInput);
    return model.entityGroups ?? [];
  }

  it("scales the business card to the share its authored owners retained", () => {
    const biz = entityView([GIFT]).find((g) => g.entityId === "biz-1")!;
    expect(biz.assetTotal).toBeCloseTo(85_000_000, 2);
  });

  it("names the retained share against the whole enterprise value", () => {
    const biz = entityView([GIFT]).find((g) => g.entityId === "biz-1")!;
    const root = biz.assetRows.find((r) => r.accountId === "biz-1")!;
    expect(root.accountName).toBe("Whatnot — 85% of $100,000,000");
  });

  it("gives the recipient trust a card holding its gifted interest", () => {
    const trust = entityView([GIFT]).find((g) => g.entityId === "trust-1");
    expect(trust, "the IDGT should hold its 15% interest").toBeDefined();
    expect(trust!.assetTotal).toBeCloseTo(15_000_000, 2);
    expect(trust!.assetRows[0].accountName).toBe("Whatnot — 15% of $100,000,000");
  });

  it("reconciles: the cards sum to enterprise value", () => {
    const total = entityView([GIFT]).reduce((s, g) => s + g.assetTotal, 0);
    expect(total).toBeCloseTo(100_000_000, 2);
  });

  it("leaves the card whole and unlabelled with no gift", () => {
    const groups = entityView([]);
    expect(groups.map((g) => g.entityId)).toEqual(["biz-1"]);
    expect(groups[0].assetTotal).toBeCloseTo(100_000_000, 2);
    expect(groups[0].assetRows[0].accountName).toBe("Whatnot");
  });

  it("reads the pre-gift ownership in the today column", () => {
    // A gift dated in or after plan start has not happened relative to the
    // opening snapshot — same rule `ownersAsOf` applies everywhere else.
    const groups = entityView([GIFT], { asOfMode: "today" });
    expect(groups.map((g) => g.entityId)).toEqual(["biz-1"]);
    expect(groups[0].assetTotal).toBeCloseTo(100_000_000, 2);
  });

  it("scales sub-accounts with the root and values the trust on the whole tree", () => {
    // Whatnot's operating cash is a child account: the gifted 15% is 15% of the
    // CONSOLIDATED tree, and the retained rows each scale to 85%.
    const withChild = [
      ...accounts,
      { id: "biz-cash", name: "Whatnot — Cash", category: "cash", owners: clientOnly, parentAccountId: "biz-1", businessType: null, titlingType: null },
    ];
    const withChildYears = projectionYears.map((y) => ({
      ...y,
      accountLedgers: { ...y.accountLedgers, "biz-cash": { beginningValue: 20_000_000, endingValue: 20_000_000 } },
    }));
    const groups = entityView([GIFT], { accounts: withChild, projectionYears: withChildYears });
    const biz = groups.find((g) => g.entityId === "biz-1")!;
    expect(biz.assetRows.find((r) => r.accountId === "biz-1")!.value).toBeCloseTo(85_000_000, 2);
    expect(biz.assetRows.find((r) => r.accountId === "biz-cash")!.value).toBeCloseTo(17_000_000, 2);
    const trust = groups.find((g) => g.entityId === "trust-1")!;
    expect(trust.assetTotal).toBeCloseTo(18_000_000, 2);
    expect(trust.assetRows[0].accountName).toBe("Whatnot — 15% of $120,000,000");
  });

  it("does not name a share of a drained sub-account", () => {
    // Whatnot's operating cash sits at $0 on the live plan — "85% of $0" is
    // noise, not information.
    const withEmptyChild = [
      ...accounts,
      { id: "biz-cash", name: "Whatnot — Cash", category: "cash", owners: clientOnly, parentAccountId: "biz-1", businessType: null, titlingType: null },
    ];
    const years = projectionYears.map((y) => ({
      ...y,
      accountLedgers: { ...y.accountLedgers, "biz-cash": { beginningValue: 0, endingValue: 0 } },
    }));
    const biz = entityView([GIFT], { accounts: withEmptyChild, projectionYears: years }).find((g) => g.entityId === "biz-1")!;
    expect(biz.assetRows.find((r) => r.accountId === "biz-cash")!.accountName).toBe("Whatnot — Cash");
  });

  it("keeps business debt whole on the business card", () => {
    // The enterprise's own books carry its debt; the gifted interest is a share
    // of gross enterprise value. Counting the loan once keeps the tab's net
    // worth reconciling to the enterprise's.
    const groups = entityView([GIFT], {
      liabilities: [{ id: "biz-loan", name: "Operating Line", parentAccountId: "biz-1", linkedPropertyId: null, owners: [] }],
      projectionYears: projectionYears.map((y) => ({ ...y, liabilityBalancesBoY: { "biz-loan": 20_000 } })),
    });
    const biz = groups.find((g) => g.entityId === "biz-1")!;
    expect(biz.liabilityTotal).toBe(20_000);
    expect(biz.netWorth).toBeCloseTo(84_980_000, 2);
    const trust = groups.find((g) => g.entityId === "trust-1")!;
    expect(trust.liabilityTotal).toBe(0);
  });
});
