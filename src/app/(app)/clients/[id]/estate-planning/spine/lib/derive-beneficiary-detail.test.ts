import { describe, expect, it } from "vitest";
import type {
  ClientData,
  DeathTransfer,
  DrainAttribution,
  EntitySummary,
} from "@/engine/types";
import { deriveBeneficiaryDetail } from "./derive-beneficiary-detail";

// ── Helpers ───────────────────────────────────────────────────────────────────

function transfer(overrides: Partial<DeathTransfer> & { amount: number }): DeathTransfer {
  return {
    year: 2050,
    deathOrder: 1,
    deceased: "client",
    sourceAccountId: "acct-1",
    sourceAccountName: "Client Brokerage",
    sourceLiabilityId: null,
    sourceLiabilityName: null,
    via: "will",
    recipientKind: "family_member",
    recipientId: "fm-1",
    recipientLabel: "Child A",
    basis: 0,
    resultingAccountId: null,
    resultingLiabilityId: null,
    ...overrides,
  };
}

function attribution(overrides: Partial<DrainAttribution> & { amount: number }): DrainAttribution {
  return {
    deathOrder: 2,
    recipientKind: "family_member",
    recipientId: "fm-1",
    drainKind: "federal_estate_tax",
    ...overrides,
  };
}

function emptyTree(extras: Partial<ClientData> = {}): ClientData {
  // Minimal ClientData stub — derive-beneficiary-detail only reads tree.entities
  // and tree-level beneficiaries.* sub-fields, never any other nested structures
  // here. Cast through unknown to avoid building the full ClientData shape.
  return {
    entities: [],
    ...extras,
  } as unknown as ClientData;
}

const childRecipient = {
  kind: "family_member" as const,
  id: "fm-1",
  name: "Child A",
  relationship: "child" as const,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("deriveBeneficiaryDetail — direct receipts", () => {
  it("aggregates gross transfers per death", () => {
    const detail = deriveBeneficiaryDetail({
      recipient: childRecipient,
      firstTransfers: [transfer({ amount: 200_000 })],
      secondTransfers: [transfer({ deathOrder: 2, amount: 400_000 })],
      firstDrainAttributions: [],
      secondDrainAttributions: [],
      tree: emptyTree(),
    });
    expect(detail.fromFirstDeath.gross).toBeCloseTo(200_000);
    expect(detail.fromSecondDeath.gross).toBeCloseTo(400_000);
    expect(detail.fromFirstDeath.net).toBeCloseTo(200_000);
    expect(detail.fromSecondDeath.net).toBeCloseTo(400_000);
    expect(detail.total).toBeCloseTo(600_000);
  });

  it("ignores transfers to other recipients", () => {
    const detail = deriveBeneficiaryDetail({
      recipient: childRecipient,
      firstTransfers: [
        transfer({ amount: 100_000 }),
        transfer({ recipientId: "fm-other", recipientLabel: "Other", amount: 999_999 }),
      ],
      secondTransfers: [],
      firstDrainAttributions: [],
      secondDrainAttributions: [],
      tree: emptyTree(),
    });
    expect(detail.fromFirstDeath.gross).toBeCloseTo(100_000);
    expect(detail.fromFirstDeath.transfers).toHaveLength(1);
  });

  it("subtracts drain attributions to compute net per death", () => {
    const detail = deriveBeneficiaryDetail({
      recipient: childRecipient,
      firstTransfers: [],
      secondTransfers: [transfer({ deathOrder: 2, amount: 400_000 })],
      firstDrainAttributions: [],
      secondDrainAttributions: [
        attribution({ drainKind: "federal_estate_tax", amount: 50_000 }),
        attribution({ drainKind: "state_estate_tax", amount: 10_000 }),
      ],
      tree: emptyTree(),
    });
    expect(detail.fromSecondDeath.drains.federal_estate_tax).toBeCloseTo(50_000);
    expect(detail.fromSecondDeath.drains.state_estate_tax).toBeCloseTo(10_000);
    expect(detail.fromSecondDeath.net).toBeCloseTo(400_000 - 60_000);
    expect(detail.total).toBeCloseTo(340_000);
  });

  it("ignores drain attributions for other recipients", () => {
    const detail = deriveBeneficiaryDetail({
      recipient: childRecipient,
      firstTransfers: [],
      secondTransfers: [transfer({ deathOrder: 2, amount: 100_000 })],
      firstDrainAttributions: [],
      secondDrainAttributions: [
        attribution({ recipientId: "fm-other", drainKind: "federal_estate_tax", amount: 999_999 }),
      ],
      tree: emptyTree(),
    });
    expect(detail.fromSecondDeath.drains.federal_estate_tax).toBe(0);
    expect(detail.fromSecondDeath.net).toBeCloseTo(100_000);
  });
});

describe("deriveBeneficiaryDetail — trust pass-through", () => {
  it("includes pro-rata pass-through when recipient is a primary beneficiary", () => {
    const trust: EntitySummary = {
      id: "trust-1",
      name: "Special Needs Trust",
      includeInPortfolio: false,
      isGrantor: false,
      beneficiaries: [
        { id: "br-1", tier: "primary", percentage: 50, familyMemberId: "fm-1", sortOrder: 0 },
        { id: "br-2", tier: "primary", percentage: 50, familyMemberId: "fm-2", sortOrder: 1 },
      ],
    };
    const detail = deriveBeneficiaryDetail({
      recipient: childRecipient,
      firstTransfers: [],
      secondTransfers: [
        transfer({
          deathOrder: 2,
          recipientKind: "entity",
          recipientId: "trust-1",
          recipientLabel: "Special Needs Trust",
          amount: 200_000,
        }),
      ],
      firstDrainAttributions: [],
      secondDrainAttributions: [],
      tree: emptyTree({ entities: [trust] }),
    });
    expect(detail.inTrust).toHaveLength(1);
    expect(detail.inTrust[0].trustName).toBe("Special Needs Trust");
    expect(detail.inTrust[0].primaryPercentage).toBe(50);
    expect(detail.inTrust[0].amount).toBeCloseTo(100_000);
    expect(detail.total).toBeCloseTo(100_000);
  });

  it("ignores contingent-tier beneficiaries", () => {
    const trust: EntitySummary = {
      id: "trust-1",
      name: "Contingent Trust",
      includeInPortfolio: false,
      isGrantor: false,
      beneficiaries: [
        { id: "br-1", tier: "contingent", percentage: 100, familyMemberId: "fm-1", sortOrder: 0 },
      ],
    };
    const detail = deriveBeneficiaryDetail({
      recipient: childRecipient,
      firstTransfers: [],
      secondTransfers: [
        transfer({
          deathOrder: 2,
          recipientKind: "entity",
          recipientId: "trust-1",
          recipientLabel: "Contingent Trust",
          amount: 200_000,
        }),
      ],
      firstDrainAttributions: [],
      secondDrainAttributions: [],
      tree: emptyTree({ entities: [trust] }),
    });
    expect(detail.inTrust).toEqual([]);
  });

  it("returns empty inTrust when trust has no beneficiaries array", () => {
    const trust: EntitySummary = {
      id: "trust-1",
      name: "Empty Trust",
      includeInPortfolio: false,
      isGrantor: false,
    };
    const detail = deriveBeneficiaryDetail({
      recipient: childRecipient,
      firstTransfers: [],
      secondTransfers: [
        transfer({
          deathOrder: 2,
          recipientKind: "entity",
          recipientId: "trust-1",
          recipientLabel: "Empty Trust",
          amount: 200_000,
        }),
      ],
      firstDrainAttributions: [],
      secondDrainAttributions: [],
      tree: emptyTree({ entities: [trust] }),
    });
    expect(detail.inTrust).toEqual([]);
  });

  it("aggregates funding across both deaths before applying primary percentage", () => {
    const trust: EntitySummary = {
      id: "trust-1",
      name: "Two-Death Trust",
      includeInPortfolio: false,
      isGrantor: false,
      beneficiaries: [
        { id: "br-1", tier: "primary", percentage: 100, familyMemberId: "fm-1", sortOrder: 0 },
      ],
    };
    const detail = deriveBeneficiaryDetail({
      recipient: childRecipient,
      firstTransfers: [
        transfer({
          recipientKind: "entity",
          recipientId: "trust-1",
          recipientLabel: "Two-Death Trust",
          amount: 50_000,
        }),
      ],
      secondTransfers: [
        transfer({
          deathOrder: 2,
          recipientKind: "entity",
          recipientId: "trust-1",
          recipientLabel: "Two-Death Trust",
          amount: 150_000,
        }),
      ],
      firstDrainAttributions: [],
      secondDrainAttributions: [],
      tree: emptyTree({ entities: [trust] }),
    });
    expect(detail.inTrust).toHaveLength(1);
    expect(detail.inTrust[0].amount).toBeCloseTo(200_000);
  });

  it("supports external_beneficiary recipients via externalBeneficiaryId", () => {
    const charityRecipient = {
      kind: "external_beneficiary" as const,
      id: "ext-1",
      name: "ABC Foundation",
      relationship: null,
    };
    const trust: EntitySummary = {
      id: "trust-1",
      name: "Charitable Trust",
      includeInPortfolio: false,
      isGrantor: false,
      beneficiaries: [
        { id: "br-1", tier: "primary", percentage: 100, externalBeneficiaryId: "ext-1", sortOrder: 0 },
      ],
    };
    const detail = deriveBeneficiaryDetail({
      recipient: charityRecipient,
      firstTransfers: [],
      secondTransfers: [
        transfer({
          deathOrder: 2,
          recipientKind: "entity",
          recipientId: "trust-1",
          recipientLabel: "Charitable Trust",
          amount: 250_000,
        }),
      ],
      firstDrainAttributions: [],
      secondDrainAttributions: [],
      tree: emptyTree({ entities: [trust] }),
    });
    expect(detail.inTrust).toHaveLength(1);
    expect(detail.inTrust[0].amount).toBeCloseTo(250_000);
  });
});
