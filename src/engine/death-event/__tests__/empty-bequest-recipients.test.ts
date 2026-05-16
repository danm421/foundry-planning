/**
 * A specific-asset bequest can end up with zero recipients — e.g. the estate
 * flow distribution dialog clears every will recipient ("remove the bequest").
 * Such a clause claims nothing: it must be treated as not-fired so the account
 * flows on to the residuary / fallback steps, never dividing by zero in
 * `splitAccount`.
 */

import { describe, it, expect } from "vitest";
import { applyFirstDeath } from "../index";
import type { DeathEventInput } from "../index";
import type { Account, FamilyMember, PlanSettings, Will } from "../../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../../ownership";

const PRINCIPAL_FMS: FamilyMember[] = [
  { id: LEGACY_FM_CLIENT, role: "client", relationship: "other", firstName: "Pat", lastName: null, dateOfBirth: "1970-01-01" },
  { id: LEGACY_FM_SPOUSE, role: "spouse", relationship: "other", firstName: "Sam", lastName: null, dateOfBirth: "1972-01-01" },
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

/** A client will whose specific bequest for `accountId` has no recipients. */
function willWithEmptyBequest(accountId: string): Will {
  return {
    id: "will-client",
    grantor: "client",
    bequests: [
      {
        id: "beq-empty",
        name: "Cleared bequest",
        kind: "asset",
        assetMode: "specific",
        accountId,
        liabilityId: null,
        percentage: 100,
        condition: "always",
        sortOrder: 0,
        recipients: [],
      },
    ],
  } as Will;
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
    familyMembers: PRINCIPAL_FMS,
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

describe("specific bequest with no recipients", () => {
  it("does not throw, and the account flows to the fallback step", () => {
    const acct = soleAccount(LEGACY_FM_CLIENT, "acc-sole", 500_000);

    const result = applyFirstDeath(
      mkInput({
        deceased: "client",
        survivor: "spouse",
        will: willWithEmptyBequest("acc-sole"),
        accounts: [acct],
      }),
    );

    // The empty bequest must not produce a "will" transfer.
    const willTransfer = result.transfers.find(
      (t) => t.via === "will" && t.sourceAccountId === "acc-sole",
    );
    expect(willTransfer).toBeUndefined();

    // With no bene + no firing will clause, the account falls back to the spouse.
    const fallbackTransfer = result.transfers.find(
      (t) => t.via === "fallback_spouse" && t.sourceAccountId === "acc-sole",
    );
    expect(fallbackTransfer).toBeDefined();
    expect(fallbackTransfer!.recipientId).toBe(LEGACY_FM_SPOUSE);
  });
});
