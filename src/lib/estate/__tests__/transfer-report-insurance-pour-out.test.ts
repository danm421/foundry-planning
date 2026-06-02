import { describe, it, expect } from "vitest";
import { buildEstateTransferReportData } from "../transfer-report";
import type {
  ClientData,
  DeathTransfer,
  EstateTaxResult,
} from "@/engine/types";
import type { ProjectionResult } from "@/engine";

function emptyEstateTaxResult(deathOrder: 1 | 2): EstateTaxResult {
  return {
    deathOrder,
    federalEstateTax: 0,
    stateEstateTax: 0,
    estateAdminExpenses: 0,
    drainAttributions: [],
    creditorPayoffDebits: [],
    estateTaxDebits: [],
  } as unknown as EstateTaxResult;
}

function makeProjection(args: {
  deathYear: number;
  pourOutAmount: number;
}): ProjectionResult {
  const transfer: DeathTransfer = {
    via: "trust_pour_out",
    recipientKind: "family_member",
    recipientId: "fm-child",
    sourceAccountId: "pol-1",
    sourceAccountName: "Alice Term 20",
    sourceLiabilityId: null,
    sourceLiabilityName: null,
    amount: args.pourOutAmount,
    basis: 0,
    deathOrder: 2,
  } as DeathTransfer;

  return {
    years: [],
    todayHypotheticalEstateTax: {
      year: args.deathYear,
      primaryFirst: {
        firstDecedent: "client",
        firstDeath: emptyEstateTaxResult(1),
        firstDeathTransfers: [],
        finalDeath: emptyEstateTaxResult(2),
        finalDeathTransfers: [transfer],
      },
    },
  } as unknown as ProjectionResult;
}

const clientData = {
  client: {
    firstName: "Alice",
    lastName: "Smith",
    spouseName: "Bob",
    dateOfBirth: "1970-01-01",
    spouseDob: "1972-01-01",
    retirementAge: 65,
    spouseRetirementAge: 67,
    planEndAge: 95,
    filingStatus: "married_joint",
  },
  familyMembers: [
    { id: "fm-c", role: "client", firstName: "Alice", relationship: "other", lastName: "Smith", dateOfBirth: "1970-01-01" },
    { id: "fm-s", role: "spouse", firstName: "Bob", relationship: "other", lastName: "Smith", dateOfBirth: "1972-01-01" },
    { id: "fm-child", role: "child", firstName: "Janet", relationship: "child", lastName: "Smith", dateOfBirth: "2000-01-01" },
  ],
  entities: [
    {
      id: "ilit-1",
      name: "Alice ILIT",
      entityType: "trust",
      isIrrevocable: true,
      remainderBeneficiaries: [
        { familyMemberId: "fm-child", percentage: 100, distributionForm: "outright" },
      ],
    },
  ],
  accounts: [
    {
      id: "pol-1",
      name: "Alice Term 20",
      category: "life_insurance",
      subType: "term",
      value: 5_000,
      basis: 0,
      growthRate: 0,
      rmdEnabled: false,
      insuredPerson: "client",
      lifeInsurance: {
        faceValue: 1_000_000,
        costBasis: 0,
        premiumAmount: 2000,
        premiumYears: 20,
        policyType: "term",
        termIssueYear: 2020,
        termLengthYears: 30,
        endsAtInsuredRetirement: false,
        cashValueGrowthMode: "basic",
        postPayoutGrowthRate: 0,
        cashValueSchedule: [],
      },
      owners: [{ kind: "entity", entityId: "ilit-1", percent: 1 }],
    },
  ],
  wills: [],
  liabilities: [],
} as unknown as ClientData;

describe("buildEstateTransferReportData — insurance pour-out at second death", () => {
  it("substitutes face value for an in-force ILIT-owned policy", () => {
    const projection = makeProjection({ deathYear: 2030, pourOutAmount: 5_000 });

    const out = buildEstateTransferReportData({
      projection,
      asOf: { kind: "today" },
      ordering: "primaryFirst",
      clientData,
      ownerNames: { clientName: "Alice", spouseName: "Bob" },
    });

    expect(out.secondDeath).not.toBeNull();
    const recipient = out.secondDeath!.recipients.find((r) => r.recipientId === "fm-child");
    expect(recipient).toBeDefined();
    const pourOut = recipient!.byMechanism.find((m) => m.mechanism === "trust_pour_out");
    expect(pourOut).toBeDefined();
    const assetRow = pourOut!.assets.find((a) => a.sourceAccountId === "pol-1");
    expect(assetRow!.amount).toBe(1_000_000);
  });

  it("keeps cash value when the policy is past term", () => {
    const baseAccounts = clientData.accounts ?? [];
    const baseAccount = baseAccounts[0];
    const lapsed = {
      ...clientData,
      accounts: [
        {
          ...baseAccount,
          lifeInsurance: {
            ...baseAccount.lifeInsurance,
            termIssueYear: 1990,
            termLengthYears: 20, // expires 2010
          },
        },
      ],
    } as unknown as ClientData;
    const projection = makeProjection({ deathYear: 2030, pourOutAmount: 5_000 });

    const out = buildEstateTransferReportData({
      projection,
      asOf: { kind: "today" },
      ordering: "primaryFirst",
      clientData: lapsed,
      ownerNames: { clientName: "Alice", spouseName: "Bob" },
    });

    const assetRow = out
      .secondDeath!.recipients.find((r) => r.recipientId === "fm-child")!
      .byMechanism.find((m) => m.mechanism === "trust_pour_out")!
      .assets.find((a) => a.sourceAccountId === "pol-1")!;
    expect(assetRow.amount).toBe(5_000);
  });

  it("carries distributionForm from the trust's remainderBeneficiaries", () => {
    const projection = makeProjection({ deathYear: 2030, pourOutAmount: 5_000 });

    const out = buildEstateTransferReportData({
      projection,
      asOf: { kind: "today" },
      ordering: "primaryFirst",
      clientData,
      ownerNames: { clientName: "Alice", spouseName: "Bob" },
    });

    const assetRow = out
      .secondDeath!.recipients.find((r) => r.recipientId === "fm-child")!
      .byMechanism.find((m) => m.mechanism === "trust_pour_out")!
      .assets.find((a) => a.sourceAccountId === "pol-1")!;
    expect(assetRow.distributionForm).toBe("outright");
  });

  it("renders distributionForm='in_trust' when the trust says so", () => {
    const inTrustClient = {
      ...clientData,
      entities: [
        {
          ...(clientData.entities ?? [])[0],
          remainderBeneficiaries: [
            { familyMemberId: "fm-child", percentage: 100, distributionForm: "in_trust" },
          ],
        },
      ],
    } as unknown as ClientData;
    const projection = makeProjection({ deathYear: 2030, pourOutAmount: 5_000 });

    const out = buildEstateTransferReportData({
      projection,
      asOf: { kind: "today" },
      ordering: "primaryFirst",
      clientData: inTrustClient,
      ownerNames: { clientName: "Alice", spouseName: "Bob" },
    });

    const assetRow = out
      .secondDeath!.recipients.find((r) => r.recipientId === "fm-child")!
      .byMechanism.find((m) => m.mechanism === "trust_pour_out")!
      .assets.find((a) => a.sourceAccountId === "pol-1")!;
    expect(assetRow.distributionForm).toBe("in_trust");
  });

  it("omits distributionForm when the trust has no matching remainder bene", () => {
    const noRemainderClient = {
      ...clientData,
      entities: [
        { ...(clientData.entities ?? [])[0], remainderBeneficiaries: [] },
      ],
    } as unknown as ClientData;
    const projection = makeProjection({ deathYear: 2030, pourOutAmount: 5_000 });

    const out = buildEstateTransferReportData({
      projection,
      asOf: { kind: "today" },
      ordering: "primaryFirst",
      clientData: noRemainderClient,
      ownerNames: { clientName: "Alice", spouseName: "Bob" },
    });

    const assetRow = out
      .secondDeath!.recipients.find((r) => r.recipientId === "fm-child")!
      .byMechanism.find((m) => m.mechanism === "trust_pour_out")!
      .assets.find((a) => a.sourceAccountId === "pol-1")!;
    expect(assetRow.distributionForm).toBeUndefined();
  });
});
