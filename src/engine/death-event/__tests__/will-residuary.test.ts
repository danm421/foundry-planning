/**
 * The will's residuary ("remainder estate") clause routes whatever the
 * specific + all_assets bequests left undisposed. Primary tier governs when
 * the grantor's spouse survives them (first death); contingent tier governs
 * when the spouse predeceased (married final death). An empty governing tier
 * falls through to the hardcoded fallback cascade.
 */

import { describe, it, expect } from "vitest";
import { applyFirstDeath, applyFinalDeath } from "../index";
import type { DeathEventInput } from "../index";
import type { Account, FamilyMember, PlanSettings, Will } from "../../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../../ownership";

const CHILD_A = "00000000-0000-0000-0000-0000000000aa";
const CHILD_B = "00000000-0000-0000-0000-0000000000bb";

const FMS: FamilyMember[] = [
  { id: LEGACY_FM_CLIENT, role: "client", relationship: "other", firstName: "Pat", lastName: null, dateOfBirth: "1955-01-01" },
  { id: LEGACY_FM_SPOUSE, role: "spouse", relationship: "other", firstName: "Sam", lastName: null, dateOfBirth: "1957-01-01" },
  { id: CHILD_A, role: "child", relationship: "child", firstName: "Alex", lastName: null, dateOfBirth: "1985-01-01" },
  { id: CHILD_B, role: "child", relationship: "child", firstName: "Bo", lastName: null, dateOfBirth: "1988-01-01" },
];

const SINGLE_FMS: FamilyMember[] = [
  { id: LEGACY_FM_CLIENT, role: "client", relationship: "other", firstName: "Pat", lastName: null, dateOfBirth: "1955-01-01" },
  { id: CHILD_A, role: "child", relationship: "child", firstName: "Alex", lastName: null, dateOfBirth: "1985-01-01" },
];

const PLAN_SETTINGS: PlanSettings = {
  flatFederalRate: 0,
  flatStateRate: 0,
  inflationRate: 0.025,
  planStartYear: 2026,
  planEndYear: 2080,
  estateAdminExpenses: 0,
  flatStateEstateRate: 0,
} as PlanSettings;

function soleAccount(ownerFmId: string, id: string, value: number): Account {
  return {
    id,
    name: `Sole ${id}`,
    category: "taxable",
    subType: "brokerage",
    value,
    basis: value,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: ownerFmId, percent: 1 }],
  } as Account;
}

/** A will with residuary recipients and no specific bequests. */
function willWithResiduary(
  grantor: "client" | "spouse",
  recipients: Will["residuaryRecipients"],
): Will {
  return { id: `will-${grantor}`, grantor, bequests: [], residuaryRecipients: recipients } as Will;
}

function mkInput(over: Partial<DeathEventInput> & { accounts: Account[] }): DeathEventInput {
  const { accounts, ...rest } = over;
  const accountBalances: Record<string, number> = {};
  const basisMap: Record<string, number> = {};
  for (const a of accounts) {
    accountBalances[a.id] = a.value;
    basisMap[a.id] = a.basis;
  }
  return {
    year: 2026,
    deceased: "client",
    survivor: "spouse",
    will: null,
    incomes: [],
    liabilities: [],
    familyMembers: FMS,
    externalBeneficiaries: [],
    entities: [],
    planSettings: PLAN_SETTINGS,
    gifts: [],
    annualExclusionsByYear: {},
    dsueReceived: 0,
    priorTaxableGifts: { client: 0, spouse: 0 },
    ...rest,
    accounts,
    accountBalances,
    basisMap,
  };
}

describe("applyWillResiduary — first death (primary tier)", () => {
  it("routes the undisposed account to the primary residuary recipient", () => {
    const acct = soleAccount(LEGACY_FM_CLIENT, "acc-1", 400_000);
    const will = willWithResiduary("client", [
      { recipientKind: "family_member", recipientId: CHILD_A, tier: "primary", percentage: 100, sortOrder: 0 },
    ]);

    const result = applyFirstDeath(
      mkInput({ deceased: "client", survivor: "spouse", will, accounts: [acct] }),
    );

    const t = result.transfers.find(
      (x) => x.via === "will_residuary" && x.sourceAccountId === "acc-1",
    );
    expect(t).toBeDefined();
    expect(t!.recipientId).toBe(CHILD_A);
  });

  it("ignores contingent recipients at first death", () => {
    const acct = soleAccount(LEGACY_FM_CLIENT, "acc-1", 400_000);
    const will = willWithResiduary("client", [
      { recipientKind: "family_member", recipientId: CHILD_B, tier: "contingent", percentage: 100, sortOrder: 0 },
    ]);

    const result = applyFirstDeath(
      mkInput({ deceased: "client", survivor: "spouse", will, accounts: [acct] }),
    );

    // Contingent tier does not fire at first death → no residuary transfer;
    // the account falls through to the fallback cascade.
    expect(result.transfers.some((x) => x.via === "will_residuary")).toBe(false);
    expect(result.transfers.some((x) => x.via.startsWith("fallback_"))).toBe(true);
  });
});

describe("applyWillResiduary — final death", () => {
  it("married household uses the contingent tier", () => {
    const acct = soleAccount(LEGACY_FM_CLIENT, "acc-1", 400_000);
    const will = willWithResiduary("client", [
      { recipientKind: "family_member", recipientId: CHILD_A, tier: "primary", percentage: 100, sortOrder: 0 },
      { recipientKind: "family_member", recipientId: CHILD_B, tier: "contingent", percentage: 100, sortOrder: 1 },
    ]);

    const result = applyFinalDeath(
      mkInput({ deceased: "client", survivor: "spouse", will, accounts: [acct], familyMembers: FMS }),
    );

    const t = result.transfers.find(
      (x) => x.via === "will_residuary" && x.sourceAccountId === "acc-1",
    );
    expect(t).toBeDefined();
    expect(t!.recipientId).toBe(CHILD_B);
  });

  it("single filer uses the primary tier", () => {
    const acct = soleAccount(LEGACY_FM_CLIENT, "acc-1", 400_000);
    const will = willWithResiduary("client", [
      { recipientKind: "family_member", recipientId: CHILD_A, tier: "primary", percentage: 100, sortOrder: 0 },
    ]);

    const result = applyFinalDeath(
      mkInput({ deceased: "client", survivor: "spouse", will, accounts: [acct], familyMembers: SINGLE_FMS }),
    );

    const t = result.transfers.find(
      (x) => x.via === "will_residuary" && x.sourceAccountId === "acc-1",
    );
    expect(t).toBeDefined();
    expect(t!.recipientId).toBe(CHILD_A);
  });
});
