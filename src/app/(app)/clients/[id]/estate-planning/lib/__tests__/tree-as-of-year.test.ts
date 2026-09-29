import { describe, it, expect } from "vitest";
import { runProjectionWithEvents } from "@/engine/projection";
import {
  buildClientData,
  basePlanSettings,
  baseClient,
} from "@/engine/__tests__/fixtures";
import { LEGACY_FM_CLIENT } from "@/engine/ownership";
import type {
  Account,
  EntitySummary,
  Expense,
  FamilyMember,
  WithdrawalPriority,
} from "@/engine/types";
import { treeAsOfYear } from "../tree-as-of-year";
import { rowsForEntity, rowsForFamilyMember } from "../render-rows";

// Bug parity with the cash-flow drilldown: when an account is split between a
// household member and a non-IIP entity, a household withdrawal must NOT bleed
// into the entity's slice. The expandable Client / Trust cards read
// `account.value × owner.percent`, so the EoY overlay must renormalize percents
// from the engine's locked entity / family shares (entityAccountSharesEoY,
// familyAccountSharesEoY) — the same source the balance sheet uses.

const ENT_NON_IIP_LOCKED = "ent-non-iip-locked";

const entities: EntitySummary[] = [
  {
    id: ENT_NON_IIP_LOCKED,
    name: "Locked SLAT",
    entityType: "trust",
    trustSubType: "irrevocable",
    isIrrevocable: true,
    isGrantor: false,
    includeInPortfolio: false,
    accessibleToClient: false,
    grantor: "client",
  },
];

const soloClient: FamilyMember[] = [
  {
    id: LEGACY_FM_CLIENT,
    role: "client",
    relationship: "other",
    firstName: "Cooper",
    lastName: "Test",
    dateOfBirth: "1960-01-01", // age 66 in 2026 — no early-withdrawal noise
  },
];

function setupMixedAccountWithHouseholdDraw() {
  const checking: Account = {
    id: "acct-checking",
    name: "Checking",
    category: "cash",
    subType: "checking",
    titlingType: "jtwros",
    value: 1000,
    basis: 1000,
    growthRate: 0,
    rmdEnabled: false,
    isDefaultChecking: true,
    owners: [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 },
    ],
  };
  // 70% household / 30% non-IIP locked SLAT.
  const mixed: Account = {
    id: "acct-mixed",
    name: "Joint+SLAT Brokerage",
    category: "taxable",
    subType: "brokerage",
    titlingType: "jtwros",
    value: 1_000_000,
    basis: 1_000_000,
    growthRate: 0,
    rmdEnabled: false,
    owners: [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.7 },
      { kind: "entity", entityId: ENT_NON_IIP_LOCKED, percent: 0.3 },
    ],
  };
  const livingExpense: Expense = {
    id: "exp-living",
    name: "Living",
    type: "living",
    annualAmount: 80_000,
    growthRate: 0,
    startYear: 2026,
    endYear: 2026,
  };
  const strategy: WithdrawalPriority[] = [
    { accountId: "acct-mixed", priorityOrder: 1, startYear: 2026, endYear: 2026 },
  ];

  const data = buildClientData({
    client: { ...baseClient, dateOfBirth: "1960-01-01", spouseDob: undefined },
    familyMembers: soloClient,
    accounts: [checking, mixed],
    entities,
    incomes: [],
    expenses: [livingExpense],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: strategy,
    planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
  });
  return { data, withResult: runProjectionWithEvents(data) };
}

describe("treeAsOfYear — locked-share renormalization for mixed-ownership accounts", () => {
  it("entity slice in the EoY overlay matches the engine's locked share, even after a household withdrawal", () => {
    const { data, withResult } = setupMixedAccountWithHouseholdDraw();
    const year0 = withResult.years[0];

    // Sanity: household actually withdrew from the mixed account.
    const draw = year0.withdrawals.byAccount["acct-mixed"] ?? 0;
    expect(draw).toBeGreaterThan(0);
    const ledger = year0.accountLedgers["acct-mixed"];
    expect(ledger).toBeDefined();
    expect(ledger.endingValue).toBeLessThan(1_000_000);

    // Source of truth: engine's locked entity share (same value the balance
    // sheet shows) — $300,000 (no growth, no entity flows).
    const lockedEntity =
      year0.entityAccountSharesEoY?.get(ENT_NON_IIP_LOCKED)?.get("acct-mixed") ?? 0;
    expect(lockedEntity).toBeCloseTo(300_000, 6);

    // Trust card row for SLAT under the EoY overlay: should show locked share,
    // NOT ledger.endingValue × 0.3 (which would have bled the household draw
    // into the entity's slice).
    const overlaid = treeAsOfYear(data, withResult, 2026, "eoy");
    const slatRows = rowsForEntity(overlaid, ENT_NON_IIP_LOCKED);
    expect(slatRows).toHaveLength(1);
    expect(slatRows[0].sliceValue).toBeCloseTo(lockedEntity, 6);
  });

  it("household slice in the EoY overlay equals the family pool (ledger.endingValue − locked entity share)", () => {
    const { data, withResult } = setupMixedAccountWithHouseholdDraw();
    const year0 = withResult.years[0];
    const ledger = year0.accountLedgers["acct-mixed"];
    const lockedEntity =
      year0.entityAccountSharesEoY?.get(ENT_NON_IIP_LOCKED)?.get("acct-mixed") ?? 0;
    const familyPool = ledger.endingValue - lockedEntity;

    const overlaid = treeAsOfYear(data, withResult, 2026, "eoy");
    const cooperRows = rowsForFamilyMember(overlaid, LEGACY_FM_CLIENT);
    const mixedRow = cooperRows.find((r) => r.accountId === "acct-mixed");
    expect(mixedRow).toBeDefined();
    expect(mixedRow!.sliceValue).toBeCloseTo(familyPool, 6);
  });

  it("BoY overlay leaves authored percents alone (Today view shows advisor-entered split)", () => {
    const { data, withResult } = setupMixedAccountWithHouseholdDraw();
    const overlaid = treeAsOfYear(data, withResult, 2026, "boy");

    // BoY at planStartYear short-circuits to the original tree — authored
    // percents must round-trip.
    const cooperRows = rowsForFamilyMember(overlaid, LEGACY_FM_CLIENT);
    const mixedRow = cooperRows.find((r) => r.accountId === "acct-mixed");
    expect(mixedRow!.ownerPercent).toBeCloseTo(0.7, 6);
    expect(mixedRow!.sliceValue).toBeCloseTo(700_000, 6);
  });

  it("single-owner accounts are unaffected by the renormalization", () => {
    const { data, withResult } = setupMixedAccountWithHouseholdDraw();
    const overlaid = treeAsOfYear(data, withResult, 2026, "eoy");

    // Cooper's checking is sole-owned: no renormalization, percent stays 1.
    const cooperRows = rowsForFamilyMember(overlaid, LEGACY_FM_CLIENT);
    const checkingRow = cooperRows.find((r) => r.accountId === "acct-checking");
    expect(checkingRow).toBeDefined();
    expect(checkingRow!.ownerPercent).toBe(1);
  });
});

// A lifetime gift is an OVERLAY on the authored owners: the trust or person it
// names has no authored row, so the year's owners must ADD one — re-weighting
// the rows that exist can never show it. $10M account, no growth, no flows, no
// deaths: only the gift can move a number.

const GIFTED_ACCT = "acct-gifted";
const FM_SPOUSE = "fm-spouse";
const FM_KID = "fm-kid";
const clientOnly: Account["owners"] = [
  { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 },
];

function setupGiftedAccount(opts: {
  owners: Account["owners"];
  gift: { year: number; percent: number; recipientEntityId?: string; recipientFamilyMemberId?: string };
}) {
  const account: Account = {
    id: GIFTED_ACCT,
    name: "Gifted Brokerage",
    category: "taxable",
    subType: "brokerage",
    titlingType: "jtwros",
    value: 10_000_000,
    basis: 10_000_000,
    growthRate: 0,
    rmdEnabled: false,
    owners: opts.owners,
  };
  const data = buildClientData({
    client: { ...baseClient, dateOfBirth: "1960-01-01" },
    familyMembers: [
      ...soloClient,
      { id: FM_SPOUSE, role: "spouse", relationship: "other", firstName: "Casey",
        lastName: "Test", dateOfBirth: "1972-06-15" },
      { id: FM_KID, role: "child", relationship: "child", firstName: "Kit",
        lastName: "Test", dateOfBirth: "1995-01-01" },
    ],
    accounts: [account],
    entities,
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    giftEvents: [{ kind: "asset", accountId: GIFTED_ACCT, grantor: "client", ...opts.gift }],
    planSettings: {
      ...basePlanSettings, flatFederalRate: 0, flatStateRate: 0, inflationRate: 0,
      planStartYear: 2026, planEndYear: 2032,
    },
  });
  return { data, withResult: runProjectionWithEvents(data) };
}

describe("treeAsOfYear — gift-shaped changes", () => {
  it("creates an entity row for a trust that has no authored row", () => {
    const { data, withResult } = setupGiftedAccount({
      owners: clientOnly,
      gift: { year: 2028, percent: 0.3, recipientEntityId: ENT_NON_IIP_LOCKED },
    });
    const out = treeAsOfYear(data, withResult, 2030, "eoy");
    expect(out.accounts[0].owners).toContainEqual(
      { kind: "entity", entityId: ENT_NON_IIP_LOCKED, percent: 0.3 },
    );
    // The rows already carry the gift, so a gift-aware direct caller handed
    // them alongside the raw events must not re-apply it. (The spine's gross
    // estate is not that caller: it takes the authored rows and drops the
    // marker for an account no death partitioned, T24-g.)
    expect(out.accounts[0].giftsReflectedThrough).toBe(2030);
  });

  it("creates a gifted_away row for a gift to a person", () => {
    const { data, withResult } = setupGiftedAccount({
      owners: clientOnly,
      gift: { year: 2028, percent: 0.25, recipientFamilyMemberId: FM_KID },
    });
    const out = treeAsOfYear(data, withResult, 2030, "eoy");
    expect(out.accounts[0].owners).toContainEqual({
      kind: "gifted_away", recipient: { kind: "family_member", id: FM_KID }, percent: 0.25,
    });
    expect(out.accounts[0].giftsReflectedThrough).toBe(2030);
  });

  it("still leaves authored percents alone at BoY", () => {
    // Mirrors the must-stay-green pin, restated here so this task cannot
    // regress it without noticing. The gift is dated in the plan's first year:
    // "Today" is the opening snapshot, before it happens — so only the
    // planStartYear short-circuit keeps it off these rows.
    const authored: Account["owners"] = [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.6 },
      { kind: "entity", entityId: ENT_NON_IIP_LOCKED, percent: 0.4 },
    ];
    const { data, withResult } = setupGiftedAccount({
      owners: authored,
      gift: { year: 2026, percent: 0.2, recipientFamilyMemberId: FM_KID },
    });
    const out = treeAsOfYear(data, withResult, 2026, "boy");
    expect(out.accounts[0].owners).toEqual(data.accounts[0].owners);
  });

  it("composes the gift at BoY of a later year too, and says so", () => {
    const { data, withResult } = setupGiftedAccount({
      owners: clientOnly,
      gift: { year: 2028, percent: 0.3, recipientEntityId: ENT_NON_IIP_LOCKED },
    });
    const out = treeAsOfYear(data, withResult, 2031, "boy");
    const [acct] = out.accounts;
    expect(acct.value).toBeCloseTo(10_000_000, 2);
    expect(acct.owners).toHaveLength(2);
    expect(acct.owners).toContainEqual(
      { kind: "entity", entityId: ENT_NON_IIP_LOCKED, percent: 0.3 },
    );
    const household = acct.owners.find((o) => o.kind === "family_member");
    expect(household).toMatchObject({ familyMemberId: LEGACY_FM_CLIENT });
    expect(household!.percent).toBeCloseTo(0.7, 12);
    expect(acct.giftsReflectedThrough).toBe(2031);
  });

  it("a gift to a person on a joint account leaves the EoY rows summing to 1", () => {
    // The engine's locked family shares are gift-blind toward a person gift
    // (5M each here: the settle step rescales them to `ending − entity locks`,
    // a pool that still holds the kid's 2.5M). Read raw, the spouses keep .5
    // each beside the kid's .25 — 1.25 of the account.
    const { data, withResult } = setupGiftedAccount({
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
        { kind: "family_member", familyMemberId: FM_SPOUSE, percent: 0.5 },
      ],
      gift: { year: 2028, percent: 0.25, recipientFamilyMemberId: FM_KID },
    });
    const out = treeAsOfYear(data, withResult, 2030, "eoy");
    const owners = out.accounts[0].owners;
    const pct = (pick: (o: (typeof owners)[number]) => boolean) =>
      owners.filter(pick).reduce((s, o) => s + o.percent, 0);
    expect(pct((o) => o.kind === "gifted_away")).toBeCloseTo(0.25, 12);
    expect(pct((o) => o.kind === "family_member" && o.familyMemberId === LEGACY_FM_CLIENT))
      .toBeCloseTo(0.375, 12);
    expect(pct((o) => o.kind === "family_member" && o.familyMemberId === FM_SPOUSE))
      .toBeCloseTo(0.375, 12);
    expect(pct(() => true)).toBeCloseTo(1, 12);
  });

  it("stamps no marker when the gifts could not be composed (an overdraw)", () => {
    // Two 60% gifts overdraw the household share, so the year's owners fall
    // back to the authored rows, which reflect NEITHER gift. A marker on them
    // would tell a gift-aware direct caller to skip gifts never applied. The
    // engine throws on the overdraw, so it projects the first gift alone.
    const { data, withResult } = setupGiftedAccount({
      owners: clientOnly,
      gift: { year: 2028, percent: 0.6, recipientEntityId: ENT_NON_IIP_LOCKED },
    });
    const overdrawn = {
      ...data,
      giftEvents: [...(data.giftEvents ?? []), {
        kind: "asset" as const, accountId: GIFTED_ACCT, grantor: "client" as const,
        year: 2029, percent: 0.6, recipientFamilyMemberId: FM_KID,
      }],
    };
    const [acct] = treeAsOfYear(overdrawn, withResult, 2030, "eoy").accounts;
    expect(acct.owners).toEqual(clientOnly);
    expect(acct.giftsReflectedThrough).toBeUndefined();
  });
});
