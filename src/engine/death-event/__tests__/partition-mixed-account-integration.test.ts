import { describe, expect, it } from "vitest";
import { applyFirstDeath } from "../first-death";
import { applyFinalDeath } from "../final-death";
import type { DeathEventInput } from "../shared";
import type { Account, EntitySummary, FamilyMember, PlanSettings } from "../../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../../ownership";

const clientFm: FamilyMember = {
  id: LEGACY_FM_CLIENT,
  role: "client",
  relationship: "other",
  firstName: "Client",
  lastName: "Test",
  dateOfBirth: "1970-01-01",
};
const spouseFm: FamilyMember = {
  id: LEGACY_FM_SPOUSE,
  role: "spouse",
  relationship: "other",
  firstName: "Spouse",
  lastName: "Test",
  dateOfBirth: "1972-01-01",
};

const ps: PlanSettings = {
  flatFederalRate: 0,
  flatStateRate: 0,
  inflationRate: 0.025,
  planStartYear: 2026,
  planEndYear: 2080,
  taxInflationRate: 0.025,
  estateAdminExpenses: 0,
  flatStateEstateRate: 0,
};

const mkInput = (over: Partial<DeathEventInput>): DeathEventInput => {
  const accounts = over.accounts ?? [];
  const accountBalances: Record<string, number> = { ...(over.accountBalances ?? {}) };
  const basisMap: Record<string, number> = { ...(over.basisMap ?? {}) };
  for (const a of accounts) {
    if (accountBalances[a.id] == null) accountBalances[a.id] = a.value;
    if (basisMap[a.id] == null) basisMap[a.id] = a.basis;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { familyMembers: _fm, ...rest } = over;
  return {
    year: 2045,
    deceased: "client",
    survivor: "spouse",
    will: null,
    accounts,
    accountBalances,
    basisMap,
    incomes: [],
    liabilities: [],
    familyMembers: [clientFm, spouseFm],
    externalBeneficiaries: [],
    entities: [],
    planSettings: ps,
    gifts: [],
    annualExclusionsByYear: {},
    dsueReceived: 0,
    priorTaxableGifts: { client: 0, spouse: 0 },
    ...rest,
  };
};

const kidFm: FamilyMember = {
  id: "kid-b",
  role: "child",
  relationship: "child",
  firstName: "Bob",
  lastName: "Test",
  dateOfBirth: "2000-01-01",
};

const mkFinalDeathInput = (over: Partial<DeathEventInput>): DeathEventInput => {
  const accounts = over.accounts ?? [];
  const accountBalances: Record<string, number> = { ...(over.accountBalances ?? {}) };
  const basisMap: Record<string, number> = { ...(over.basisMap ?? {}) };
  for (const a of accounts) {
    if (accountBalances[a.id] == null) accountBalances[a.id] = a.value;
    if (basisMap[a.id] == null) basisMap[a.id] = a.basis;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { familyMembers: _fm, ...rest } = over;
  return {
    year: 2052,
    deceased: "client",
    survivor: "client",
    will: null,
    accounts,
    accountBalances,
    basisMap,
    incomes: [],
    liabilities: [],
    familyMembers: [clientFm, kidFm],
    externalBeneficiaries: [],
    entities: [],
    planSettings: ps,
    gifts: [],
    annualExclusionsByYear: {},
    dsueReceived: 0,
    priorTaxableGifts: { client: 0, spouse: 0 },
    ...rest,
  };
};

describe("partitionMixedAccount — chain integration at final death", () => {
  it("routes only the family pool through the chain, retains entity slice unchanged", () => {
    const llcEntity: EntitySummary = {
      id: "e-llc2",
      name: "Client LLC",
      includeInPortfolio: false,
      isGrantor: false,
      isIrrevocable: true,
      entityType: "llc",
    };

    // $100k cash account: deceased client owns 80%, LLC owns 20%
    const mixedAcct: Account = {
      id: "aCheck2",
      name: "Checking",
      category: "cash",
      value: 100_000,
      basis: 40_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.8 },
        { kind: "entity", entityId: "e-llc2", percent: 0.2 },
      ],
    };

    const result = applyFinalDeath(
      mkFinalDeathInput({
        accounts: [mixedAcct],
        entities: [llcEntity],
      }),
    );

    // The entity slice (value 20k) must be retained in result.accounts —
    // the entity's share is never distributed through the precedence chain.
    const entitySlice = result.accounts.find(
      (a) => a.owners.length === 1 && a.owners[0].kind === "entity" && a.owners[0].entityId === "e-llc2",
    );
    expect(entitySlice).toBeDefined();
    expect(entitySlice!.value).toBeCloseTo(20_000, 0);

    // The family pool (80k) must route through the ledger — fallback to child.
    const assetTransfers = result.transfers.filter(
      (t) => t.sourceAccountId === "aCheck2" && t.amount > 0,
    );
    expect(assetTransfers.length).toBeGreaterThan(0);
    const totalRouted = assetTransfers.reduce((s, t) => s + t.amount, 0);
    expect(totalRouted).toBeCloseTo(80_000, 0);
  });
});

describe("partitionMixedAccount — chain integration at first death", () => {
  it("routes only the family pool through the chain, retains entity slice unchanged", () => {
    const llcEntity: EntitySummary = {
      id: "e-llc",
      name: "Client LLC",
      includeInPortfolio: false,
      isGrantor: false,
      isIrrevocable: true,
      entityType: "llc",
    };

    // $100k cash account: client owns 80%, LLC owns 20%
    const mixedAcct: Account = {
      id: "aCheck",
      name: "Checking",
      category: "cash",
      value: 100_000,
      basis: 40_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.8 },
        { kind: "entity", entityId: "e-llc", percent: 0.2 },
      ],
    };

    const result = applyFirstDeath(
      mkInput({
        accounts: [mixedAcct],
        entities: [llcEntity],
      }),
    );

    // The transfer ledger should show exactly one asset transfer from this account,
    // routing only the family pool (80k) to the surviving spouse via fallback.
    const assetTransfers = result.transfers.filter(
      (t) => t.sourceAccountId === "aCheck" && t.amount > 0,
    );
    expect(assetTransfers).toHaveLength(1);
    expect(assetTransfers[0].amount).toBeCloseTo(80_000, 0);
    expect(assetTransfers[0].recipientKind).toBe("spouse");

    // The post-event accounts should contain an entity-owned slice with value=20k
    const entitySlice = result.accounts.find(
      (a) => a.owners.length === 1 && a.owners[0].kind === "entity" && a.owners[0].entityId === "e-llc",
    );
    expect(entitySlice).toBeDefined();
    expect(entitySlice!.value).toBeCloseTo(20_000, 0);
  });
});
