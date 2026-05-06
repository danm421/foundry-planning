import { describe, it, expect } from "vitest";
import { computeIrdAttributions } from "../ird-tax";
import { applyFirstDeath, applyFinalDeath } from "../index";
import type { DeathEventInput } from "../index";
import type { Account, DeathTransfer, FamilyMember, PlanSettings } from "../../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../../ownership";

const acct = (id: string, subType: Account["subType"]): Account => ({
  id,
  name: id,
  category: "retirement",
  subType,
  ownerType: "individual",
  ownerId: "fm-c",
  balance: 0,
  basis: 0,
  growthRate: 0,
} as unknown as Account);

const transfer = (
  partial: Partial<DeathTransfer> & Pick<DeathTransfer, "recipientKind" | "amount">,
): DeathTransfer => ({
  via: "beneficiary_designation",
  sourceAccountId: "ira-1",
  sourceAccountName: "IRA",
  sourceLiabilityId: null,
  sourceLiabilityName: null,
  recipientId: null,
  recipientLabel: "Recipient",
  basis: 0,
  resultingAccountId: null,
  resultingLiabilityId: null,
  ...partial,
}) as DeathTransfer;

describe("computeIrdAttributions", () => {
  it("applies IRD to a non-spouse child receiving a traditional IRA", () => {
    const out = computeIrdAttributions({
      deathOrder: 1,
      transfers: [
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: 100_000, sourceAccountId: "ira-1" }),
      ],
      accounts: [acct("ira-1", "traditional_ira")],
      externalBeneficiaries: [],
      irdTaxRate: 0.35,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      drainKind: "ird_tax",
      recipientKind: "family_member",
      recipientId: "fm-child",
      deathOrder: 1,
    });
    expect(out[0].amount).toBeCloseTo(35_000, 2);
  });

  it("emits no IRD for spouse recipient", () => {
    const out = computeIrdAttributions({
      deathOrder: 1,
      transfers: [
        transfer({ recipientKind: "spouse", recipientId: null, amount: 100_000, sourceAccountId: "ira-1" }),
      ],
      accounts: [acct("ira-1", "traditional_ira")],
      externalBeneficiaries: [],
      irdTaxRate: 0.35,
    });
    expect(out).toEqual([]);
  });

  it("splits 50/50 spouse/child — only the child's $50k attracts IRD", () => {
    const out = computeIrdAttributions({
      deathOrder: 1,
      transfers: [
        transfer({ recipientKind: "spouse", recipientId: null, amount: 50_000, sourceAccountId: "ira-1" }),
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: 50_000, sourceAccountId: "ira-1" }),
      ],
      accounts: [acct("ira-1", "traditional_ira")],
      externalBeneficiaries: [],
      irdTaxRate: 0.35,
    });
    expect(out).toHaveLength(1);
    expect(out[0].recipientId).toBe("fm-child");
    expect(out[0].amount).toBeCloseTo(17_500, 2);
  });

  it("excludes charitable external beneficiaries", () => {
    const out = computeIrdAttributions({
      deathOrder: 1,
      transfers: [
        transfer({ recipientKind: "external_beneficiary", recipientId: "ext-charity", amount: 100_000, sourceAccountId: "ira-1" }),
      ],
      accounts: [acct("ira-1", "traditional_ira")],
      externalBeneficiaries: [
        { id: "ext-charity", name: "Red Cross", kind: "charity" },
      ],
      irdTaxRate: 0.35,
    });
    expect(out).toEqual([]);
  });

  it("includes non-charity external beneficiaries", () => {
    const out = computeIrdAttributions({
      deathOrder: 1,
      transfers: [
        transfer({ recipientKind: "external_beneficiary", recipientId: "ext-friend", amount: 100_000, sourceAccountId: "ira-1" }),
      ],
      accounts: [acct("ira-1", "traditional_ira")],
      externalBeneficiaries: [
        { id: "ext-friend", name: "Friend", kind: "individual" },
      ],
      irdTaxRate: 0.35,
    });
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBeCloseTo(35_000, 2);
  });

  it("does not apply IRD to roth_ira", () => {
    const out = computeIrdAttributions({
      deathOrder: 1,
      transfers: [
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: 100_000, sourceAccountId: "roth-1" }),
      ],
      accounts: [acct("roth-1", "roth_ira")],
      externalBeneficiaries: [],
      irdTaxRate: 0.35,
    });
    expect(out).toEqual([]);
  });

  it("does not apply IRD to brokerage", () => {
    const out = computeIrdAttributions({
      deathOrder: 1,
      transfers: [
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: 100_000, sourceAccountId: "brk-1" }),
      ],
      accounts: [{ ...acct("brk-1", "brokerage"), category: "taxable" } as Account],
      externalBeneficiaries: [],
      irdTaxRate: 0.35,
    });
    expect(out).toEqual([]);
  });

  it("returns [] when rate is 0", () => {
    const out = computeIrdAttributions({
      deathOrder: 1,
      transfers: [
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: 100_000, sourceAccountId: "ira-1" }),
      ],
      accounts: [acct("ira-1", "traditional_ira")],
      externalBeneficiaries: [],
      irdTaxRate: 0,
    });
    expect(out).toEqual([]);
  });

  it("applies IRD when 401k passes to a trust entity", () => {
    const out = computeIrdAttributions({
      deathOrder: 2,
      transfers: [
        transfer({ recipientKind: "entity", recipientId: "ent-trust", amount: 200_000, sourceAccountId: "401k-1" }),
      ],
      accounts: [acct("401k-1", "401k")],
      externalBeneficiaries: [],
      irdTaxRate: 0.40,
    });
    expect(out).toHaveLength(1);
    expect(out[0].recipientKind).toBe("entity");
    expect(out[0].amount).toBeCloseTo(80_000, 2);
    expect(out[0].deathOrder).toBe(2);
  });

  it("applies IRD on 403(b) accounts", () => {
    const out = computeIrdAttributions({
      deathOrder: 2,
      transfers: [
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: 100_000, sourceAccountId: "403b-1" }),
      ],
      accounts: [acct("403b-1", "403b")],
      externalBeneficiaries: [],
      irdTaxRate: 0.30,
    });
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBeCloseTo(30_000, 2);
  });

  it("aggregates multiple transfers to the same recipient into one attribution", () => {
    const out = computeIrdAttributions({
      deathOrder: 2,
      transfers: [
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: 60_000, sourceAccountId: "ira-1" }),
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: 40_000, sourceAccountId: "401k-1" }),
      ],
      accounts: [acct("ira-1", "traditional_ira"), acct("401k-1", "401k")],
      externalBeneficiaries: [],
      irdTaxRate: 0.25,
    });
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBeCloseTo(25_000, 2);
  });

  it("ignores transfers with non-positive amount or null sourceAccountId", () => {
    const out = computeIrdAttributions({
      deathOrder: 1,
      transfers: [
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: 0, sourceAccountId: "ira-1" }),
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: -10_000, sourceAccountId: "ira-1" }),
        transfer({ recipientKind: "family_member", recipientId: "fm-child", amount: 100_000, sourceAccountId: null }),
      ],
      accounts: [acct("ira-1", "traditional_ira")],
      externalBeneficiaries: [],
      irdTaxRate: 0.35,
    });
    expect(out).toEqual([]);
  });
});

describe("applyFirstDeath integration — IRD applies to non-spouse IRA bequest", () => {
  const FM_CHILD_ID = "fm-child-ird";
  const FAMILY: FamilyMember[] = [
    { id: LEGACY_FM_CLIENT, role: "client", relationship: "other", firstName: "Pat", lastName: null, dateOfBirth: "1970-01-01" },
    { id: LEGACY_FM_SPOUSE, role: "spouse", relationship: "other", firstName: "Sam", lastName: null, dateOfBirth: "1972-01-01" },
    { id: FM_CHILD_ID, role: "child", relationship: "child", firstName: "Casey", lastName: null, dateOfBirth: "2000-01-01" },
  ];

  const PLAN_SETTINGS: PlanSettings = {
    flatFederalRate: 0,
    flatStateRate: 0,
    inflationRate: 0,
    planStartYear: 2026,
    planEndYear: 2080,
    estateAdminExpenses: 0,
    flatStateEstateRate: 0,
    irdTaxRate: 0.35,
  } as PlanSettings;

  it("emits ird_tax DrainAttribution for IRA passing to child via beneficiary designation", () => {
    const ira: Account = {
      id: "ira-1",
      name: "Client IRA",
      category: "retirement",
      subType: "traditional_ira",
      value: 1_000_000,
      basis: 0,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      beneficiaries: [
        { id: "ben-1", tier: "primary", percentage: 100, familyMemberId: FM_CHILD_ID, sortOrder: 0 },
      ],
    } as Account;

    const input: DeathEventInput = {
      year: 2030,
      deceased: "client",
      survivor: "spouse",
      accounts: [ira],
      accountBalances: { [ira.id]: ira.value },
      basisMap: { [ira.id]: ira.basis },
      will: null,
      incomes: [],
      liabilities: [],
      familyMembers: FAMILY,
      externalBeneficiaries: [],
      entities: [],
      planSettings: PLAN_SETTINGS,
      gifts: [],
      annualExclusionsByYear: {},
      dsueReceived: 0,
      priorTaxableGifts: { client: 0, spouse: 0 },
    };

    const result = applyFirstDeath(input);

    const ird = result.estateTax.drainAttributions.filter((a) => a.drainKind === "ird_tax");
    expect(ird.length).toBeGreaterThan(0);
    const childIrd = ird.find((a) => a.recipientKind === "family_member" && a.recipientId === FM_CHILD_ID);
    expect(childIrd).toBeDefined();
    expect(childIrd!.amount).toBeCloseTo(0.35 * 1_000_000, 0);
  });

  it("emits no ird_tax DrainAttribution when irdTaxRate is 0", () => {
    const ira: Account = {
      id: "ira-1",
      name: "Client IRA",
      category: "retirement",
      subType: "traditional_ira",
      value: 1_000_000,
      basis: 0,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      beneficiaries: [
        { id: "ben-1", tier: "primary", percentage: 100, familyMemberId: FM_CHILD_ID, sortOrder: 0 },
      ],
    } as Account;

    const input: DeathEventInput = {
      year: 2030,
      deceased: "client",
      survivor: "spouse",
      accounts: [ira],
      accountBalances: { [ira.id]: ira.value },
      basisMap: { [ira.id]: ira.basis },
      will: null,
      incomes: [],
      liabilities: [],
      familyMembers: FAMILY,
      externalBeneficiaries: [],
      entities: [],
      planSettings: { ...PLAN_SETTINGS, irdTaxRate: 0 },
      gifts: [],
      annualExclusionsByYear: {},
      dsueReceived: 0,
      priorTaxableGifts: { client: 0, spouse: 0 },
    };

    const result = applyFirstDeath(input);
    const ird = result.estateTax.drainAttributions.filter((a) => a.drainKind === "ird_tax");
    expect(ird).toEqual([]);
  });
});

describe("applyFinalDeath integration — IRD applies via fallback_children when no will/no beneficiary", () => {
  const FAMILY: FamilyMember[] = [
    { id: LEGACY_FM_CLIENT, role: "client", relationship: "other", firstName: "Pat", lastName: null, dateOfBirth: "1970-01-01" },
    { id: LEGACY_FM_SPOUSE, role: "spouse", relationship: "other", firstName: "Sam", lastName: null, dateOfBirth: "1972-01-01" },
    { id: "fm-c1", role: "other", relationship: "child", firstName: "Child A", lastName: null, dateOfBirth: "2000-01-01" },
    { id: "fm-c2", role: "other", relationship: "child", firstName: "Child B", lastName: null, dateOfBirth: "2002-01-01" },
  ];

  const PS: PlanSettings = {
    flatFederalRate: 0,
    flatStateRate: 0,
    inflationRate: 0,
    planStartYear: 2026,
    planEndYear: 2080,
    estateAdminExpenses: 0,
    flatStateEstateRate: 0,
    irdTaxRate: 0.24,
  } as PlanSettings;

  it("emits ird_tax DrainAttributions on each child when IRA falls via default order at final death", () => {
    // Mirrors the post-first-death state where the IRA was rolled to the
    // surviving spouse and now passes to children at final death with no
    // beneficiary and no will. Regression: previously the precedence chain
    // removed the source IRA from `chainResult.accounts` after distribution,
    // so subType lookup failed and IRD was silently 0.
    const ira: Account = {
      id: "ira-1",
      name: "IRA",
      category: "retirement",
      subType: "traditional_ira",
      value: 400_000,
      basis: 0,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }],
    } as Account;

    const input: DeathEventInput = {
      year: 2050,
      deceased: "spouse",
      survivor: "client",
      accounts: [ira],
      accountBalances: { [ira.id]: ira.value },
      basisMap: { [ira.id]: ira.basis },
      will: null,
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
    };

    const result = applyFinalDeath(input);
    const ird = result.estateTax.drainAttributions.filter((a) => a.drainKind === "ird_tax");
    expect(ird.length).toBe(2);
    const total = ird.reduce((s, a) => s + a.amount, 0);
    expect(total).toBeCloseTo(0.24 * 400_000, 0);
  });
});
