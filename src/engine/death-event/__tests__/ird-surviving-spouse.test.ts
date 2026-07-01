// Flat IRD income tax is a proxy for the ordinary income tax a NON-simulated
// heir pays as they draw down an inherited pre-tax account. The surviving
// spouse stays in the household projection and is taxed on real withdrawals, so
// their inheritance must never attract flat IRD at the first death — whether
// they are the "spouse" or (when the spouse predeceases) the "client"
// principal, and regardless of how the transfer is routed (beneficiary
// designation, will, titling, or the default-order fallback). Regression guard
// for the householdRole-tagging gap where the surviving "client" was mislabeled
// "family_member" and hit with phantom IRD (and lost the §2056 marital
// deduction).
import { describe, it, expect } from "vitest";
import { applyFirstDeath } from "../index";
import type { DeathEventInput } from "../index";
import type { Account, FamilyMember, PlanSettings, Will } from "../../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../../ownership";

const FAMILY: FamilyMember[] = [
  { id: LEGACY_FM_CLIENT, role: "client", relationship: "other", firstName: "Pat", lastName: null, dateOfBirth: "1970-01-01" },
  { id: LEGACY_FM_SPOUSE, role: "spouse", relationship: "other", firstName: "Sam", lastName: null, dateOfBirth: "1972-01-01" },
  { id: "fm-child", role: "child", relationship: "child", firstName: "Casey", lastName: null, dateOfBirth: "2000-01-01" },
];

const PS: PlanSettings = {
  flatFederalRate: 0,
  flatStateRate: 0,
  inflationRate: 0,
  planStartYear: 2026,
  planEndYear: 2080,
  estateAdminExpenses: 0,
  flatStateEstateRate: 0,
  irdTaxRate: 0.35,
} as PlanSettings;

function baseIra(overrides: Partial<Account>): Account {
  return {
    id: "ira-1",
    name: "Client IRA",
    category: "retirement",
    subType: "traditional_ira",
    value: 1_000_000,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    ...overrides,
  } as Account;
}

function run(ira: Account, will: Will | null = null): number {
  const input: DeathEventInput = {
    year: 2030,
    deceased: "client",
    survivor: "spouse",
    accounts: [ira],
    accountBalances: { [ira.id]: ira.value },
    basisMap: { [ira.id]: ira.basis },
    will,
    incomes: [],
    liabilities: [],
    familyMembers: FAMILY,
    externalBeneficiaries: [],
    entities: [],
    planSettings: PS,
    gifts: [],
    annualExclusionsByYear: {},
    dsueReceived: 0,
    priorTaxableGifts: { client: 0, spouse: 0 },
  } as DeathEventInput;
  const result = applyFirstDeath(input);
  return result.estateTax.drainAttributions
    .filter((a) => a.drainKind === "ird_tax")
    .reduce((s, a) => s + a.amount, 0);
}

describe("IRD to surviving spouse — should always be 0", () => {
  it("A: beneficiary = spouse by householdRole", () => {
    const ira = baseIra({
      beneficiaries: [{ id: "b1", tier: "primary", percentage: 100, householdRole: "spouse", sortOrder: 0 }],
    });
    expect(run(ira)).toBe(0);
  });

  it("B: beneficiary = spouse by familyMemberId", () => {
    const ira = baseIra({
      beneficiaries: [{ id: "b1", tier: "primary", percentage: 100, familyMemberId: LEGACY_FM_SPOUSE, sortOrder: 0 }],
    });
    expect(run(ira)).toBe(0);
  });

  it("C: no beneficiary, no will (fallback → spouse)", () => {
    const ira = baseIra({ beneficiaries: [] });
    expect(run(ira)).toBe(0);
  });

  it("D: no beneficiary, will leaves all to spouse", () => {
    const ira = baseIra({ beneficiaries: [] });
    const will: Will = {
      grantor: "client",
      bequests: [],
      residuary: [{ recipientKind: "spouse", recipientId: null, percentage: 100 }],
    } as unknown as Will;
    expect(run(ira, will)).toBe(0);
  });

  it("E: 401k, no beneficiary, no will (fallback → spouse)", () => {
    const ira = baseIra({ subType: "401k", beneficiaries: [] });
    expect(run(ira)).toBe(0);
  });

  it("F: joint-owned pre-tax account (client+spouse)", () => {
    const ira = baseIra({
      ownerType: "joint",
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
        { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
      ],
      beneficiaries: [],
    } as Partial<Account>);
    expect(run(ira)).toBe(0);
  });

  it("G: will residuary names spouse by familyMemberId (Bug #5 path)", () => {
    const ira = baseIra({ beneficiaries: [] });
    const will: Will = {
      grantor: "client",
      bequests: [],
      residuary: [{ recipientKind: "family_member", recipientId: LEGACY_FM_SPOUSE, percentage: 100 }],
    } as unknown as Will;
    expect(run(ira, will)).toBe(0);
  });

  it("H: will specific bequest of IRA to spouse", () => {
    const ira = baseIra({ beneficiaries: [] });
    const will: Will = {
      grantor: "client",
      bequests: [
        {
          id: "bq1",
          kind: "specific_asset",
          assetId: "ira-1",
          recipients: [{ recipientKind: "spouse", recipientId: null, percentage: 100 }],
        },
      ],
      residuary: [],
    } as unknown as Will;
    expect(run(ira, will)).toBe(0);
  });

  // ---- SPOUSE DIES FIRST → assets pass to the surviving "client" principal.
  // The surviving client IS the surviving spouse for marital-deduction / IRD
  // purposes, so IRD must still be 0.
  function runSpouseFirst(ira: Account, will: Will | null = null): number {
    const input: DeathEventInput = {
      year: 2030,
      deceased: "spouse",
      survivor: "client",
      accounts: [ira],
      accountBalances: { [ira.id]: ira.value },
      basisMap: { [ira.id]: ira.basis },
      will,
      incomes: [],
      liabilities: [],
      familyMembers: FAMILY,
      externalBeneficiaries: [],
      entities: [],
      planSettings: PS,
      gifts: [],
      annualExclusionsByYear: {},
      dsueReceived: 0,
      priorTaxableGifts: { client: 0, spouse: 0 },
    } as DeathEventInput;
    return applyFirstDeath(input).estateTax.drainAttributions
      .filter((a) => a.drainKind === "ird_tax")
      .reduce((s, a) => s + a.amount, 0);
  }

  const spouseIra = (o: Partial<Account>) =>
    baseIra({ owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }], ...o } as Partial<Account>);

  it("I: spouse-first, no beneficiary/no will (fallback → surviving client)", () => {
    expect(runSpouseFirst(spouseIra({ beneficiaries: [] }))).toBe(0);
  });

  it("J: spouse-first, beneficiary = surviving client by householdRole", () => {
    expect(
      runSpouseFirst(
        spouseIra({
          beneficiaries: [{ id: "b1", tier: "primary", percentage: 100, householdRole: "client", sortOrder: 0 }],
        }),
      ),
    ).toBe(0);
  });

  it("K: spouse-first, beneficiary = surviving client by familyMemberId", () => {
    expect(
      runSpouseFirst(
        spouseIra({
          beneficiaries: [{ id: "b1", tier: "primary", percentage: 100, familyMemberId: LEGACY_FM_CLIENT, sortOrder: 0 }],
        }),
      ),
    ).toBe(0);
  });

});
