import { describe, it, expect } from "vitest";
import type {
  DeathSectionData,
  EstateTransferReportData,
  RecipientGroup,
  ReductionsLine,
  MechanismBreakdown,
  AssetTransferLine,
} from "@/lib/estate/transfer-report";
import type { ClientData } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { buildEstateFlowSummary } from "@/lib/estate/estate-flow-summary";

const ZERO_DRAINS: RecipientGroup["drainsByKind"] = {
  federal_estate_tax: 0,
  state_estate_tax: 0,
  admin_expenses: 0,
  debts_paid: 0,
  ird_tax: 0,
};

function asset(
  label: string,
  amount: number,
  extras: Partial<AssetTransferLine> = {},
): AssetTransferLine {
  return {
    sourceAccountId: extras.sourceAccountId ?? `acct-${label}`,
    sourceLiabilityId: extras.sourceLiabilityId ?? null,
    label,
    amount,
    basis: extras.basis ?? amount,
    conflictIds: extras.conflictIds ?? [],
    ...extras,
  };
}

function mech(
  mechanism: MechanismBreakdown["mechanism"],
  assets: AssetTransferLine[],
): MechanismBreakdown {
  return {
    mechanism,
    mechanismLabel: mechanism,
    total: assets.reduce((s, a) => s + a.amount, 0),
    assets,
  };
}

function group(opts: {
  key: string;
  kind: RecipientGroup["recipientKind"];
  label: string;
  byMechanism: MechanismBreakdown[];
  drains?: Partial<RecipientGroup["drainsByKind"]>;
  recipientId?: string | null;
}): RecipientGroup {
  const total = opts.byMechanism.reduce((s, m) => s + m.total, 0);
  const drains = { ...ZERO_DRAINS, ...(opts.drains ?? {}) };
  const drainSum =
    drains.federal_estate_tax +
    drains.state_estate_tax +
    drains.admin_expenses +
    drains.debts_paid +
    drains.ird_tax;
  return {
    key: opts.key,
    recipientKind: opts.kind,
    recipientId: opts.recipientId ?? null,
    recipientLabel: opts.label,
    total,
    byMechanism: opts.byMechanism,
    drainsByKind: drains,
    netTotal: total - drainSum,
  };
}

function reduction(
  kind: ReductionsLine["kind"],
  amount: number,
): ReductionsLine {
  return { kind, label: kind, amount };
}

function deathSection(opts: {
  decedent: "client" | "spouse";
  decedentName: string;
  year: number;
  recipients: RecipientGroup[];
  reductions: ReductionsLine[];
  taxableEstate?: number;
}): DeathSectionData {
  const assetEstateValue = opts.recipients.reduce((s, g) => s + g.total, 0);
  return {
    decedent: opts.decedent,
    decedentName: opts.decedentName,
    year: opts.year,
    taxableEstate: opts.taxableEstate ?? assetEstateValue,
    assetEstateValue,
    assetCount: opts.recipients.flatMap((r) =>
      r.byMechanism.flatMap((m) => m.assets),
    ).length,
    recipients: opts.recipients,
    reductions: opts.reductions,
    conflicts: [],
    reconciliation: {
      sumLiabilityTransfers: 0,
      sumRecipients: assetEstateValue,
      sumReductions: opts.reductions.reduce((s, r) => s + r.amount, 0),
      unattributed: 0,
      reconciles: true,
    },
  };
}

function emptyClientData(): ClientData {
  return {
    client: {
      firstName: "Cooper",
      lastName: "Sample",
      dateOfBirth: "1960-01-01",
      retirementAge: 65,
      planEndAge: 95,
      filingStatus: "married_joint",
      spouseName: "Susan",
      spouseDob: "1962-01-01",
      spouseRetirementAge: 65,
    },
    accounts: [],
    liabilities: [],
    entities: [],
    incomeSources: [],
    expenses: [],
  } as unknown as ClientData;
}

function baseInput(overrides: Partial<EstateTransferReportData> = {}): {
  reportData: EstateTransferReportData;
  clientData: ClientData;
  gifts: EstateFlowGift[];
  ownerNames: { clientName: string; spouseName: string | null };
} {
  return {
    reportData: {
      ordering: "primaryFirst",
      asOfLabel: "Both die in 2026",
      firstDeath: null,
      secondDeath: null,
      aggregateRecipientTotals: [],
      isEmpty: false,
      ...overrides,
    },
    clientData: emptyClientData(),
    gifts: [],
    ownerNames: { clientName: "Cooper", spouseName: "Susan" },
  };
}

describe("buildEstateFlowSummary — second death sub-boxes", () => {
  it("produces taxes + heirs_outright sub-boxes from secondDeath", () => {
    const secondDeath = deathSection({
      decedent: "spouse",
      decedentName: "Susan",
      year: 2030,
      recipients: [
        group({
          key: "caroline",
          kind: "family_member",
          label: "Caroline Sample",
          byMechanism: [mech("will_residuary", [asset("Home", 100_000)])],
        }),
      ],
      reductions: [reduction("admin_expenses", -5_000)],
    });

    const input = baseInput({ secondDeath });
    const summary = buildEstateFlowSummary(input)!;

    expect(summary.secondDeath).not.toBeNull();
    expect(summary.secondDeath!.decedentLabel).toBe("Susan's Estate");
    expect(summary.secondDeath!.year).toBe(2030);
    expect(summary.secondDeath!.estateValue).toBe(100_000);

    const subBoxes = summary.secondDeath!.subBoxes;
    const taxes = subBoxes.find((b) => b.kind === "taxes")!;
    expect(taxes.total).toBe(-5_000);

    const heirs = subBoxes.find((b) => b.kind === "heirs_outright")!;
    expect(heirs.label).toBe("Heirs");
    expect(heirs.total).toBe(100_000);

    expect(subBoxes.find((b) => b.kind === "inheritance_spouse")).toBeUndefined();
    expect(subBoxes.find((b) => b.kind === "trusts")).toBeUndefined();
  });
});

describe("buildEstateFlowSummary — entity disambiguation", () => {
  it("filters trusts sub-box by entityType, excluding non-trust entities", () => {
    const clientData = emptyClientData();
    clientData.entities = [
      { id: "trust-1", entityType: "trust", name: "Family Trust" },
      { id: "llc-1", entityType: "llc", name: "Family LLC" },
    ] as ClientData["entities"];

    const secondDeath = deathSection({
      decedent: "spouse",
      decedentName: "Susan",
      year: 2030,
      recipients: [
        group({
          key: "trust-1",
          kind: "entity",
          recipientId: "trust-1",
          label: "Family Trust",
          byMechanism: [mech("will", [asset("Cash", 100_000)])],
        }),
        group({
          key: "llc-1",
          kind: "entity",
          recipientId: "llc-1",
          label: "Family LLC",
          byMechanism: [mech("will", [asset("LLC Interest", 200_000)])],
        }),
      ],
      reductions: [],
    });

    const summary = buildEstateFlowSummary({
      ...baseInput({ secondDeath }),
      clientData,
    })!;
    const trusts = summary.secondDeath!.subBoxes.find((b) => b.kind === "trusts")!;
    expect(trusts.total).toBe(100_000);
  });
});

describe("buildEstateFlowSummary — spouseNetWorth", () => {
  it("returns the surviving spouse's separately-owned account total", () => {
    const clientData = emptyClientData();
    clientData.familyMembers = [
      { id: "fm-client", role: "client", firstName: "Cooper" },
      { id: "fm-spouse", role: "spouse", firstName: "Susan" },
    ] as ClientData["familyMembers"];
    clientData.accounts = [
      {
        id: "a1",
        name: "Susan Roth",
        owners: [{ kind: "family_member", familyMemberId: "fm-spouse", percent: 1 }],
        value: 500_000,
      },
      {
        id: "a2",
        name: "Joint",
        owners: [
          { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
          { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
        ],
        value: 200_000,
      },
      {
        id: "a3",
        name: "Cooper Solo",
        owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        value: 999_999,
      },
    ] as unknown as ClientData["accounts"];

    const firstDeath = deathSection({
      decedent: "client",
      decedentName: "Cooper",
      year: 2028,
      recipients: [],
      reductions: [],
    });

    const summary = buildEstateFlowSummary({
      ...baseInput({ firstDeath }),
      clientData,
    })!;

    expect(summary.spouseNetWorth).toEqual({
      ownerLabel: "Susan",
      amount: 500_000,
    });
  });

  it("is null for a single-filer household", () => {
    const summary = buildEstateFlowSummary({
      ...baseInput({
        secondDeath: deathSection({
          decedent: "client",
          decedentName: "Cooper",
          year: 2030,
          recipients: [],
          reductions: [],
        }),
      }),
      ownerNames: { clientName: "Cooper", spouseName: null },
    })!;
    expect(summary.spouseNetWorth).toBeNull();
  });
});

describe("buildEstateFlowSummary — out of estate", () => {
  it("groups irrevocable trusts under irrevTrusts; 529 plans under heirs", () => {
    const clientData = emptyClientData();
    clientData.familyMembers = [
      { id: "fm-client", role: "client", firstName: "Cooper" },
      { id: "fm-caroline", role: "child", firstName: "Caroline" },
    ] as ClientData["familyMembers"];
    clientData.entities = [
      {
        id: "snt",
        entityType: "trust",
        isIrrevocable: true,
        name: "Special Needs Trust FBO Kevin",
      },
      {
        id: "rev",
        entityType: "trust",
        isIrrevocable: false,
        name: "Revocable Living Trust",
      },
    ] as ClientData["entities"];
    clientData.accounts = [
      {
        id: "529-caroline",
        name: "529 Plan - Caroline",
        subType: "529",
        value: 30_000,
        owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
      },
      {
        id: "snt-acct",
        name: "Trust Account",
        subType: "brokerage",
        value: 150_000,
        owners: [{ kind: "entity", entityId: "snt", percent: 1 }],
      },
      {
        id: "snt-acct-2",
        name: "Trust Cash",
        subType: "checking",
        value: 25_000,
        owners: [{ kind: "entity", entityId: "snt", percent: 1 }],
      },
      {
        id: "rev-acct",
        name: "Revocable Trust Brokerage",
        subType: "brokerage",
        value: 500_000,
        owners: [{ kind: "entity", entityId: "rev", percent: 1 }],
      },
      {
        id: "personal",
        name: "Joint Brokerage",
        subType: "brokerage",
        value: 999_999,
        owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
      },
    ] as unknown as ClientData["accounts"];

    const summary = buildEstateFlowSummary({
      ...baseInput({}),
      clientData,
    })!;

    expect(summary.outOfEstate.heirs.total).toBe(30_000);
    expect(summary.outOfEstate.heirs.entities).toEqual([
      expect.objectContaining({
        entityId: "529-caroline",
        entityLabel: "529 Plan - Caroline",
        amount: 30_000,
        assets: [{ label: "529 Plan - Caroline", amount: 30_000 }],
      }),
    ]);

    expect(summary.outOfEstate.irrevTrusts.total).toBe(175_000);
    expect(summary.outOfEstate.irrevTrusts.entities).toEqual([
      expect.objectContaining({
        entityId: "snt",
        entityLabel: "Special Needs Trust FBO Kevin",
        amount: 175_000,
      }),
    ]);
    expect(summary.outOfEstate.irrevTrusts.entities[0].assets).toEqual([
      { label: "Trust Account", amount: 150_000 },
      { label: "Trust Cash", amount: 25_000 },
    ]);
  });

  it("returns empty buckets when no OOE entities or 529 accounts exist", () => {
    const summary = buildEstateFlowSummary({
      ...baseInput({}),
      clientData: emptyClientData(),
    })!;
    expect(summary.outOfEstate.heirs).toEqual({ total: 0, entities: [] });
    expect(summary.outOfEstate.irrevTrusts).toEqual({ total: 0, entities: [] });
  });
});

describe("buildEstateFlowSummary — first death sub-boxes", () => {
  it("emits taxes + trusts + inheritance_spouse for a married first death", () => {
    const clientData = emptyClientData();
    clientData.entities = [
      { id: "snt", entityType: "trust", name: "Special Needs Trust FBO Kevin" },
    ] as ClientData["entities"];

    const firstDeath = deathSection({
      decedent: "client",
      decedentName: "Cooper",
      year: 2028,
      recipients: [
        group({
          key: "snt",
          kind: "entity",
          recipientId: "snt",
          label: "Special Needs Trust FBO Kevin",
          byMechanism: [mech("will", [asset("Joint Account", 50_000)])],
        }),
        group({
          key: "susan",
          kind: "spouse",
          label: "Susan Sample",
          byMechanism: [mech("titling", [asset("Home", 175_000), asset("401k", 400_000)])],
        }),
      ],
      reductions: [reduction("admin_expenses", -3_900)],
    });

    const summary = buildEstateFlowSummary({
      ...baseInput({ firstDeath }),
      clientData,
    })!;
    const stage = summary.firstDeath!;

    expect(stage.decedentLabel).toBe("Cooper's Estate");
    expect(stage.estateValue).toBe(625_000);

    const kinds = stage.subBoxes.map((b) => b.kind);
    expect(kinds).toEqual(["taxes", "trusts", "inheritance_spouse"]);

    const inheritance = stage.subBoxes.find(
      (b) => b.kind === "inheritance_spouse",
    )!;
    expect(inheritance.total).toBe(575_000);
    expect(inheritance.targetLabel).toBe("Susan's Estate");

    const trusts = stage.subBoxes.find((b) => b.kind === "trusts")!;
    expect(trusts.total).toBe(50_000);
  });
});
