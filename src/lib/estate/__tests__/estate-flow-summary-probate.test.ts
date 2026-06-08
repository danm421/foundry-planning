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

// ── Fixture helpers (mirrors estate-flow-summary.test.ts conventions) ─────────

const ZERO_DRAINS: RecipientGroup["drainsByKind"] = {
  federal_estate_tax: 0,
  state_estate_tax: 0,
  probate: 0,
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
  // Drains are positive magnitudes here (matching the live engine convention).
  // netTotal = gross − sum of drain magnitudes.
  const drainSum =
    drains.federal_estate_tax +
    drains.state_estate_tax +
    drains.probate +
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
}): DeathSectionData {
  const assetEstateValue = opts.recipients.reduce((s, g) => s + g.total, 0);
  return {
    decedent: opts.decedent,
    decedentName: opts.decedentName,
    year: opts.year,
    taxableEstate: assetEstateValue,
    grossEstate: assetEstateValue,
    assetEstateValue,
    assetCount: opts.recipients.flatMap((r) =>
      r.byMechanism.flatMap((m) => m.assets),
    ).length,
    recipients: opts.recipients,
    reductions: opts.reductions,
    conflicts: [],
    grossEstateDollarsByAccount: {},
    grossEstateDollarsByLiability: {},
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
  asOfYear: number;
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
    asOfYear: 2026,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("estate-flow-summary — probate", () => {
  it("includes Probate Costs in the taxes sub-box and the header total", () => {
    const PROBATE_COST = 20_000;

    // Alex inherits $500k at second death; probate takes $20k from that.
    const secondDeath = deathSection({
      decedent: "spouse",
      decedentName: "Susan",
      year: 2030,
      recipients: [
        group({
          key: "alex",
          kind: "family_member",
          recipientId: "alex",
          label: "Alex Sample",
          byMechanism: [
            mech("will_residuary", [asset("Brokerage", 500_000)]),
          ],
          // Positive drain magnitude (live engine convention; netTotal = 500k - 20k).
          drains: { probate: PROBATE_COST },
        }),
      ],
      // Probate also appears as a reduction line on the death section.
      reductions: [reduction("probate", -PROBATE_COST)],
    });

    const summary = buildEstateFlowSummary(baseInput({ secondDeath }))!;

    const stage = summary.secondDeath!;
    const taxBox = stage.subBoxes.find((b) => b.kind === "taxes")!;
    expect(taxBox).toBeDefined();

    // 1. A probate line must appear in the taxes sub-box.
    const lines = taxBox.lines as ReductionsLine[];
    const probateLine = lines.find((l) => l.kind === "probate");
    expect(probateLine).toBeDefined();
    expect(probateLine!.label).toBe("Probate Costs");
    expect(probateLine!.amount).toBe(-PROBATE_COST);

    // 2. The taxes sub-box total must foot to the sum of its lines.
    const linesSum = lines.reduce((s, l) => s + l.amount, 0);
    expect(taxBox.total).toBeCloseTo(linesSum, 2);

    // 3. The header totalTaxesAndExpenses must include the probate reduction.
    expect(summary.totals.totalTaxesAndExpenses).toBe(-PROBATE_COST);
    expect(summary.totals.totalTaxesAndExpenses).not.toBe(0);
  });

  it("probate drain line appears in the heirs_outright popover with label 'Probate Costs'", () => {
    const PROBATE_COST = 15_000;

    const secondDeath = deathSection({
      decedent: "spouse",
      decedentName: "Susan",
      year: 2030,
      recipients: [
        group({
          key: "alex",
          kind: "family_member",
          recipientId: "alex",
          label: "Alex Sample",
          byMechanism: [
            mech("will_residuary", [asset("Home", 300_000)]),
          ],
          drains: { probate: PROBATE_COST },
        }),
      ],
      reductions: [reduction("probate", -PROBATE_COST)],
    });

    const summary = buildEstateFlowSummary(baseInput({ secondDeath }))!;
    const heirsBox = summary.secondDeath!.subBoxes.find(
      (b) => b.kind === "heirs_outright",
    )! as { total: number; lines: AssetTransferLine[] };

    // The drain reconciliation row must label itself "Probate Costs".
    const probateDrainRow = heirsBox.lines.find((l) => l.amount < 0);
    expect(probateDrainRow).toBeDefined();
    expect(probateDrainRow!.label).toBe("Probate Costs");
    expect(probateDrainRow!.amount).toBe(-PROBATE_COST);

    // The popover must still foot to the net sub-box total.
    const sumLines = heirsBox.lines.reduce((s, l) => s + l.amount, 0);
    expect(sumLines).toBe(heirsBox.total);
    expect(heirsBox.total).toBe(300_000 - PROBATE_COST);
  });

  it("probate line is ordered after state_estate_tax and before admin_expenses in the taxes box", () => {
    const secondDeath = deathSection({
      decedent: "spouse",
      decedentName: "Susan",
      year: 2030,
      recipients: [
        group({
          key: "alex",
          kind: "family_member",
          recipientId: "alex",
          label: "Alex Sample",
          byMechanism: [
            mech("will_residuary", [asset("Brokerage", 1_000_000)]),
          ],
          drains: {
            state_estate_tax: 50_000,
            probate: 20_000,
            admin_expenses: 10_000,
          },
        }),
      ],
      reductions: [
        reduction("state_estate_tax", -50_000),
        reduction("probate", -20_000),
        reduction("admin_expenses", -10_000),
      ],
    });

    const summary = buildEstateFlowSummary(baseInput({ secondDeath }))!;
    const taxBox = summary.secondDeath!.subBoxes.find((b) => b.kind === "taxes")!;
    const lines = taxBox.lines as ReductionsLine[];
    const kinds = lines.map((l) => l.kind);

    const stateIdx = kinds.indexOf("state_estate_tax");
    const probateIdx = kinds.indexOf("probate");
    const adminIdx = kinds.indexOf("admin_expenses");

    expect(stateIdx).toBeGreaterThanOrEqual(0);
    expect(probateIdx).toBeGreaterThan(stateIdx);
    expect(adminIdx).toBeGreaterThan(probateIdx);
  });
});
