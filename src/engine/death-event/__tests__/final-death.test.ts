import { describe, expect, it } from "vitest";
import { applyFinalDeath } from "../final-death";
import type { DeathEventInput } from "../shared";
import type {
  Account,
  FamilyMember,
  Liability,
  PlanSettings,
  Will,
} from "../../types";
import { LEGACY_FM_CLIENT } from "../../ownership";

const clientFm: FamilyMember = {
  id: LEGACY_FM_CLIENT,
  role: "client",
  relationship: "other",
  firstName: "Client",
  lastName: "Test",
  dateOfBirth: "1970-01-01",
};

const kidA: FamilyMember = {
  id: "kid-a",
  role: "child",
  relationship: "child",
  firstName: "Alice",
  lastName: "Test",
  dateOfBirth: "2000-01-01",
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
  const principal = callerFms.some((f) => f.id === LEGACY_FM_CLIENT)
    ? []
    : [clientFm];
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
    familyMembers: [...principal, ...callerFms],
    externalBeneficiaries: [],
    entities: [],
    planSettings: planSettings(),
    gifts: [],
    annualExclusionsByYear: {},
    dsueReceived: 0,
    priorTaxableGifts: { client: 0, spouse: 0 },
    ...rest,
  };
};

describe("applyFinalDeath — gross transfers + drain attribution (Phase B)", () => {
  it("emits gross transfer amounts at second death (no pre-routing drain)", () => {
    // $1M brokerage, 10% flat state estate tax, $0 admin → $100k state tax.
    // Federal tax = 0 (estate << BEA). All routes to one child via fallback.
    // Gross transfer should be $1M, NOT $900k.
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
      familyMembers: [kidA],
      planSettings: planSettings({ flatStateEstateRate: 0.1 }),
    });
    const result = applyFinalDeath(input);

    expect(result.estateTax.stateEstateTax).toBeCloseTo(100_000, 0);
    expect(result.estateTax.federalEstateTax).toBeCloseTo(0, 0);

    const assetTransfers = result.transfers.filter(
      (t) => t.sourceAccountId != null && t.amount > 0,
    );
    expect(assetTransfers).toHaveLength(1);
    expect(assetTransfers[0].recipientId).toBe("kid-a");
    expect(assetTransfers[0].amount).toBeCloseTo(1_000_000, 0);

    // estateTaxDebits and creditorPayoffDebits arrays still emitted for accounting.
    expect(result.estateTax.estateTaxDebits.length).toBeGreaterThan(0);
    const stateDebitTotal = result.estateTax.estateTaxDebits.reduce(
      (s, d) => s + d.amount,
      0,
    );
    expect(stateDebitTotal).toBeCloseTo(100_000, 0);
  });

  it("drainAttributions reconcile to drain totals (state estate tax + debts)", () => {
    // $1M brokerage + $200k cash + $20k unlinked CC.
    // 10% state tax → state $120k. CC $20k creditor-paid.
    // Recipient: kid-a (single child, fallback tier 2).
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
    const cash: Account = {
      id: "cash",
      name: "Cash",
      category: "cash",
      subType: "savings",
      value: 200_000,
      basis: 200_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 },
      ],
    };
    const cc: Liability = {
      id: "cc",
      name: "Credit Card",
      balance: 20_000,
      interestRate: 0.18,
      monthlyPayment: 500,
      startYear: 2025,
      startMonth: 1,
      termMonths: 24,
      extraPayments: [],
      owners: [],
    };
    const input = mkInput({
      accounts: [brokerage, cash],
      liabilities: [cc],
      familyMembers: [kidA],
      planSettings: planSettings({ flatStateEstateRate: 0.1 }),
    });
    const result = applyFinalDeath(input);

    const stateSum = result.estateTax.drainAttributions
      .filter((a) => a.drainKind === "state_estate_tax")
      .reduce((s, a) => s + a.amount, 0);
    const debtsSum = result.estateTax.drainAttributions
      .filter((a) => a.drainKind === "debts_paid")
      .reduce((s, a) => s + a.amount, 0);
    expect(stateSum).toBeCloseTo(result.estateTax.stateEstateTax, 0);
    expect(debtsSum).toBeCloseTo(20_000, 0);

    // All drain attribution lands on kid-a (sole non-spouse recipient).
    expect(
      result.estateTax.drainAttributions.every(
        (a) => a.recipientId === "kid-a",
      ),
    ).toBe(true);
  });

  it("residuary recipient absorbs estate tax first", () => {
    // Two assets, two children. Will: 50% specific to kid-a; residuary 100% to kid-b.
    // State tax should land entirely on kid-b (residuary recipient).
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
    const will: Will = {
      id: "w1",
      grantor: "client",
      bequests: [
        {
          id: "b1",
          name: "50% to kid-a",
          kind: "asset",
          assetMode: "all_assets",
          accountId: null,
          liabilityId: null,
          percentage: 50,
          condition: "always",
          sortOrder: 0,
          recipients: [
            {
              recipientKind: "family_member",
              recipientId: "kid-a",
              percentage: 100,
              sortOrder: 0,
            },
          ],
        },
        {
          id: "b2",
          name: "Residual 50% to kid-b",
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
              recipientId: "kid-b",
              percentage: 100,
              sortOrder: 0,
            },
          ],
        },
      ],
      residuaryRecipients: [
        {
          recipientKind: "family_member",
          recipientId: "kid-b",
          percentage: 100,
          sortOrder: 0,
        },
      ],
    };
    const kidB: FamilyMember = {
      id: "kid-b",
      role: "child",
      relationship: "child",
      firstName: "Bob",
      lastName: "Test",
      dateOfBirth: "2002-01-01",
    };
    const input = mkInput({
      accounts: [brokerage],
      will,
      familyMembers: [kidA, kidB],
      planSettings: planSettings({ flatStateEstateRate: 0.1 }),
    });
    const result = applyFinalDeath(input);

    const stateAttribs = result.estateTax.drainAttributions.filter(
      (a) => a.drainKind === "state_estate_tax",
    );
    const onB = stateAttribs.find((a) => a.recipientId === "kid-b");
    const onA = stateAttribs.find((a) => a.recipientId === "kid-a");
    expect(onB?.amount).toBeCloseTo(result.estateTax.stateEstateTax, 0);
    expect(onA).toBeUndefined();
  });

  it("married final death: step-3c distribution and drain attribution use the same residuary tier", () => {
    // Married household (predeceased spouse FM present) → contingent tier governs.
    // Will residuary has BOTH tiers: primary → kid-a, contingent → kid-b.
    // The single-source-of-truth tier means BOTH the step-3c asset transfer
    // AND the estate-tax drain attribution must land on the contingent
    // recipient (kid-b) — never the primary recipient (kid-a). If the two
    // derivations ever desynced, one of these would route to kid-a.
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
    const will: Will = {
      id: "w1",
      grantor: "client",
      bequests: [],
      residuaryRecipients: [
        {
          recipientKind: "family_member",
          recipientId: "kid-a",
          percentage: 100,
          sortOrder: 0,
          tier: "primary",
        },
        {
          recipientKind: "family_member",
          recipientId: "kid-b",
          percentage: 100,
          sortOrder: 1,
          tier: "contingent",
        },
      ],
    };
    const spouseFm: FamilyMember = {
      id: "spouse-fm",
      role: "spouse",
      relationship: "other",
      firstName: "Spouse",
      lastName: "Test",
      dateOfBirth: "1972-01-01",
    };
    const kidB: FamilyMember = {
      id: "kid-b",
      role: "child",
      relationship: "child",
      firstName: "Bob",
      lastName: "Test",
      dateOfBirth: "2002-01-01",
    };
    const input = mkInput({
      accounts: [brokerage],
      will,
      familyMembers: [spouseFm, kidA, kidB],
      planSettings: planSettings({ flatStateEstateRate: 0.1 }),
    });
    const result = applyFinalDeath(input);

    // Step-3c distribution: the residuary asset transfer goes to the
    // contingent recipient (kid-b), because the household was married.
    const residuaryTransfers = result.transfers.filter(
      (t) => t.via === "will_residuary" && t.amount > 0,
    );
    expect(residuaryTransfers).toHaveLength(1);
    expect(residuaryTransfers[0].recipientId).toBe("kid-b");

    // Drain attribution: the estate-tax drain lands on the SAME recipient.
    const stateAttribs = result.estateTax.drainAttributions.filter(
      (a) => a.drainKind === "state_estate_tax",
    );
    expect(stateAttribs.every((a) => a.recipientId === "kid-b")).toBe(true);
    const stateOnB = stateAttribs
      .filter((a) => a.recipientId === "kid-b")
      .reduce((s, a) => s + a.amount, 0);
    expect(stateOnB).toBeCloseTo(result.estateTax.stateEstateTax, 0);
  });
});
