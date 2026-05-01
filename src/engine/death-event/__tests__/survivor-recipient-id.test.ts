/**
 * F2 — death-event ledger entries for "to-survivor" transfers must carry the
 * surviving FM's id in `recipientId`. Three sites emit them:
 *
 *   1. applyTitling (joint accounts → survivor)
 *   2. applyFallback tier 1 (residual → spouse when no will / no bene)
 *   3. resolveRecipientLabelAndMutation in will bequests with recipientKind=spouse
 *
 * Pre-fix all three emitted `recipientId: null`, so the downstream resolver
 * fell back to `familyMembers.find(role === "spouse")`. In `spouseFirst`
 * ordering the surviving CLIENT then got the spouse's name.
 *
 * See [[2026-05-01-estate-transfer-report-audit]] F2.
 */

import { describe, it, expect } from "vitest";
import { applyFirstDeath, applyFinalDeath } from "../index";
import type { DeathEventInput } from "../index";
import type { Account, FamilyMember, PlanSettings, Will } from "../../types";

const FM_CLIENT_ID = "fm-client";
const FM_SPOUSE_ID = "fm-spouse";

const PRINCIPAL_FMS: FamilyMember[] = [
  { id: FM_CLIENT_ID, role: "client", relationship: "other", firstName: "Pat", lastName: null, dateOfBirth: "1970-01-01" },
  { id: FM_SPOUSE_ID, role: "spouse", relationship: "other", firstName: "Sam", lastName: null, dateOfBirth: "1972-01-01" },
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

function jointAccount(id: string, value: number): Account {
  return {
    id,
    name: `Joint ${id}`,
    category: "taxable",
    subType: "brokerage",
    value,
    basis: value,
    growthRate: 0,
    rmdEnabled: false,
    owners: [
      { kind: "family_member", familyMemberId: FM_CLIENT_ID, percent: 0.5 },
      { kind: "family_member", familyMemberId: FM_SPOUSE_ID, percent: 0.5 },
    ],
  } as Account;
}

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

function willToSpouse(grantor: "client" | "spouse", accountId: string): Will {
  return {
    id: `will-${grantor}`,
    grantor,
    bequests: [
      {
        id: "beq-1",
        name: "Specific to spouse",
        kind: "asset",
        assetMode: "specific",
        accountId,
        liabilityId: null,
        percentage: 100,
        condition: "always",
        sortOrder: 0,
        recipients: [
          { recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 },
        ],
      },
    ],
  } as Will;
}

function mkInput(over: Partial<DeathEventInput> & { accounts: Account[] }): DeathEventInput {
  const accountBalances: Record<string, number> = {};
  const basisMap: Record<string, number> = {};
  for (const a of over.accounts) {
    accountBalances[a.id] = a.value;
    basisMap[a.id] = a.basis;
  }
  return {
    year: 2026,
    deceased: "client",
    survivor: "spouse",
    will: null,
    accounts: over.accounts,
    accountBalances,
    basisMap,
    incomes: [],
    liabilities: [],
    familyMembers: PRINCIPAL_FMS,
    externalBeneficiaries: [],
    entities: [],
    planSettings: PLAN_SETTINGS,
    gifts: [],
    annualExclusionsByYear: {},
    dsueReceived: 0,
    ...over,
  };
}

describe("F2 — survivor recipientId on death-event ledger", () => {
  describe("applyTitling — joint account routes to survivor", () => {
    it("primaryFirst (client dies): recipientId === spouse FM id", () => {
      const result = applyFirstDeath(
        mkInput({ deceased: "client", survivor: "spouse", accounts: [jointAccount("acc-joint", 1_000_000)] }),
      );

      const titlingTransfer = result.transfers.find((t) => t.via === "titling" && t.sourceAccountId === "acc-joint");
      expect(titlingTransfer).toBeDefined();
      expect(titlingTransfer!.recipientKind).toBe("spouse");
      expect(titlingTransfer!.recipientId).toBe(FM_SPOUSE_ID);
    });

    it("spouseFirst (spouse dies): recipientId === client FM id (not the deceased spouse)", () => {
      const result = applyFirstDeath(
        mkInput({ deceased: "spouse", survivor: "client", accounts: [jointAccount("acc-joint", 1_000_000)] }),
      );

      const titlingTransfer = result.transfers.find((t) => t.via === "titling" && t.sourceAccountId === "acc-joint");
      expect(titlingTransfer).toBeDefined();
      expect(titlingTransfer!.recipientKind).toBe("spouse");
      expect(titlingTransfer!.recipientId).toBe(FM_CLIENT_ID);
    });
  });

  describe("applyFallback tier 1 — residual to surviving spouse when no will + no bene", () => {
    it("primaryFirst: deceased's sole-owned account fallbacks to spouse FM id", () => {
      const result = applyFirstDeath(
        mkInput({
          deceased: "client",
          survivor: "spouse",
          accounts: [soleAccount(FM_CLIENT_ID, "acc-sole", 500_000)],
        }),
      );

      const fallbackTransfer = result.transfers.find(
        (t) => t.via === "fallback_spouse" && t.sourceAccountId === "acc-sole",
      );
      expect(fallbackTransfer).toBeDefined();
      expect(fallbackTransfer!.recipientKind).toBe("spouse");
      expect(fallbackTransfer!.recipientId).toBe(FM_SPOUSE_ID);
    });

    it("spouseFirst: deceased spouse's sole-owned account fallbacks to client FM id", () => {
      const result = applyFirstDeath(
        mkInput({
          deceased: "spouse",
          survivor: "client",
          accounts: [soleAccount(FM_SPOUSE_ID, "acc-sole", 500_000)],
        }),
      );

      const fallbackTransfer = result.transfers.find(
        (t) => t.via === "fallback_spouse" && t.sourceAccountId === "acc-sole",
      );
      expect(fallbackTransfer).toBeDefined();
      expect(fallbackTransfer!.recipientKind).toBe("spouse");
      expect(fallbackTransfer!.recipientId).toBe(FM_CLIENT_ID);
    });
  });

  describe("will bequest with recipientKind=spouse — applyWillSpecificBequests", () => {
    it("primaryFirst: specific bequest to spouse routes recipientId to surviving spouse FM id", () => {
      const will = willToSpouse("client", "acc-sole");
      const result = applyFirstDeath(
        mkInput({
          deceased: "client",
          survivor: "spouse",
          will,
          accounts: [soleAccount(FM_CLIENT_ID, "acc-sole", 500_000)],
        }),
      );

      const willTransfer = result.transfers.find((t) => t.via === "will" && t.sourceAccountId === "acc-sole");
      expect(willTransfer).toBeDefined();
      expect(willTransfer!.recipientKind).toBe("spouse");
      expect(willTransfer!.recipientId).toBe(FM_SPOUSE_ID);
    });

    it("spouseFirst: spouse's will routes specific bequest to surviving client FM id", () => {
      const will = willToSpouse("spouse", "acc-sole");
      const result = applyFirstDeath(
        mkInput({
          deceased: "spouse",
          survivor: "client",
          will,
          accounts: [soleAccount(FM_SPOUSE_ID, "acc-sole", 500_000)],
        }),
      );

      const willTransfer = result.transfers.find((t) => t.via === "will" && t.sourceAccountId === "acc-sole");
      expect(willTransfer).toBeDefined();
      expect(willTransfer!.recipientKind).toBe("spouse");
      expect(willTransfer!.recipientId).toBe(FM_CLIENT_ID);
    });

    it("final death with recipientKind=spouse and no survivor: recipientId stays null (legacy fallback)", () => {
      // Final death: survivor is null. A will bequest to "spouse" with condition='always'
      // is a planning anomaly (no surviving spouse to receive it), but the engine must
      // not crash — recipientId can stay null and the resolver falls back to the frozen
      // label / role-based lookup.
      const will = willToSpouse("client", "acc-sole");
      const result = applyFinalDeath(
        mkInput({
          deceased: "client",
          survivor: "client", // applyFinalDeath ignores survivor; passed for type-shape only
          will,
          accounts: [soleAccount(FM_CLIENT_ID, "acc-sole", 500_000)],
        }),
      );

      const willTransfer = result.transfers.find((t) => t.via === "will" && t.sourceAccountId === "acc-sole");
      // Either the bequest fires (recipientId = null at final death is the legacy/edge
      // case the resolver still has to handle), or routing falls through to fallback —
      // both are acceptable here. Just assert no crash.
      if (willTransfer) {
        expect(willTransfer.recipientKind).toBe("spouse");
        expect(willTransfer.recipientId).toBeNull();
      }
    });
  });
});
