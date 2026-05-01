/**
 * "To-survivor" ledger entries must carry the surviving FM's id in
 * recipientId — applyTitling, applyFallback tier 1, and will bequests with
 * recipientKind=spouse. Without it, the resolver's role-based fallback
 * mislabels the surviving client as the spouse in spouseFirst ordering.
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
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
      { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
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
      expect(titlingTransfer!.recipientId).toBe(LEGACY_FM_SPOUSE);
    });

    it("spouseFirst (spouse dies): recipientId === client FM id (not the deceased spouse)", () => {
      const result = applyFirstDeath(
        mkInput({ deceased: "spouse", survivor: "client", accounts: [jointAccount("acc-joint", 1_000_000)] }),
      );

      const titlingTransfer = result.transfers.find((t) => t.via === "titling" && t.sourceAccountId === "acc-joint");
      expect(titlingTransfer).toBeDefined();
      expect(titlingTransfer!.recipientKind).toBe("spouse");
      expect(titlingTransfer!.recipientId).toBe(LEGACY_FM_CLIENT);
    });
  });

  describe("applyFallback tier 1 — residual to surviving spouse when no will + no bene", () => {
    it("primaryFirst: deceased's sole-owned account fallbacks to spouse FM id", () => {
      const result = applyFirstDeath(
        mkInput({
          deceased: "client",
          survivor: "spouse",
          accounts: [soleAccount(LEGACY_FM_CLIENT, "acc-sole", 500_000)],
        }),
      );

      const fallbackTransfer = result.transfers.find(
        (t) => t.via === "fallback_spouse" && t.sourceAccountId === "acc-sole",
      );
      expect(fallbackTransfer).toBeDefined();
      expect(fallbackTransfer!.recipientKind).toBe("spouse");
      expect(fallbackTransfer!.recipientId).toBe(LEGACY_FM_SPOUSE);
    });

    it("spouseFirst: deceased spouse's sole-owned account fallbacks to client FM id", () => {
      const result = applyFirstDeath(
        mkInput({
          deceased: "spouse",
          survivor: "client",
          accounts: [soleAccount(LEGACY_FM_SPOUSE, "acc-sole", 500_000)],
        }),
      );

      const fallbackTransfer = result.transfers.find(
        (t) => t.via === "fallback_spouse" && t.sourceAccountId === "acc-sole",
      );
      expect(fallbackTransfer).toBeDefined();
      expect(fallbackTransfer!.recipientKind).toBe("spouse");
      expect(fallbackTransfer!.recipientId).toBe(LEGACY_FM_CLIENT);
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
          accounts: [soleAccount(LEGACY_FM_CLIENT, "acc-sole", 500_000)],
        }),
      );

      const willTransfer = result.transfers.find((t) => t.via === "will" && t.sourceAccountId === "acc-sole");
      expect(willTransfer).toBeDefined();
      expect(willTransfer!.recipientKind).toBe("spouse");
      expect(willTransfer!.recipientId).toBe(LEGACY_FM_SPOUSE);
    });

    it("spouseFirst: spouse's will routes specific bequest to surviving client FM id", () => {
      const will = willToSpouse("spouse", "acc-sole");
      const result = applyFirstDeath(
        mkInput({
          deceased: "spouse",
          survivor: "client",
          will,
          accounts: [soleAccount(LEGACY_FM_SPOUSE, "acc-sole", 500_000)],
        }),
      );

      const willTransfer = result.transfers.find((t) => t.via === "will" && t.sourceAccountId === "acc-sole");
      expect(willTransfer).toBeDefined();
      expect(willTransfer!.recipientKind).toBe("spouse");
      expect(willTransfer!.recipientId).toBe(LEGACY_FM_CLIENT);
    });
  });
});
