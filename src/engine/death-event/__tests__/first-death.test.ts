import { describe, expect, it } from "vitest";
import { applyFirstDeath } from "../first-death";
import type { DeathEventInput } from "../shared";
import type {
  Account,
  FamilyMember,
  PlanSettings,
  Will,
} from "../../types";
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

const kidA: FamilyMember = {
  id: "kid-a",
  role: "child",
  relationship: "child",
  firstName: "Alice",
  lastName: "Test",
  dateOfBirth: "2000-01-01",
};
const kidB: FamilyMember = {
  id: "kid-b",
  role: "child",
  relationship: "child",
  firstName: "Bob",
  lastName: "Test",
  dateOfBirth: "2002-01-01",
};

const planSettings = (over: Partial<PlanSettings> = {}): PlanSettings => ({
  flatFederalRate: 0,
  flatStateRate: 0,
  inflationRate: 0.025,
  planStartYear: 2026,
  planEndYear: 2080,
  taxInflationRate: 0.025,
  estateAdminExpenses: 0,
  flatStateEstateRate: 0,
  ...over,
});

const mkInput = (over: Partial<DeathEventInput>): DeathEventInput => {
  const accounts = over.accounts ?? [];
  const accountBalances: Record<string, number> = { ...(over.accountBalances ?? {}) };
  const basisMap: Record<string, number> = { ...(over.basisMap ?? {}) };
  for (const a of accounts) {
    if (accountBalances[a.id] == null) accountBalances[a.id] = a.value;
    if (basisMap[a.id] == null) basisMap[a.id] = a.basis;
  }
  const callerFms = over.familyMembers ?? [];
  const principals = [clientFm, spouseFm].filter(
    (p) => !callerFms.some((f) => f.id === p.id),
  );
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
    familyMembers: [...principals, ...callerFms],
    externalBeneficiaries: [],
    entities: [],
    planSettings: planSettings(),
    gifts: [],
    annualExclusionsByYear: {},
    dsueReceived: 0,
    ...rest,
  };
};

describe("applyFirstDeath — gross transfers + drain attribution (Phase B)", () => {
  it("emits gross asset transfers (chain runs pre-drain)", () => {
    // $1M to spouse via fallback. Spouse fully shields via marital deduction
    // → $0 estate tax. Transfer.amount === $1M.
    const brokerage: Account = {
      id: "brok",
      name: "Brokerage",
      category: "taxable",
      subType: "brokerage",
      value: 1_000_000,
      basis: 500_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 },
      ],
    };
    const input = mkInput({
      accounts: [brokerage],
      planSettings: planSettings({ flatStateEstateRate: 0.1 }),
    });
    const result = applyFirstDeath(input);

    expect(result.estateTax.maritalDeduction).toBeCloseTo(1_000_000, 0);
    expect(result.estateTax.federalEstateTax).toBeCloseTo(0, 0);
    expect(result.estateTax.stateEstateTax).toBeCloseTo(0, 0);

    const assetTransfers = result.transfers.filter(
      (t) => t.sourceAccountId != null && t.amount > 0,
    );
    expect(assetTransfers).toHaveLength(1);
    expect(assetTransfers[0].recipientKind).toBe("spouse");
    expect(assetTransfers[0].amount).toBeCloseTo(1_000_000, 0);
  });

  it("drainAttributions reconcile and exempt spouse from estate tax", () => {
    // Will routes 50% to spouse (marital), 50% to kid-a.
    // 10% state tax on the taxable half. drainAttribution for state tax
    // should land entirely on kid-a, not on spouse.
    const brokerage: Account = {
      id: "brok",
      name: "Brokerage",
      category: "taxable",
      subType: "brokerage",
      value: 2_000_000,
      basis: 1_000_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 },
      ],
    };
    const will: Will = {
      id: "w1",
      grantor: "client",
      bequests: [
        {
          id: "b1",
          name: "Half to spouse",
          kind: "asset",
          assetMode: "all_assets",
          accountId: null,
          liabilityId: null,
          percentage: 50,
          condition: "always",
          sortOrder: 0,
          recipients: [
            {
              recipientKind: "spouse",
              recipientId: null,
              percentage: 100,
              sortOrder: 0,
            },
          ],
        },
        {
          id: "b2",
          name: "Half to kid-a",
          kind: "asset",
          assetMode: "all_assets",
          accountId: null,
          liabilityId: null,
          percentage: 50,
          condition: "always",
          sortOrder: 1,
          recipients: [
            {
              recipientKind: "family_member",
              recipientId: "kid-a",
              percentage: 100,
              sortOrder: 0,
            },
          ],
        },
      ],
    };
    const input = mkInput({
      accounts: [brokerage],
      will,
      familyMembers: [kidA, kidB],
      planSettings: planSettings({ flatStateEstateRate: 0.1 }),
    });
    const result = applyFirstDeath(input);

    expect(result.estateTax.stateEstateTax).toBeGreaterThan(0);

    const stateAttribs = result.estateTax.drainAttributions.filter(
      (a) => a.drainKind === "state_estate_tax",
    );
    const onSpouse = stateAttribs.find((a) => a.recipientKind === "spouse");
    const onKidA = stateAttribs.find((a) => a.recipientId === "kid-a");
    expect(onSpouse).toBeUndefined();
    expect(onKidA?.amount).toBeCloseTo(result.estateTax.stateEstateTax, 0);
  });
});
