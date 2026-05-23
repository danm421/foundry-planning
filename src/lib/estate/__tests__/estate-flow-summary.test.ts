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
    chargeableShareByAccount: {},
    chargeableShareByLiability: {},
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

describe("buildEstateFlowSummary — liability netting", () => {
  it("nets liability transfers into stage.estateValue and the spouse sub-box", () => {
    // Cooper leaves Susan a $950k home and the $600k mortgage that rides with
    // it. The real engine reports assetEstateValue=$950k (positives only) and
    // sumLiabilityTransfers=−$600k, with RecipientGroup.total already net at
    // $350k because it sums every transfer.
    const homeAsset = asset("Home", 950_000, { sourceAccountId: "acct-home" });
    const mortgageLine = asset("Home Mortgage", -600_000, {
      sourceAccountId: null,
      sourceLiabilityId: "liab-mortgage",
    });
    const spouseGroup = group({
      key: "spouse|",
      kind: "spouse",
      label: "Susan Sample",
      byMechanism: [mech("titling", [homeAsset, mortgageLine])],
    });

    const firstDeath: DeathSectionData = {
      decedent: "client",
      decedentName: "Cooper",
      year: 2026,
      taxableEstate: 0,
      assetEstateValue: 950_000,
      assetCount: 1,
      recipients: [spouseGroup],
      reductions: [],
      conflicts: [],
      // Cooper is the sole owner of both rows (chargeable share = 1.0). The
      // netting comes from the liability being signed-negative, not from a
      // joint split. A separate test below covers the joint case.
      chargeableShareByAccount: { "acct-home": 1 },
      chargeableShareByLiability: { "liab-mortgage": 1 },
      reconciliation: {
        sumLiabilityTransfers: -600_000,
        sumRecipients: 350_000,
        sumReductions: 0,
        unattributed: 0,
        reconciles: true,
      },
    };

    const summary = buildEstateFlowSummary(baseInput({ firstDeath }))!;
    expect(summary.firstDeath!.estateValue).toBe(350_000);

    const spouseBox = summary.firstDeath!.subBoxes.find(
      (b) => b.kind === "inheritance_spouse",
    )!;
    expect(spouseBox.total).toBe(350_000);
    expect(spouseBox.lines).toHaveLength(2);
  });

  it("scales joint accounts to the decedent's chargeable share and consolidates split beneficiaries", () => {
    // Real Estate is jointly titled — chargeable share = 0.5 at first death.
    // Cooper - Term 2 is a $500k life-insurance policy split between two
    // family-member beneficiaries; the engine writes two ledger rows. Both
    // wind up as one Heirs sub-box at the policy's chargeable share (= 1).
    const realEstate = asset("Real Estate", 1_000_000, {
      sourceAccountId: "acct-re",
    });
    const term2A = asset("Cooper - Term 2", 250_000, {
      sourceAccountId: "acct-term2",
    });
    const term2B = asset("Cooper - Term 2", 250_000, {
      sourceAccountId: "acct-term2",
    });

    const spouseGroup = group({
      key: "spouse|",
      kind: "spouse",
      label: "Susan Sample",
      byMechanism: [mech("titling", [realEstate])],
    });
    const heirA = group({
      key: "fm-a",
      kind: "family_member",
      label: "Heir A",
      byMechanism: [mech("beneficiary_designation", [term2A])],
    });
    const heirB = group({
      key: "fm-b",
      kind: "family_member",
      label: "Heir B",
      byMechanism: [mech("beneficiary_designation", [term2B])],
    });

    const firstDeath: DeathSectionData = {
      decedent: "client",
      decedentName: "Cooper",
      year: 2026,
      taxableEstate: 0,
      assetEstateValue: 1_500_000,
      assetCount: 3,
      recipients: [spouseGroup, heirA, heirB],
      reductions: [],
      conflicts: [],
      chargeableShareByAccount: { "acct-re": 0.5, "acct-term2": 1 },
      chargeableShareByLiability: {},
      reconciliation: {
        sumLiabilityTransfers: 0,
        sumRecipients: 1_500_000,
        sumReductions: 0,
        unattributed: 0,
        reconciles: true,
      },
    };

    const summary = buildEstateFlowSummary(baseInput({ firstDeath }))!;

    // Cooper's Estate = $500k (his half of Real Estate) + $500k (Term 2) = $1.0M.
    expect(summary.firstDeath!.estateValue).toBe(1_000_000);

    // Popover line items: one Real Estate at $500k (50%), one Term 2 at $500k.
    expect(summary.firstDeath!.estateLines).toHaveLength(2);
    const reLine = summary.firstDeath!.estateLines.find(
      (l) => l.sourceAccountId === "acct-re",
    )!;
    expect(reLine.amount).toBe(500_000);
    const t2Line = summary.firstDeath!.estateLines.find(
      (l) => l.sourceAccountId === "acct-term2",
    )!;
    expect(t2Line.amount).toBe(500_000);

    // Sub-boxes foot to the parent.
    const spouseBox = summary.firstDeath!.subBoxes.find(
      (b) => b.kind === "inheritance_spouse",
    )!;
    expect(spouseBox.total).toBe(500_000);

    const heirsBox = summary.firstDeath!.subBoxes.find(
      (b) => b.kind === "heirs_outright",
    )!;
    expect(heirsBox.total).toBe(500_000);
    // Both heir transfers came from the same policy → one consolidated line.
    expect(heirsBox.lines).toHaveLength(1);
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

describe("buildEstateFlowSummary — survivorNetWorth", () => {
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

    // Susan's box = 100% of Susan Roth ($500k) + 50% of Joint ($200k × 0.5 =
    // $100k) = $600k. The 100%-client-owned account doesn't contribute. See
    // 2026-05-22-estate-flow-survivor-share-and-ilit-routing-design.
    expect(summary.survivorNetWorth).toEqual({
      ownerLabel: "Susan",
      role: "spouse",
      amount: 600_000,
      lines: [
        { label: "Susan Roth", amount: 500_000 },
        { label: "Joint", amount: 100_000 },
      ],
    });
  });

  it("swaps to the client's net worth when the spouse dies first", () => {
    const clientData = emptyClientData();
    clientData.familyMembers = [
      { id: "fm-client", role: "client", firstName: "Cooper" },
      { id: "fm-spouse", role: "spouse", firstName: "Susan" },
    ] as ClientData["familyMembers"];
    clientData.accounts = [
      {
        id: "a1",
        name: "Cooper Solo",
        owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        value: 750_000,
      },
      {
        id: "a2",
        name: "Susan Solo",
        owners: [{ kind: "family_member", familyMemberId: "fm-spouse", percent: 1 }],
        value: 320_000,
      },
    ] as unknown as ClientData["accounts"];

    const firstDeath = deathSection({
      decedent: "spouse",
      decedentName: "Susan",
      year: 2028,
      recipients: [],
      reductions: [],
    });

    const summary = buildEstateFlowSummary({
      ...baseInput({ firstDeath }),
      clientData,
    })!;

    expect(summary.survivorNetWorth).toEqual({
      ownerLabel: "Cooper",
      role: "client",
      amount: 750_000,
      lines: [{ label: "Cooper Solo", amount: 750_000 }],
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
    expect(summary.survivorNetWorth).toBeNull();
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

describe("buildEstateFlowSummary — heir panel sections", () => {
  it("groups Caroline's flows into Prior Transfers + At Susan's Death", () => {
    const clientData = emptyClientData();
    clientData.accounts = [
      {
        id: "529",
        name: "529 Plan - Caroline",
        subType: "529",
        value: 30_000,
        owners: [
          { kind: "family_member", familyMemberId: "caroline", percent: 1 },
        ],
        beneficiaries: [
          {
            id: "b1",
            tier: "primary",
            percentage: 1,
            sortOrder: 0,
            familyMemberId: "caroline",
          },
        ],
      },
    ] as unknown as ClientData["accounts"];
    clientData.familyMembers = [
      { id: "caroline", firstName: "Caroline", lastName: "Sample", role: "child" },
    ] as ClientData["familyMembers"];

    const secondDeath = deathSection({
      decedent: "spouse",
      decedentName: "Susan",
      year: 2032,
      recipients: [
        group({
          key: "caroline",
          kind: "family_member",
          recipientId: "caroline",
          label: "Caroline Sample",
          byMechanism: [mech("will_residuary", [asset("Home", 175_000)])],
        }),
      ],
      reductions: [],
    });

    const summary = buildEstateFlowSummary({
      ...baseInput({ secondDeath }),
      clientData,
    })!;
    const caroline = summary.heirBoxes.find((h) =>
      h.recipientKey.includes("caroline"),
    )!;

    const titles = caroline.sections.map((s) => s.title);
    expect(titles).toEqual(["Prior Transfers", "At Susan's Death"]);
    expect(caroline.sections[0].lines).toEqual([
      { label: "529 Plan - Caroline", amount: 30_000 },
    ]);
    expect(caroline.sections[1].subtotal).toBe(175_000);
  });
});

describe("buildEstateFlowSummary — totals + value-conservation invariants", () => {
  it("totalToHeirs equals Σ heirBoxes.total for a second-death-only scenario with 2 heirs", () => {
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
          byMechanism: [mech("will_residuary", [asset("401k", 200_000)])],
        }),
        group({
          key: "caroline",
          kind: "family_member",
          recipientId: "caroline",
          label: "Caroline Sample",
          byMechanism: [mech("will_residuary", [asset("Home", 175_000)])],
        }),
      ],
      reductions: [],
    });

    const summary = buildEstateFlowSummary(baseInput({ secondDeath }))!;

    const expected = summary.heirBoxes.reduce((s, h) => s + h.total, 0);
    expect(expected).toBe(375_000);
    expect(summary.totals.totalToHeirs).toBe(expected);
  });

  it("totalTaxesAndExpenses equals Σ reductions across both deaths", () => {
    const firstDeath = deathSection({
      decedent: "client",
      decedentName: "Cooper",
      year: 2028,
      recipients: [],
      reductions: [
        reduction("admin_expenses", -10_000),
        reduction("ird_tax", -5_000),
      ],
    });
    const secondDeath = deathSection({
      decedent: "spouse",
      decedentName: "Susan",
      year: 2032,
      recipients: [],
      reductions: [
        reduction("admin_expenses", -3_000),
        reduction("ird_tax", -2_000),
      ],
    });

    const summary = buildEstateFlowSummary(
      baseInput({ firstDeath, secondDeath }),
    )!;

    // Sum of all reduction line amounts across both deaths.
    expect(summary.totals.totalTaxesAndExpenses).toBe(
      -10_000 + -5_000 + -3_000 + -2_000,
    );
  });

  it("HeirBox.total equals outright + inTrust for every heir box (mix of rule 1 + OOE irrev trust)", () => {
    const clientData = emptyClientData();
    clientData.familyMembers = [
      { id: "fm-client", role: "client", firstName: "Cooper", lastName: "Sample" },
      { id: "fm-kevin", role: "child", firstName: "Kevin", lastName: "Sample" },
      { id: "fm-caroline", role: "child", firstName: "Caroline", lastName: "Sample" },
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

    // Rule 1: Kevin and Caroline both receive at-death outright at secondDeath.
    const secondDeath = deathSection({
      decedent: "spouse",
      decedentName: "Susan",
      year: 2032,
      recipients: [
        group({
          key: "fm-kevin",
          kind: "family_member",
          recipientId: "fm-kevin",
          label: "Kevin Sample",
          byMechanism: [mech("will_residuary", [asset("401k", 80_000)])],
        }),
        group({
          key: "fm-caroline",
          kind: "family_member",
          recipientId: "fm-caroline",
          label: "Caroline Sample",
          byMechanism: [mech("will_residuary", [asset("Home", 175_000)])],
        }),
      ],
      reductions: [],
    });

    const summary = buildEstateFlowSummary({
      ...baseInput({ secondDeath }),
      clientData,
    })!;

    // Sanity: there are heir boxes to check.
    expect(summary.heirBoxes.length).toBeGreaterThan(0);

    // Invariant must hold exactly for every box.
    for (const box of summary.heirBoxes) {
      expect(box.total).toBe(box.outright + box.inTrust);
    }

    // Sanity on specific composition: Kevin gets $80k outright + $150k inTrust.
    const kevin = summary.heirBoxes.find((h) =>
      h.recipientLabel.includes("Kevin"),
    )!;
    expect(kevin.outright).toBe(80_000);
    expect(kevin.inTrust).toBe(150_000);
    expect(kevin.total).toBe(230_000);
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

describe("buildEstateFlowSummary — heir-box: recipientGroups + trustInterests", () => {
  it("captures the RecipientGroup at each death and a trust-interests entry", () => {
    const clientData = emptyClientData();
    clientData.entities = [
      {
        id: "snt",
        entityType: "trust",
        isIrrevocable: false, // bequest at death is not OOE
        name: "SNT",
        remainderBeneficiaries: [{ familyMemberId: "kevin", percentage: 1 }],
      },
    ] as ClientData["entities"];
    clientData.familyMembers = [
      { id: "kevin", firstName: "Kevin", lastName: "Sample", role: "child" },
    ] as ClientData["familyMembers"];

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
          byMechanism: [mech("will_residuary", [asset("401k", 400_000)])],
        }),
        group({
          key: "snt",
          kind: "entity",
          recipientId: "snt",
          label: "SNT",
          byMechanism: [mech("will", [asset("Cash", 100_000)])],
        }),
      ],
      reductions: [],
    });

    const summary = buildEstateFlowSummary({
      ...baseInput({ secondDeath }),
      clientData,
    })!;
    const kevin = summary.heirBoxes.find((h) =>
      h.recipientKey.includes("kevin"),
    )!;

    expect(kevin.recipientGroups.secondDeath?.recipientLabel).toBe("Kevin Sample");
    expect(kevin.trustInterests).toEqual([
      { trustId: "snt", trustLabel: "SNT", amount: 100_000 },
    ]);
  });
});

describe("buildEstateFlowSummary — single-filer + isEmpty", () => {
  it("returns null when reportData.isEmpty is true", () => {
    const summary = buildEstateFlowSummary(
      baseInput({ isEmpty: true }),
    );
    expect(summary).toBeNull();
  });

  it("collapses for a single-filer (no spouse, firstDeath null)", () => {
    const secondDeath = deathSection({
      decedent: "client",
      decedentName: "Cooper",
      year: 2030,
      recipients: [
        group({
          key: "caroline",
          kind: "family_member",
          recipientId: "caroline",
          label: "Caroline",
          byMechanism: [mech("will", [asset("Home", 100_000)])],
        }),
      ],
      reductions: [],
    });
    const summary = buildEstateFlowSummary({
      ...baseInput({ firstDeath: null, secondDeath }),
      ownerNames: { clientName: "Cooper", spouseName: null },
    })!;

    expect(summary.survivorNetWorth).toBeNull();
    expect(summary.firstDeath).toBeNull();
    expect(summary.secondDeath).not.toBeNull();
    expect(summary.heirBoxes).toHaveLength(1);
  });
});

describe("buildEstateFlowSummary — survivor net worth includes joint shares", () => {
  // The surviving spouse's left-rail box should reflect their actual financial
  // position: 100% of sole-owned + their share of joint − their share of joint
  // liabilities. Pre-fix it only counted 100%-sole-owned accounts and ignored
  // all liabilities; see spec
  // 2026-05-22-estate-flow-survivor-share-and-ilit-routing-design.

  it("includes 50% share of a joint account in the survivor's box", () => {
    const firstDeath: DeathSectionData = {
      decedent: "client",
      decedentName: "Cooper",
      year: 2026,
      taxableEstate: 0,
      assetEstateValue: 0,
      assetCount: 0,
      recipients: [],
      reductions: [],
      conflicts: [],
      chargeableShareByAccount: {},
      chargeableShareByLiability: {},
      reconciliation: {
        sumLiabilityTransfers: 0,
        sumRecipients: 0,
        sumReductions: 0,
        unattributed: 0,
        reconciles: true,
      },
    };

    const clientData = {
      ...emptyClientData(),
      familyMembers: [
        { id: "fm-client", role: "client", firstName: "Cooper" },
        { id: "fm-spouse", role: "spouse", firstName: "Susan" },
      ],
      accounts: [
        {
          id: "joint-realty",
          name: "Real Estate",
          category: "real_estate",
          subType: "other",
          value: 1_000_000,
          basis: 1_000_000,
          growthRate: 0,
          rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
            { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
          ],
        },
      ],
    } as unknown as ClientData;

    const input = { ...baseInput({ firstDeath }), clientData };
    const summary = buildEstateFlowSummary(input)!;

    expect(summary.survivorNetWorth).not.toBeNull();
    expect(summary.survivorNetWorth!.role).toBe("spouse");
    expect(summary.survivorNetWorth!.amount).toBe(500_000);
    expect(summary.survivorNetWorth!.lines).toEqual([
      { label: "Real Estate", amount: 500_000 },
    ]);
  });

  it("subtracts the survivor's share of joint liabilities", () => {
    const firstDeath: DeathSectionData = {
      decedent: "client",
      decedentName: "Cooper",
      year: 2026,
      taxableEstate: 0,
      assetEstateValue: 0,
      assetCount: 0,
      recipients: [],
      reductions: [],
      conflicts: [],
      chargeableShareByAccount: {},
      chargeableShareByLiability: {},
      reconciliation: {
        sumLiabilityTransfers: 0,
        sumRecipients: 0,
        sumReductions: 0,
        unattributed: 0,
        reconciles: true,
      },
    };

    const clientData = {
      ...emptyClientData(),
      familyMembers: [
        { id: "fm-client", role: "client", firstName: "Cooper" },
        { id: "fm-spouse", role: "spouse", firstName: "Susan" },
      ],
      accounts: [
        {
          id: "joint-home",
          name: "Home",
          category: "real_estate",
          subType: "primary_residence",
          value: 950_000,
          basis: 600_000,
          growthRate: 0,
          rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
            { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
          ],
        },
      ],
      liabilities: [
        {
          id: "joint-mortgage",
          name: "Home Mortgage",
          balance: 600_000,
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
            { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
          ],
        },
      ],
    } as unknown as ClientData;

    const input = { ...baseInput({ firstDeath }), clientData };
    const summary = buildEstateFlowSummary(input)!;

    // 950k × 0.5 − 600k × 0.5 = 475k − 300k = 175k.
    expect(summary.survivorNetWorth!.amount).toBe(175_000);
    expect(summary.survivorNetWorth!.lines).toEqual([
      { label: "Home", amount: 475_000 },
      { label: "Home Mortgage", amount: -300_000 },
    ]);
  });

  it("returns null when there is no surviving spouse", () => {
    const input = baseInput({
      firstDeath: null,
      secondDeath: null,
    });
    const summary = buildEstateFlowSummary(input)!;
    // baseInput's reportData has no death events, so the decedent can't be
    // resolved and there's no survivor to spotlight. Sanity check that the
    // legacy null path is preserved (the summary itself is still built — only
    // `reportData.isEmpty: true` short-circuits the whole struct).
    expect(summary.survivorNetWorth).toBeNull();
  });

  it("ignores accounts with empty owners[] without crashing", () => {
    const firstDeath: DeathSectionData = {
      decedent: "client",
      decedentName: "Cooper",
      year: 2026,
      taxableEstate: 0,
      assetEstateValue: 0,
      assetCount: 0,
      recipients: [],
      reductions: [],
      conflicts: [],
      chargeableShareByAccount: {},
      chargeableShareByLiability: {},
      reconciliation: {
        sumLiabilityTransfers: 0,
        sumRecipients: 0,
        sumReductions: 0,
        unattributed: 0,
        reconciles: true,
      },
    };

    const clientData = {
      ...emptyClientData(),
      familyMembers: [
        { id: "fm-client", role: "client", firstName: "Cooper" },
        { id: "fm-spouse", role: "spouse", firstName: "Susan" },
      ],
      accounts: [
        {
          id: "orphan",
          name: "Orphan",
          category: "cash",
          subType: "checking",
          value: 1_000,
          basis: 0,
          growthRate: 0,
          rmdEnabled: false,
          owners: [],
        },
      ],
    } as unknown as ClientData;

    const input = { ...baseInput({ firstDeath }), clientData };
    const summary = buildEstateFlowSummary(input)!;
    expect(summary.survivorNetWorth!.amount).toBe(0);
    expect(summary.survivorNetWorth!.lines).toEqual([]);
  });
});
