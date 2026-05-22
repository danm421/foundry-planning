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
  // Drains in this fixture are written as negative signed deductions (e.g.
  // -1_000 admin expenses) — mirrors how `ReductionsLine` carries signed
  // amounts in this file. netTotal therefore *adds* drains: a negative drain
  // reduces gross. (The real engine stores positive drain magnitudes and
  // subtracts; this helper is fixture-only.)
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
    netTotal: total + drainSum,
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

describe("buildEstateFlowSummary — heir composition rule 1: at-death receipts", () => {
  it("sums person netTotal across both deaths into Outright", () => {
    const firstDeath = deathSection({
      decedent: "client",
      decedentName: "Cooper",
      year: 2028,
      recipients: [
        group({
          key: "kevin",
          kind: "family_member",
          recipientId: "kevin",
          label: "Kevin Sample",
          byMechanism: [mech("will", [asset("Joint", 50_000)])],
          drains: { admin_expenses: -1_000 },
        }),
      ],
      reductions: [],
    });
    const secondDeath = deathSection({
      decedent: "spouse",
      decedentName: "Susan",
      year: 2032,
      recipients: [
        group({
          key: "kevin",
          kind: "family_member",
          recipientId: "kevin",
          label: "Kevin Sample",
          byMechanism: [
            mech("will_residuary", [asset("401k", 400_000)]),
          ],
          drains: { ird_tax: -70_000 },
        }),
        group({
          key: "caroline",
          kind: "family_member",
          recipientId: "caroline",
          label: "Caroline Sample",
          byMechanism: [
            mech("will_residuary", [asset("Home", 175_000)]),
          ],
        }),
      ],
      reductions: [],
    });

    const summary = buildEstateFlowSummary(
      baseInput({ firstDeath, secondDeath }),
    )!;

    const kevin = summary.heirBoxes.find((h) => h.recipientLabel === "Kevin Sample")!;
    expect(kevin.outright).toBe(49_000 + 330_000); // 50k-1k + 400k-70k
    expect(kevin.inTrust).toBe(0);
    expect(kevin.total).toBe(379_000);

    const caroline = summary.heirBoxes.find((h) => h.recipientLabel === "Caroline Sample")!;
    expect(caroline.outright).toBe(175_000);
    expect(caroline.inTrust).toBe(0);
    expect(caroline.total).toBe(175_000);

    // sorted desc by total
    expect(summary.heirBoxes.map((h) => h.recipientLabel)).toEqual([
      "Kevin Sample",
      "Caroline Sample",
    ]);
  });
});

describe("buildEstateFlowSummary — heir composition rule 2: bequest to trust", () => {
  it("attributes a trust bequest to its single 100% remainder beneficiary as inTrust", () => {
    const clientData = emptyClientData();
    clientData.familyMembers = [
      { id: "fm-client", role: "client", firstName: "Cooper", lastName: "Sample" },
      { id: "fm-kevin", role: "child", firstName: "Kevin", lastName: "Sample" },
    ] as ClientData["familyMembers"];
    clientData.entities = [
      {
        id: "snt",
        entityType: "trust",
        isIrrevocable: true,
        name: "Special Needs Trust FBO Kevin",
        remainderBeneficiaries: [
          {
            familyMemberId: "fm-kevin",
            percentage: 1,
            distributionForm: "in_trust",
          },
        ],
      },
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
      ],
      reductions: [],
    });

    const summary = buildEstateFlowSummary({
      ...baseInput({ firstDeath }),
      clientData,
    })!;

    const kevin = summary.heirBoxes.find((h) =>
      h.recipientLabel.includes("Kevin"),
    )!;
    expect(kevin).toBeDefined();
    expect(kevin.inTrust).toBe(50_000);
    expect(kevin.outright).toBe(0);
    expect(kevin.total).toBe(50_000);
  });

  it("splits a trust bequest equally between two remainder beneficiaries", () => {
    const clientData = emptyClientData();
    clientData.familyMembers = [
      { id: "fm-client", role: "client", firstName: "Cooper", lastName: "Sample" },
      { id: "fm-kevin", role: "child", firstName: "Kevin", lastName: "Sample" },
      { id: "fm-caroline", role: "child", firstName: "Caroline", lastName: "Sample" },
    ] as ClientData["familyMembers"];
    clientData.entities = [
      {
        id: "ft",
        entityType: "trust",
        isIrrevocable: true,
        name: "Family Trust",
        remainderBeneficiaries: [
          {
            familyMemberId: "fm-caroline",
            percentage: 0.5,
            distributionForm: "in_trust",
          },
          {
            familyMemberId: "fm-kevin",
            percentage: 0.5,
            distributionForm: "in_trust",
          },
        ],
      },
    ] as ClientData["entities"];

    const firstDeath = deathSection({
      decedent: "client",
      decedentName: "Cooper",
      year: 2028,
      recipients: [
        group({
          key: "ft",
          kind: "entity",
          recipientId: "ft",
          label: "Family Trust",
          byMechanism: [mech("will", [asset("Cash", 100_000)])],
        }),
      ],
      reductions: [],
    });

    const summary = buildEstateFlowSummary({
      ...baseInput({ firstDeath }),
      clientData,
    })!;

    const kevin = summary.heirBoxes.find((h) =>
      h.recipientLabel.includes("Kevin"),
    )!;
    const caroline = summary.heirBoxes.find((h) =>
      h.recipientLabel.includes("Caroline"),
    )!;
    expect(kevin).toBeDefined();
    expect(caroline).toBeDefined();
    expect(kevin.inTrust).toBe(50_000);
    expect(caroline.inTrust).toBe(50_000);
    expect(kevin.outright).toBe(0);
    expect(caroline.outright).toBe(0);
  });
});

describe("buildEstateFlowSummary — heir composition rule 3: OOE attribution", () => {
  it("attributes a 529 plan to its primary account beneficiary as Outright", () => {
    const clientData = emptyClientData();
    clientData.familyMembers = [
      { id: "fm-client", role: "client", firstName: "Cooper", lastName: "Sample" },
      { id: "fm-caroline", role: "child", firstName: "Caroline", lastName: "Sample" },
    ] as ClientData["familyMembers"];
    clientData.accounts = [
      {
        id: "529-caroline",
        name: "529 Plan - Caroline",
        subType: "529",
        value: 30_000,
        owners: [
          { kind: "family_member", familyMemberId: "fm-client", percent: 1 },
        ],
        beneficiaries: [
          {
            id: "b1",
            tier: "primary",
            familyMemberId: "fm-caroline",
            percentage: 1,
            sortOrder: 0,
          },
        ],
      },
    ] as unknown as ClientData["accounts"];

    const summary = buildEstateFlowSummary({
      ...baseInput({}),
      clientData,
    })!;

    const caroline = summary.heirBoxes.find((h) =>
      h.recipientLabel.includes("Caroline"),
    )!;
    expect(caroline).toBeDefined();
    expect(caroline.outright).toBe(30_000);
    expect(caroline.inTrust).toBe(0);
    expect(caroline.total).toBe(30_000);
  });

  it("attributes an irrevocable trust to its remainder beneficiary as inTrust", () => {
    const clientData = emptyClientData();
    clientData.familyMembers = [
      { id: "fm-client", role: "client", firstName: "Cooper", lastName: "Sample" },
      { id: "fm-kevin", role: "child", firstName: "Kevin", lastName: "Sample" },
    ] as ClientData["familyMembers"];
    clientData.entities = [
      {
        id: "snt",
        entityType: "trust",
        isIrrevocable: true,
        name: "Special Needs Trust FBO Kevin",
        remainderBeneficiaries: [
          {
            familyMemberId: "fm-kevin",
            percentage: 1,
            distributionForm: "in_trust",
          },
        ],
      },
    ] as ClientData["entities"];
    clientData.accounts = [
      {
        id: "snt-acct",
        name: "Trust Brokerage",
        subType: "brokerage",
        value: 150_000,
        owners: [{ kind: "entity", entityId: "snt", percent: 1 }],
      },
    ] as unknown as ClientData["accounts"];

    const summary = buildEstateFlowSummary({
      ...baseInput({}),
      clientData,
    })!;

    const kevin = summary.heirBoxes.find((h) =>
      h.recipientLabel.includes("Kevin"),
    )!;
    expect(kevin).toBeDefined();
    expect(kevin.inTrust).toBe(150_000);
    expect(kevin.outright).toBe(0);
    expect(kevin.total).toBe(150_000);
  });
});

describe("buildEstateFlowSummary — heir composition rules 4 & 5: lifetime gifts", () => {
  it("attributes a lifetime cash gift to a family member as Outright (rule 4)", () => {
    const clientData = emptyClientData();
    clientData.familyMembers = [
      { id: "fm-client", role: "client", firstName: "Cooper", lastName: "Sample" },
      { id: "fm-caroline", role: "child", firstName: "Caroline", lastName: "Sample" },
    ] as ClientData["familyMembers"];

    const gifts: EstateFlowGift[] = [
      {
        kind: "cash-once",
        id: "g1",
        year: 2026,
        amount: 18_000,
        grantor: "client",
        recipient: { kind: "family_member", id: "fm-caroline" },
        crummey: false,
      },
    ];

    const summary = buildEstateFlowSummary({
      ...baseInput({}),
      clientData,
      gifts,
    })!;

    const caroline = summary.heirBoxes.find((h) =>
      h.recipientLabel.includes("Caroline"),
    )!;
    expect(caroline).toBeDefined();
    expect(caroline.outright).toBe(18_000);
    expect(caroline.inTrust).toBe(0);
    expect(caroline.total).toBe(18_000);
  });

  it("attributes a lifetime cash gift to a trust to its remainder beneficiaries as inTrust (rule 5)", () => {
    const clientData = emptyClientData();
    clientData.familyMembers = [
      { id: "fm-client", role: "client", firstName: "Cooper", lastName: "Sample" },
      { id: "fm-kevin", role: "child", firstName: "Kevin", lastName: "Sample" },
    ] as ClientData["familyMembers"];
    clientData.entities = [
      {
        id: "slat",
        entityType: "trust",
        isIrrevocable: true,
        name: "Spousal Lifetime Access Trust",
        remainderBeneficiaries: [
          {
            familyMemberId: "fm-kevin",
            percentage: 1,
            distributionForm: "in_trust",
          },
        ],
      },
    ] as ClientData["entities"];

    const gifts: EstateFlowGift[] = [
      {
        kind: "cash-once",
        id: "g1",
        year: 2026,
        amount: 250_000,
        grantor: "client",
        recipient: { kind: "entity", id: "slat" },
        crummey: false,
      },
    ];

    const summary = buildEstateFlowSummary({
      ...baseInput({}),
      clientData,
      gifts,
    })!;

    const kevin = summary.heirBoxes.find((h) =>
      h.recipientLabel.includes("Kevin"),
    )!;
    expect(kevin).toBeDefined();
    expect(kevin.outright).toBe(0);
    expect(kevin.inTrust).toBe(250_000);
    expect(kevin.total).toBe(250_000);
  });
});

describe("buildEstateFlowSummary — merge contract", () => {
  it("merges a bequest and a trust remainder for the spouse into ONE heir box when the trust beneficiary is declared via householdRole", () => {
    // The engine emits at-death residuary groups keyed by familyMemberId. A
    // trust remainder declared via householdRole='spouse' must resolve to the
    // matching familyMembers[] id so the two contributions land in the same
    // heir box. Without that resolution the trust contribution gets its own
    // box keyed by the literal string "spouse".
    const clientData = emptyClientData();
    clientData.familyMembers = [
      { id: "fm-client", role: "client", firstName: "Cooper", lastName: "Sample" },
      { id: "fm-susan", role: "spouse", firstName: "Susan", lastName: "Sample" },
    ] as ClientData["familyMembers"];
    clientData.entities = [
      {
        id: "ft",
        entityType: "trust",
        isIrrevocable: true,
        name: "Family Trust",
        remainderBeneficiaries: [
          {
            // householdRole-keyed beneficiary — should resolve to fm-susan.
            householdRole: "spouse",
            percentage: 1,
            distributionForm: "in_trust",
          },
        ],
      },
    ] as ClientData["entities"];

    // We use a secondDeath section because spouse-kind groups in firstDeath
    // are funnelled into the inheritance_spouse sub-box; the heir-box merge
    // surface we want to lock is the post-secondDeath residuary path. Here
    // we model: $50k outright to Susan keyed by family_member at secondDeath
    // plus $100k trust contribution whose remainder beneficiary is "spouse".
    const secondDeath = deathSection({
      decedent: "client",
      decedentName: "Cooper",
      year: 2032,
      recipients: [
        group({
          key: "fm-susan",
          kind: "family_member",
          recipientId: "fm-susan",
          label: "Susan Sample",
          byMechanism: [mech("will", [asset("Cash", 50_000)])],
        }),
        group({
          key: "ft",
          kind: "entity",
          recipientId: "ft",
          label: "Family Trust",
          byMechanism: [mech("will", [asset("Brokerage", 100_000)])],
        }),
      ],
      reductions: [],
    });

    const summary = buildEstateFlowSummary({
      ...baseInput({ secondDeath }),
      clientData,
    })!;

    const susanBoxes = summary.heirBoxes.filter((h) =>
      h.recipientLabel.includes("Susan"),
    );
    expect(susanBoxes).toHaveLength(1);
    expect(susanBoxes[0].outright).toBe(50_000);
    expect(susanBoxes[0].inTrust).toBe(100_000);
    expect(susanBoxes[0].total).toBe(150_000);
    // No stray box keyed by the literal "spouse" string.
    expect(
      summary.heirBoxes.find((h) => h.recipientKey === "spouse"),
    ).toBeUndefined();
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
