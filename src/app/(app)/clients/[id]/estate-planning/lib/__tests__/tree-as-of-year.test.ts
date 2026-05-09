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
    trustSubType: "slat",
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
