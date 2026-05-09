import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";
import type {
  Account,
  EntitySummary,
  Expense,
  FamilyMember,
  WithdrawalPriority,
} from "../types";

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

describe("death-event integration — locked entity shares are honored at the death year", () => {
  it("client dies the same year as a household withdrawal on a 70/30 (HH/SLAT) account; gross estate uses familyPool, not fmv × pct", () => {
    // Client born 1960 + lifeExpectancy 66 = dies 2026 (first death, deathOrder 1).
    // Spouse born 1972, no lifeExpectancy → defaults to 95 → dies 2067, which is
    // past the plan horizon (2026), so only the client's first-death fires within
    // the plan window. applyFirstDeath is the code path that must use locked shares.
    const familyMembers: FamilyMember[] = [
      {
        id: LEGACY_FM_CLIENT,
        role: "client",
        relationship: "other",
        firstName: "Test",
        lastName: "Client",
        dateOfBirth: "1960-01-01",
      },
      {
        id: LEGACY_FM_SPOUSE,
        role: "spouse",
        relationship: "spouse",
        firstName: "Test",
        lastName: "Spouse",
        dateOfBirth: "1972-06-15",
      },
    ];
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
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
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
      client: {
        ...baseClient,
        dateOfBirth: "1960-01-01",
        spouseDob: "1972-06-15",
        lifeExpectancy: 66, // client dies in 2026 (first death)
        // No spouseLifeExpectancy → defaults to 95 → 2067, past horizon
        spouseLifeExpectancy: undefined,
      },
      familyMembers,
      accounts: [checking, mixed],
      entities,
      incomes: [],
      expenses: [livingExpense],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: strategy,
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const [year0] = runProjection(data);

    // First-death event must fire (client dies 2026, deathOrder 1).
    expect(year0.estateTax).toBeDefined();
    const gross = year0.estateTax!.grossEstate;

    // Locked entity share for the death year must equal $300k (BoY × percent,
    // no growth, the household withdrawal does not erode it).
    const entityLocked =
      year0.entityAccountSharesEoY?.get(ENT_NON_IIP_LOCKED)?.get("acct-mixed") ?? 0;
    expect(entityLocked).toBeCloseTo(300_000, 6);

    // Gross estate ≈ family pool (post-withdrawal balance minus locked entity).
    // Phase 1's single-FM-with-entity fix routes the lone FM as sole owner of
    // the family pool, so the estate attribution is familyPool × 1 (NOT × 0.5
    // from the joint convention and NOT × ledger.endingValue ignoring entity).
    const ledger = year0.accountLedgers["acct-mixed"];
    expect(ledger).toBeDefined();
    const familyPool = ledger.endingValue - entityLocked;

    // Allow ±$1 tolerance for any non-mixed-account drains the engine layered on.
    expect(gross).toBeGreaterThan(familyPool - 1);
    expect(gross).toBeLessThan(familyPool + 1);

    // Sanity: NOT the legacy fmv × pct value. Ledger.endingValue × 0.7 would
    // be the bug — make sure we're materially different from that.
    expect(Math.abs(gross - ledger.endingValue * 0.7)).toBeGreaterThan(1);
  });
});
