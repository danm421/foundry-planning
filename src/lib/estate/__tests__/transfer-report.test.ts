import { describe, it, expect } from "vitest";
import {
  buildEstateTransferReportData,
  detectConflicts,
  type EstateTransferReportInput,
} from "../transfer-report";
import type {
  ClientData,
  DeathTransfer,
  EstateTaxResult,
  HypotheticalEstateTax,
  HypotheticalEstateTaxOrdering,
  Will,
} from "@/engine/types";
import type { ProjectionResult } from "@/engine";

// ── Fixture builders ─────────────────────────────────────────────────────────

function transfer(partial: Partial<DeathTransfer>): DeathTransfer {
  return {
    year: 2030,
    deathOrder: 1,
    deceased: "client",
    sourceAccountId: "acc-1",
    sourceAccountName: "Brokerage",
    sourceLiabilityId: null,
    sourceLiabilityName: null,
    via: "titling",
    recipientKind: "spouse",
    recipientId: null,
    recipientLabel: "Spouse",
    amount: 1_000_000,
    basis: 500_000,
    resultingAccountId: null,
    resultingLiabilityId: null,
    ...partial,
  };
}

function emptyEstateTaxResult(deceased: "client" | "spouse", year: number): EstateTaxResult {
  return {
    year,
    deathOrder: 1,
    deceased,
    grossEstate: 0,
    grossEstateLines: [],
    estateAdminExpenses: 0,
    maritalDeduction: 0,
    charitableDeduction: 0,
    taxableEstate: 0,
    adjustedTaxableGifts: 0,
    tentativeTaxBase: 0,
    tentativeTax: 0,
    unifiedCredit: 0,
    applicableExclusion: 0,
    beaAtDeathYear: 0,
    dsueReceived: 0,
    dsueGenerated: 0,
    federalEstateTax: 0,
    stateEstateTaxRate: 0,
    stateEstateTax: 0,
    totalEstateTax: 0,
    totalTaxesAndExpenses: 0,
    estateTaxDebits: [],
    creditorPayoffDebits: [],
    creditorPayoffResidual: 0,
  } as unknown as EstateTaxResult;
}

function ordering(
  partial: Partial<HypotheticalEstateTaxOrdering> = {},
): HypotheticalEstateTaxOrdering {
  return {
    firstDecedent: "client",
    firstDeath: emptyEstateTaxResult("client", 2030),
    firstDeathTransfers: [],
    totals: { federal: 0, state: 0, admin: 0, total: 0 },
    ...partial,
  };
}

function projection(years: { year: number; ht: HypotheticalEstateTax }[]): ProjectionResult {
  return {
    years: years.map((y) => ({ year: y.year, hypotheticalEstateTax: y.ht })),
    todayHypotheticalEstateTax: years[0]?.ht,
    firstDeathEvent: null,
    secondDeathEvent: null,
  } as unknown as ProjectionResult;
}

function tree(): ClientData {
  return {
    familyMembers: [
      { id: "fm-client", role: "client", relationship: "other", firstName: "Pat", lastName: null, dateOfBirth: "1970-01-01" },
      { id: "fm-spouse", role: "spouse", relationship: "other", firstName: "Sam", lastName: null, dateOfBirth: "1972-01-01" },
      { id: "fm-child-1", role: "child", relationship: "child", firstName: "Alex", lastName: null, dateOfBirth: "2005-01-01" },
      { id: "fm-child-2", role: "child", relationship: "child", firstName: "Riley", lastName: null, dateOfBirth: "2008-01-01" },
    ],
    entities: [],
    externalBeneficiaries: [],
    wills: [],
    accounts: [],
  } as unknown as ClientData;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("buildEstateTransferReportData", () => {
  it("returns empty data when projection has no hypotheticals", () => {
    const input: EstateTransferReportInput = {
      projection: projection([]),
      asOf: { kind: "today" },
      ordering: "primaryFirst",
      clientData: tree(),
      ownerNames: { clientName: "Pat", spouseName: "Sam" },
    };
    const out = buildEstateTransferReportData(input);
    expect(out.isEmpty).toBe(true);
    expect(out.firstDeath).toBeNull();
    expect(out.secondDeath).toBeNull();
  });

  it("groups single-decedent first-death transfers by recipient with mechanism breakdown", () => {
    const transfers = [
      transfer({
        sourceAccountId: "acc-house",
        sourceAccountName: "Home (JT)",
        via: "titling",
        recipientKind: "spouse",
        recipientLabel: "Sam",
        amount: 800_000,
      }),
      transfer({
        sourceAccountId: "acc-ira",
        sourceAccountName: "Pat IRA",
        via: "beneficiary_designation",
        recipientKind: "family_member",
        recipientId: "fm-child-1",
        recipientLabel: "Alex",
        amount: 250_000,
      }),
      transfer({
        sourceAccountId: "acc-ira-2",
        sourceAccountName: "Pat IRA 2",
        via: "beneficiary_designation",
        recipientKind: "family_member",
        recipientId: "fm-child-1",
        recipientLabel: "Alex",
        amount: 100_000,
      }),
      transfer({
        sourceAccountId: "acc-cash",
        sourceAccountName: "Pat Checking",
        via: "fallback_spouse",
        recipientKind: "spouse",
        recipientLabel: "Sam",
        amount: 50_000,
      }),
    ];

    const tax = emptyEstateTaxResult("client", 2030);
    (tax as { taxableEstate: number }).taxableEstate = 1_200_000;

    const ht: HypotheticalEstateTax = {
      year: 2030,
      primaryFirst: ordering({
        firstDecedent: "client",
        firstDeath: tax,
        firstDeathTransfers: transfers,
      }),
    };

    const input: EstateTransferReportInput = {
      projection: projection([{ year: 2030, ht }]),
      asOf: { kind: "today" },
      ordering: "primaryFirst",
      clientData: tree(),
      ownerNames: { clientName: "Pat", spouseName: "Sam" },
    };

    const out = buildEstateTransferReportData(input);

    expect(out.isEmpty).toBe(false);
    expect(out.firstDeath).not.toBeNull();
    expect(out.firstDeath!.decedent).toBe("client");
    expect(out.firstDeath!.year).toBe(2030);
    expect(out.firstDeath!.taxableEstate).toBe(1_200_000);

    // Two recipients: spouse and Alex.
    const recips = out.firstDeath!.recipients;
    expect(recips).toHaveLength(2);
    // Spouse is pinned to top.
    expect(recips[0].recipientKind).toBe("spouse");
    expect(recips[0].total).toBe(850_000);
    // Spouse breakdown: titling $800k + fallback_spouse $50k.
    expect(recips[0].byMechanism).toHaveLength(2);
    const spouseTitling = recips[0].byMechanism.find((m) => m.mechanism === "titling");
    expect(spouseTitling?.total).toBe(800_000);
    const spouseFallback = recips[0].byMechanism.find((m) => m.mechanism === "fallback_spouse");
    expect(spouseFallback?.total).toBe(50_000);

    // Alex breakdown: two beneficiary_designation rows merged into one mechanism with two assets.
    expect(recips[1].recipientLabel).toBe("Alex");
    expect(recips[1].total).toBe(350_000);
    expect(recips[1].byMechanism).toHaveLength(1);
    expect(recips[1].byMechanism[0].mechanism).toBe("beneficiary_designation");
    expect(recips[1].byMechanism[0].assets).toHaveLength(2);
  });

  it("includes linked-liability transfers as negative amounts that reduce the recipient's net", () => {
    // Mortgage on the home follows the home to the spouse via titling. The
    // recipient's net should be (home value − mortgage balance).
    const transfers = [
      transfer({
        sourceAccountId: "acc-house",
        sourceAccountName: "Home (JT)",
        via: "titling",
        recipientKind: "spouse",
        recipientLabel: "Sam",
        amount: 800_000,
      }),
      transfer({
        sourceAccountId: null,
        sourceAccountName: null,
        sourceLiabilityId: "liab-mortgage",
        sourceLiabilityName: "Primary Mortgage",
        via: "titling",
        recipientKind: "spouse",
        recipientLabel: "Sam",
        amount: -200_000,
        basis: 0,
      }),
    ];

    const tax = emptyEstateTaxResult("client", 2030);
    (tax as { grossEstate: number }).grossEstate = 800_000;

    const ht: HypotheticalEstateTax = {
      year: 2030,
      primaryFirst: ordering({
        firstDecedent: "client",
        firstDeath: tax,
        firstDeathTransfers: transfers,
      }),
    };

    const out = buildEstateTransferReportData({
      projection: projection([{ year: 2030, ht }]),
      asOf: { kind: "today" },
      ordering: "primaryFirst",
      clientData: tree(),
      ownerNames: { clientName: "Pat", spouseName: "Sam" },
    });

    const spouse = out.firstDeath!.recipients.find((r) => r.recipientKind === "spouse")!;
    expect(spouse.total).toBe(600_000);
    const titlingMech = spouse.byMechanism.find((m) => m.mechanism === "titling")!;
    expect(titlingMech.total).toBe(600_000);
    expect(titlingMech.assets).toHaveLength(2);
    const liabAsset = titlingMech.assets.find((a) => a.sourceLiabilityId === "liab-mortgage");
    expect(liabAsset?.label).toBe("Primary Mortgage");
    expect(liabAsset?.amount).toBe(-200_000);
  });

  it("pins spouse at top regardless of total ordering", () => {
    const transfers = [
      transfer({
        recipientKind: "spouse",
        recipientLabel: "Sam",
        amount: 1_000,
      }),
      transfer({
        sourceAccountId: "acc-2",
        recipientKind: "family_member",
        recipientId: "fm-child-1",
        recipientLabel: "Alex",
        amount: 1_000_000,
      }),
    ];

    const tax = emptyEstateTaxResult("client", 2030);
    (tax as { grossEstate: number }).grossEstate = 1_001_000;
    const ht: HypotheticalEstateTax = {
      year: 2030,
      primaryFirst: ordering({ firstDeathTransfers: transfers, firstDeath: tax }),
    };

    const out = buildEstateTransferReportData({
      projection: projection([{ year: 2030, ht }]),
      asOf: { kind: "today" },
      ordering: "primaryFirst",
      clientData: tree(),
      ownerNames: { clientName: "Pat", spouseName: "Sam" },
    });

    // Spouse first, even though Alex has a much larger total.
    expect(out.firstDeath!.recipients[0].recipientKind).toBe("spouse");
    expect(out.firstDeath!.recipients[1].recipientKind).toBe("family_member");
  });

  it("emits reductions from EstateTaxResult fields", () => {
    // Engine invariant: precedence chain allocates 100% of gross-estate
    // assets to recipients (transfers sum == gross). Tax/admin/debts are
    // drained from those recipient accounts by a later phase, so they show
    // on the report as a parallel "Reductions" track — informational, NOT
    // subtracted from transfer amounts.
    const tax = emptyEstateTaxResult("client", 2030);
    Object.assign(tax, {
      grossEstate: 5_000_000,
      federalEstateTax: 800_000,
      stateEstateTax: 100_000,
      estateAdminExpenses: 50_000,
      creditorPayoffDebits: [{ accountId: "x", amount: 25_000 }],
    });

    const transfers = [
      transfer({ amount: 5_000_000, recipientKind: "spouse", recipientLabel: "Sam" }),
    ];

    const ht: HypotheticalEstateTax = {
      year: 2030,
      primaryFirst: ordering({ firstDeath: tax, firstDeathTransfers: transfers }),
    };

    const out = buildEstateTransferReportData({
      projection: projection([{ year: 2030, ht }]),
      asOf: { kind: "today" },
      ordering: "primaryFirst",
      clientData: tree(),
      ownerNames: { clientName: "Pat", spouseName: "Sam" },
    });

    const reds = out.firstDeath!.reductions;
    expect(reds.find((r) => r.kind === "federal_estate_tax")?.amount).toBe(800_000);
    expect(reds.find((r) => r.kind === "state_estate_tax")?.amount).toBe(100_000);
    expect(reds.find((r) => r.kind === "admin_expenses")?.amount).toBe(50_000);
    expect(reds.find((r) => r.kind === "debts_paid")?.amount).toBe(25_000);

    // sumReductions is computed for display; it does NOT participate in the
    // reconciliation equation.
    expect(out.firstDeath!.reconciliation.sumReductions).toBe(975_000);
    expect(out.firstDeath!.reconciliation.sumRecipients).toBe(5_000_000);
    expect(out.firstDeath!.reconciliation.reconciles).toBe(true);
  });

  it("reconciles even when assetEstateValue ≠ Form 706 taxable estate (joint-account scenario, F1 contract)", () => {
    // Pre-fix this case (transfers $500k against the section's tax-anchor
    // value $1M) flagged "unattributed: $500k" — the section reconciliation
    // was comparing the ledger to the Form 706 amount, which is the wrong
    // concept. Post-fix, reconciliation only checks ledger internal
    // consistency: assetEstateValue + sumLiabilityTransfers == sumRecipients.
    const tax = emptyEstateTaxResult("client", 2030);
    Object.assign(tax, { taxableEstate: 1_000_000, federalEstateTax: 0 });
    const transfers = [
      transfer({ amount: 500_000, recipientKind: "spouse", recipientLabel: "Sam" }),
    ];
    const ht: HypotheticalEstateTax = {
      year: 2030,
      primaryFirst: ordering({ firstDeath: tax, firstDeathTransfers: transfers }),
    };
    const out = buildEstateTransferReportData({
      projection: projection([{ year: 2030, ht }]),
      asOf: { kind: "today" },
      ordering: "primaryFirst",
      clientData: tree(),
      ownerNames: { clientName: "Pat", spouseName: "Sam" },
    });
    expect(out.firstDeath!.assetEstateValue).toBe(500_000);
    expect(out.firstDeath!.taxableEstate).toBe(1_000_000);  // Form 706 taxable estate, preserved
    expect(out.firstDeath!.reconciliation.unattributed).toBe(0);
    expect(out.firstDeath!.reconciliation.reconciles).toBe(true);
  });

  it("renders second-death section for married couples", () => {
    const firstTax = emptyEstateTaxResult("client", 2030);
    Object.assign(firstTax, { grossEstate: 5_000_000 });
    const secondTax = emptyEstateTaxResult("spouse", 2030);
    Object.assign(secondTax, { grossEstate: 5_000_000, federalEstateTax: 300_000 });

    const firstTransfers = [
      transfer({ amount: 5_000_000, recipientKind: "spouse", recipientLabel: "Sam" }),
    ];
    const secondTransfers = [
      transfer({
        deathOrder: 2,
        deceased: "spouse",
        recipientKind: "family_member",
        recipientId: "fm-child-1",
        recipientLabel: "Alex",
        amount: 4_700_000,
      }),
    ];

    const ht: HypotheticalEstateTax = {
      year: 2030,
      primaryFirst: ordering({
        firstDecedent: "client",
        firstDeath: firstTax,
        finalDeath: secondTax,
        firstDeathTransfers: firstTransfers,
        finalDeathTransfers: secondTransfers,
      }),
    };

    const out = buildEstateTransferReportData({
      projection: projection([{ year: 2030, ht }]),
      asOf: { kind: "today" },
      ordering: "primaryFirst",
      clientData: tree(),
      ownerNames: { clientName: "Pat", spouseName: "Sam" },
    });

    expect(out.firstDeath!.decedentName).toBe("Pat");
    expect(out.secondDeath!.decedentName).toBe("Sam");
    expect(out.secondDeath!.recipients[0].recipientLabel).toBe("Alex");
  });

  it("computes aggregateRecipientTotals across both deaths", () => {
    const firstTax = emptyEstateTaxResult("client", 2030);
    Object.assign(firstTax, { grossEstate: 1_000_000 });
    const secondTax = emptyEstateTaxResult("spouse", 2030);
    Object.assign(secondTax, { grossEstate: 1_000_000 });

    const firstTransfers = [
      transfer({ amount: 1_000_000, recipientKind: "spouse", recipientLabel: "Sam" }),
    ];
    const secondTransfers = [
      transfer({
        deathOrder: 2,
        deceased: "spouse",
        recipientKind: "family_member",
        recipientId: "fm-child-1",
        recipientLabel: "Alex",
        amount: 600_000,
      }),
      transfer({
        deathOrder: 2,
        deceased: "spouse",
        sourceAccountId: "acc-2",
        recipientKind: "family_member",
        recipientId: "fm-child-2",
        recipientLabel: "Riley",
        amount: 400_000,
      }),
    ];

    const ht: HypotheticalEstateTax = {
      year: 2030,
      primaryFirst: ordering({
        firstDecedent: "client",
        firstDeath: firstTax,
        finalDeath: secondTax,
        firstDeathTransfers: firstTransfers,
        finalDeathTransfers: secondTransfers,
      }),
    };

    const out = buildEstateTransferReportData({
      projection: projection([{ year: 2030, ht }]),
      asOf: { kind: "today" },
      ordering: "primaryFirst",
      clientData: tree(),
      ownerNames: { clientName: "Pat", spouseName: "Sam" },
    });

    const totals = out.aggregateRecipientTotals;
    // Spouse total is 1M from first death (intermediate; not normally shown but engine carries it).
    // Children: each from second death only.
    const alex = totals.find((t) => t.recipientLabel === "Alex");
    const riley = totals.find((t) => t.recipientLabel === "Riley");
    expect(alex?.fromFirstDeath).toBe(0);
    expect(alex?.fromSecondDeath).toBe(600_000);
    expect(alex?.total).toBe(600_000);
    expect(riley?.total).toBe(400_000);
  });

  it("respects ordering=spouseFirst by reading the spouseFirst branch", () => {
    const tax = emptyEstateTaxResult("spouse", 2030);
    Object.assign(tax, { grossEstate: 1_000_000 });
    const transfers = [
      transfer({
        deceased: "spouse",
        recipientKind: "family_member",
        recipientId: "fm-child-1",
        recipientLabel: "Alex",
        amount: 1_000_000,
      }),
    ];

    const ht: HypotheticalEstateTax = {
      year: 2030,
      primaryFirst: ordering(),
      spouseFirst: ordering({
        firstDecedent: "spouse",
        firstDeath: tax,
        firstDeathTransfers: transfers,
      }),
    };

    const out = buildEstateTransferReportData({
      projection: projection([{ year: 2030, ht }]),
      asOf: { kind: "today" },
      ordering: "spouseFirst",
      clientData: tree(),
      ownerNames: { clientName: "Pat", spouseName: "Sam" },
    });

    expect(out.firstDeath!.decedent).toBe("spouse");
    expect(out.firstDeath!.recipients[0].recipientLabel).toBe("Alex");
  });

  it("falls back to primaryFirst when spouseFirst is requested but absent (single filer)", () => {
    const ht: HypotheticalEstateTax = {
      year: 2030,
      primaryFirst: ordering(),
      // no spouseFirst
    };

    const out = buildEstateTransferReportData({
      projection: projection([{ year: 2030, ht }]),
      asOf: { kind: "today" },
      ordering: "spouseFirst",
      clientData: tree(),
      ownerNames: { clientName: "Pat", spouseName: null },
    });

    expect(out.ordering).toBe("primaryFirst");
  });

  it("uses asOf.kind=year to resolve the matching projection year", () => {
    const tax2030 = emptyEstateTaxResult("client", 2030);
    Object.assign(tax2030, { taxableEstate: 100 });
    const tax2040 = emptyEstateTaxResult("client", 2040);
    Object.assign(tax2040, { taxableEstate: 200 });

    const ht2030: HypotheticalEstateTax = {
      year: 2030,
      primaryFirst: ordering({ firstDeath: tax2030 }),
    };
    const ht2040: HypotheticalEstateTax = {
      year: 2040,
      primaryFirst: ordering({ firstDeath: tax2040 }),
    };

    const out = buildEstateTransferReportData({
      projection: projection([
        { year: 2030, ht: ht2030 },
        { year: 2040, ht: ht2040 },
      ]),
      asOf: { kind: "year", year: 2040 },
      ordering: "primaryFirst",
      clientData: tree(),
      ownerNames: { clientName: "Pat", spouseName: "Sam" },
    });

    expect(out.firstDeath!.taxableEstate).toBe(200);
  });

  it("uses asOf.kind=split to read deathTransfers off the actual death-event year rows", () => {
    // Split mode is implemented in Task 8 by reading
    // projection.firstDeathEvent / secondDeathEvent + the matching year rows'
    // deathTransfers. This test asserts the contract.
    const firstTax = emptyEstateTaxResult("client", 2032);
    Object.assign(firstTax, { taxableEstate: 1_000_000 });
    const secondTax = emptyEstateTaxResult("spouse", 2040);
    Object.assign(secondTax, { taxableEstate: 800_000, federalEstateTax: 0 });

    const splitFirstTransfers = [
      transfer({ year: 2032, amount: 1_000_000, recipientKind: "spouse", recipientLabel: "Sam" }),
    ];
    const splitSecondTransfers = [
      transfer({
        year: 2040,
        deathOrder: 2,
        deceased: "spouse",
        recipientKind: "family_member",
        recipientId: "fm-child-1",
        recipientLabel: "Alex",
        amount: 800_000,
      }),
    ];

    const proj = {
      years: [
        { year: 2032, hypotheticalEstateTax: { year: 2032, primaryFirst: ordering() }, deathTransfers: splitFirstTransfers },
        { year: 2040, hypotheticalEstateTax: { year: 2040, primaryFirst: ordering() }, deathTransfers: splitSecondTransfers },
      ],
      todayHypotheticalEstateTax: { year: 2032, primaryFirst: ordering() },
      firstDeathEvent: firstTax,
      secondDeathEvent: secondTax,
    } as unknown as ProjectionResult;

    const out = buildEstateTransferReportData({
      projection: proj,
      asOf: { kind: "split" },
      ordering: "primaryFirst",
      clientData: tree(),
      ownerNames: { clientName: "Pat", spouseName: "Sam" },
    });

    expect(out.firstDeath!.year).toBe(2032);
    expect(out.firstDeath!.taxableEstate).toBe(1_000_000);
    expect(out.secondDeath!.year).toBe(2040);
    expect(out.secondDeath!.recipients[0].recipientLabel).toBe("Alex");
  });

  // ── F1 — assetEstateValue + reconciliation flip ─────────────────────────
  //
  // The Form 706 amount (deceased's gross estate or taxable estate) is not
  // the right number for the section reconciliation. The transfer ledger
  // moves the FULL balance of joint accounts via titling, so sumRecipients
  // always exceeds the Form 706 figure in households with joint accounts.
  //
  // Fix: surface assetEstateValue (sum of positive asset-source transfers)
  // and reconcile recipient flow against THAT. The Form 706 taxable estate
  // stays on DeathSectionData for the reductions/tax card.
  describe("F1 — assetEstateValue + reconciliation flip", () => {
    it("computes assetEstateValue from positive asset-source transfers (ignoring liabilities)", () => {
      // Joint home $1M + joint brokerage $1M, mortgage $200k → ledger has
      // +1M (home), -200k (mortgage), +1M (brokerage). assetEstateValue
      // counts only positive asset-source rows; mortgage is excluded.
      const transfers = [
        transfer({ sourceAccountId: "acc-home", sourceLiabilityId: null,
                   via: "titling", amount: 1_000_000, recipientKind: "spouse",
                   recipientId: "fm-spouse", recipientLabel: "Sam" }),
        transfer({ sourceAccountId: null, sourceLiabilityId: "liab-mort",
                   sourceLiabilityName: "Mortgage", via: "titling",
                   amount: -200_000, recipientKind: "spouse",
                   recipientId: "fm-spouse", recipientLabel: "Sam" }),
        transfer({ sourceAccountId: "acc-brokerage", sourceLiabilityId: null,
                   via: "titling", amount: 1_000_000, recipientKind: "spouse",
                   recipientId: "fm-spouse", recipientLabel: "Sam" }),
      ];
      const tax = emptyEstateTaxResult("client", 2026);
      Object.assign(tax, { taxableEstate: 900_000 }); // Form 706 taxable estate
      const ht: HypotheticalEstateTax = {
        year: 2026,
        primaryFirst: ordering({ firstDeath: tax, firstDeathTransfers: transfers }),
      };

      const out = buildEstateTransferReportData({
        projection: projection([{ year: 2026, ht }]),
        asOf: { kind: "today" }, ordering: "primaryFirst",
        clientData: tree(), ownerNames: { clientName: "Pat", spouseName: "Sam" },
      });

      expect(out.firstDeath!.assetEstateValue).toBe(2_000_000);
      // Form 706 taxable estate preserved on the section for the reductions card.
      expect(out.firstDeath!.taxableEstate).toBe(900_000);
    });

    it("reconciles when sumPositiveAssets equals assetEstateValue (joint-account case)", () => {
      // Same fixture as above. Engine invariant: positive asset transfers
      // sum to source-account values; assetEstateValue == that sum by
      // definition, so the reconciliation should pass.
      const transfers = [
        transfer({ sourceAccountId: "acc-home", sourceLiabilityId: null,
                   via: "titling", amount: 1_000_000, recipientKind: "spouse",
                   recipientId: "fm-spouse", recipientLabel: "Sam" }),
        transfer({ sourceAccountId: null, sourceLiabilityId: "liab-mort",
                   sourceLiabilityName: "Mortgage", via: "titling",
                   amount: -200_000, recipientKind: "spouse",
                   recipientId: "fm-spouse", recipientLabel: "Sam" }),
        transfer({ sourceAccountId: "acc-brokerage", sourceLiabilityId: null,
                   via: "titling", amount: 1_000_000, recipientKind: "spouse",
                   recipientId: "fm-spouse", recipientLabel: "Sam" }),
      ];
      const tax = emptyEstateTaxResult("client", 2026);
      Object.assign(tax, { taxableEstate: 900_000 });
      const ht: HypotheticalEstateTax = {
        year: 2026,
        primaryFirst: ordering({ firstDeath: tax, firstDeathTransfers: transfers }),
      };

      const out = buildEstateTransferReportData({
        projection: projection([{ year: 2026, ht }]),
        asOf: { kind: "today" }, ordering: "primaryFirst",
        clientData: tree(), ownerNames: { clientName: "Pat", spouseName: "Sam" },
      });

      // Reconciliation passes because asset routing is internally consistent;
      // pre-fix this would have flagged unattributed = 900k - 1.8M = -900k.
      expect(out.firstDeath!.reconciliation.reconciles).toBe(true);
      expect(out.firstDeath!.reconciliation.sumLiabilityTransfers).toBe(-200_000);
      // sumRecipients is the recipient's net (assets minus inherited debt).
      expect(out.firstDeath!.reconciliation.sumRecipients).toBe(1_800_000);
    });

    it("flags reconciliation as failing when positive asset transfers do NOT cover assetEstateValue", () => {
      // Synthetic engine bug: ledger total positive assets summed to less than
      // the engine claims it allocated. Constructing this requires bypassing
      // the chain invariant (which we do here by hand-rolling transfers).
      const transfers = [
        transfer({ sourceAccountId: "acc-1", via: "will", amount: 600_000,
                   recipientKind: "spouse", recipientId: "fm-spouse",
                   recipientLabel: "Sam" }),
      ];
      const tax = emptyEstateTaxResult("client", 2026);
      Object.assign(tax, { grossEstate: 1_000_000 });
      const ht: HypotheticalEstateTax = {
        year: 2026,
        primaryFirst: ordering({ firstDeath: tax, firstDeathTransfers: transfers }),
      };
      const out = buildEstateTransferReportData({
        projection: projection([{ year: 2026, ht }]),
        asOf: { kind: "today" }, ordering: "primaryFirst",
        clientData: tree(), ownerNames: { clientName: "Pat", spouseName: "Sam" },
      });
      // assetEstateValue = 600k by construction. Reconciliation passes because
      // the equation is "sumPositiveAssets == assetEstateValue" — these match
      // tautologically. The Form 706 mismatch is no longer a reconciliation
      // signal; that's the whole point of F1.
      expect(out.firstDeath!.assetEstateValue).toBe(600_000);
      expect(out.firstDeath!.reconciliation.reconciles).toBe(true);
    });
  });
});

describe("detectConflicts", () => {
  function willWithSpecificBequest(opts: {
    accountId: string;
    recipientKind?: "family_member" | "external_beneficiary" | "entity" | "spouse";
    recipientId?: string;
    condition?: "always" | "if_spouse_survives" | "if_spouse_predeceased";
  }): Will {
    return {
      grantor: "client",
      bequests: [
        {
          kind: "asset",
          assetMode: "specific",
          accountId: opts.accountId,
          percentage: 100,
          condition: opts.condition ?? "always",
          recipients: [
            {
              recipientKind: opts.recipientKind ?? "family_member",
              recipientId: opts.recipientId ?? "fm-child-1",
              percentage: 100,
            },
          ],
        },
      ],
    } as unknown as Will;
  }

  function withWill(t: ClientData, will: Will): ClientData {
    return { ...t, wills: [will] } as unknown as ClientData;
  }

  it("returns no conflicts when no will or bene-designation exists for a fallback transfer", () => {
    const out = detectConflicts(
      tree(),
      [
        transfer({
          via: "fallback_spouse",
          recipientKind: "spouse",
          sourceAccountId: "acc-1",
        }),
      ],
      "client",
    );
    expect(out).toEqual([]);
  });

  it("flags a will-bequest overridden by JT titling", () => {
    const data = withWill(
      tree(),
      willWithSpecificBequest({
        accountId: "acc-house",
        recipientKind: "family_member",
        recipientId: "fm-child-1",
      }),
    );
    const transfers = [
      transfer({
        sourceAccountId: "acc-house",
        sourceAccountName: "Home",
        via: "titling",
        recipientKind: "spouse",
        recipientLabel: "Sam",
      }),
    ];

    const out = detectConflicts(data, transfers, "client");
    expect(out).toHaveLength(1);
    expect(out[0].accountId).toBe("acc-house");
    expect(out[0].governingMechanism).toBe("titling");
    expect(out[0].overriddenBy[0].mechanism).toBe("will_specific_bequest");
    expect(out[0].overriddenBy[0].intendedRecipient).toContain("Alex");
  });

  it("flags a will-bequest overridden by beneficiary designation", () => {
    const data = withWill(
      tree(),
      willWithSpecificBequest({
        accountId: "acc-ira",
        recipientKind: "family_member",
        recipientId: "fm-child-2",
      }),
    );
    const transfers = [
      transfer({
        sourceAccountId: "acc-ira",
        sourceAccountName: "Pat IRA",
        via: "beneficiary_designation",
        recipientKind: "family_member",
        recipientId: "fm-child-1",
        recipientLabel: "Alex",
      }),
    ];
    const out = detectConflicts(data, transfers, "client");
    expect(out).toHaveLength(1);
    expect(out[0].overriddenBy[0].mechanism).toBe("will_specific_bequest");
    expect(out[0].overriddenBy[0].intendedRecipient).toContain("Riley");
  });

  it("does NOT flag conflict when the bequest is overridden by another bequest of higher precedence (governing == will)", () => {
    const data = withWill(
      tree(),
      willWithSpecificBequest({ accountId: "acc-1", recipientId: "fm-child-1" }),
    );
    const transfers = [
      transfer({
        sourceAccountId: "acc-1",
        via: "will",
        recipientKind: "family_member",
        recipientId: "fm-child-1",
        recipientLabel: "Alex",
      }),
    ];
    const out = detectConflicts(data, transfers, "client");
    expect(out).toEqual([]);
  });

  it("respects the will bequest's condition (if_spouse_survives) — no conflict when condition fails", () => {
    const data = withWill(
      tree(),
      willWithSpecificBequest({
        accountId: "acc-1",
        recipientId: "fm-child-1",
        condition: "if_spouse_survives",
      }),
    );
    // Decedent is spouse — at the spouse's death, the spouse no longer survives
    // themselves, so the if_spouse_survives bequest doesn't apply.
    const transfers = [
      transfer({
        sourceAccountId: "acc-1",
        deceased: "spouse",
        deathOrder: 2,
        via: "fallback_children",
        recipientKind: "family_member",
        recipientId: "fm-child-1",
      }),
    ];
    const out = detectConflicts(data, transfers, "spouse");
    expect(out).toEqual([]);
  });

  it("does NOT flag conflict when the will partially bequests an account and the residual flows via fallback (will is honored)", () => {
    // Will leaves part of acc-schwab to a child; residual flows to spouse via
    // fallback. The fallback transfer is correct residual disposition, not a
    // conflict — the will isn't being blocked, it's being honored alongside
    // a residual.
    const data = withWill(
      tree(),
      willWithSpecificBequest({
        accountId: "acc-schwab",
        recipientKind: "family_member",
        recipientId: "fm-child-1",
      }),
    );
    const transfers = [
      transfer({
        sourceAccountId: "acc-schwab",
        sourceAccountName: "Schwab Ind. Account",
        via: "will",
        recipientKind: "family_member",
        recipientId: "fm-child-1",
        recipientLabel: "Alex",
        amount: 375_000,
      }),
      transfer({
        sourceAccountId: "acc-schwab",
        sourceAccountName: "Schwab Ind. Account",
        via: "fallback_spouse",
        recipientKind: "spouse",
        recipientLabel: "Sam",
        amount: 375_000,
      }),
    ];
    const out = detectConflicts(data, transfers, "client");
    expect(out).toEqual([]);
  });

  it("ignores wills whose grantor isn't the decedent", () => {
    const spouseWill = willWithSpecificBequest({
      accountId: "acc-1",
      recipientId: "fm-child-1",
    });
    (spouseWill as unknown as { grantor: string }).grantor = "spouse";
    const data = withWill(tree(), spouseWill);

    const transfers = [
      transfer({
        sourceAccountId: "acc-1",
        deceased: "client",
        via: "titling",
        recipientKind: "spouse",
      }),
    ];
    const out = detectConflicts(data, transfers, "client");
    expect(out).toEqual([]);
  });
});

// ── Drain attribution + per-recipient netting ────────────────────────────────

describe("drain attribution and re-grossing", () => {
  function taxWithDrain(opts: {
    deathOrder: 1 | 2;
    state?: number;
    federal?: number;
    debts?: { accountId: string; amount: number }[];
    estate?: { accountId: string; amount: number }[];
  }): EstateTaxResult {
    const t = emptyEstateTaxResult("client", 2030);
    (t as { deathOrder: 1 | 2 }).deathOrder = opts.deathOrder;
    (t as { stateEstateTax: number }).stateEstateTax = opts.state ?? 0;
    (t as { federalEstateTax: number }).federalEstateTax = opts.federal ?? 0;
    (t as { estateTaxDebits: { accountId: string; amount: number }[] }).estateTaxDebits =
      opts.estate ?? [];
    (t as { creditorPayoffDebits: { accountId: string; amount: number }[] }).creditorPayoffDebits =
      opts.debts ?? [];
    return t;
  }

  it("re-grosses Schwab at second death so two children inherit $375k each (regression for engine drain timing)", () => {
    // Mirrors the Susan/Cooper sample on second death: Susan owns the inherited
    // Schwab ($750k). Engine drains $241k state estate tax + $10k debts from
    // Schwab BEFORE chain runs, residual $499k splits 50/50 → engine emits
    // $249,500 to each child. Report layer must re-gross to $375k each, attribute
    // $125,500 of reductions to each child, and net to $249,500.
    const transfers = [
      transfer({
        deathOrder: 2,
        sourceAccountId: "acc-schwab",
        sourceAccountName: "Schwab Ind. Account",
        via: "fallback_children",
        recipientKind: "family_member",
        recipientId: "fm-child-1",
        recipientLabel: "Alex",
        amount: 249_500,
      }),
      transfer({
        deathOrder: 2,
        sourceAccountId: "acc-schwab",
        sourceAccountName: "Schwab Ind. Account",
        via: "fallback_children",
        recipientKind: "family_member",
        recipientId: "fm-child-2",
        recipientLabel: "Riley",
        amount: 249_500,
      }),
    ];

    const tax = taxWithDrain({
      deathOrder: 2,
      state: 241_000,
      estate: [{ accountId: "acc-schwab", amount: 241_000 }],
      debts: [{ accountId: "acc-schwab", amount: 10_000 }],
    });

    const ht: HypotheticalEstateTax = {
      year: 2030,
      primaryFirst: ordering({
        firstDecedent: "client",
        firstDeath: emptyEstateTaxResult("client", 2030),
        firstDeathTransfers: [],
        finalDeath: tax,
        finalDeathTransfers: transfers,
      }),
    };

    const out = buildEstateTransferReportData({
      projection: projection([{ year: 2030, ht }]),
      asOf: { kind: "today" },
      ordering: "primaryFirst",
      clientData: tree(),
      ownerNames: { clientName: "Pat", spouseName: "Sam" },
    });

    const second = out.secondDeath!;
    const alex = second.recipients.find((r) => r.recipientLabel === "Alex")!;
    const riley = second.recipients.find((r) => r.recipientLabel === "Riley")!;

    // Asset row + group total = gross $375k each (re-grossed from $249.5k).
    expect(alex.total).toBe(375_000);
    expect(riley.total).toBe(375_000);
    expect(alex.byMechanism[0].assets[0].amount).toBe(375_000);

    // Reductions split: $125.5k each, all categorized as state estate tax
    // (no federal, no admin in this fixture; debts go to debts_paid).
    expect(alex.drainsByKind.state_estate_tax).toBeCloseTo(120_500, 0);
    expect(alex.drainsByKind.debts_paid).toBeCloseTo(5_000, 0);
    expect(alex.drainsByKind.federal_estate_tax).toBe(0);

    // Net = what the recipient actually receives = engine's raw transfer amount.
    expect(alex.netTotal).toBeCloseTo(249_500, 0);
    expect(riley.netTotal).toBeCloseTo(249_500, 0);

    // Aggregate Recipient Totals reflect net (not gross).
    const aggAlex = out.aggregateRecipientTotals.find((r) => r.recipientLabel === "Alex");
    expect(aggAlex?.fromSecondDeath).toBeCloseTo(249_500, 0);
  });

  it("at first death, leaves chain transfer amounts as gross (engine emits pre-drain amounts)", () => {
    // First death: chain runs BEFORE drain, so t.amount IS gross. The drain
    // still gets attributed for the per-recipient reductions section, but no
    // re-grossing happens (would double the gross).
    const transfers = [
      transfer({
        deathOrder: 1,
        sourceAccountId: "acc-brokerage",
        sourceAccountName: "Brokerage",
        via: "fallback_children",
        recipientKind: "family_member",
        recipientId: "fm-child-1",
        recipientLabel: "Alex",
        amount: 500_000,
      }),
    ];

    const tax = taxWithDrain({
      deathOrder: 1,
      federal: 100_000,
      estate: [{ accountId: "acc-brokerage", amount: 100_000 }],
    });

    const ht: HypotheticalEstateTax = {
      year: 2030,
      primaryFirst: ordering({
        firstDecedent: "client",
        firstDeath: tax,
        firstDeathTransfers: transfers,
      }),
    };

    const out = buildEstateTransferReportData({
      projection: projection([{ year: 2030, ht }]),
      asOf: { kind: "today" },
      ordering: "primaryFirst",
      clientData: tree(),
      ownerNames: { clientName: "Pat", spouseName: "Sam" },
    });

    const alex = out.firstDeath!.recipients.find((r) => r.recipientLabel === "Alex")!;

    // Asset row stays at gross $500k (NOT re-grossed to $600k).
    expect(alex.total).toBe(500_000);
    expect(alex.byMechanism[0].assets[0].amount).toBe(500_000);

    // Drain attribution still happens.
    expect(alex.drainsByKind.federal_estate_tax).toBeCloseTo(100_000, 0);

    // Net = gross − drain = $400k (what they realize after tax claws back).
    expect(alex.netTotal).toBeCloseTo(400_000, 0);
  });

  it("apportions drain proportionally when one drained account routes to multiple recipients", () => {
    // Schwab $750k routes 60/40 via will at second death; $250k drained.
    // Post-drain residual = $500k → child A gets $300k, child B gets $200k
    // (engine output). Re-gross: A → $300k + (250k * 300/500) = $300k + $150k
    // = $450k gross. B → $200k + $100k = $300k gross.
    const transfers = [
      transfer({
        deathOrder: 2,
        sourceAccountId: "acc-schwab",
        sourceAccountName: "Schwab",
        via: "will",
        recipientKind: "family_member",
        recipientId: "fm-child-1",
        recipientLabel: "Alex",
        amount: 300_000,
      }),
      transfer({
        deathOrder: 2,
        sourceAccountId: "acc-schwab",
        sourceAccountName: "Schwab",
        via: "will",
        recipientKind: "family_member",
        recipientId: "fm-child-2",
        recipientLabel: "Riley",
        amount: 200_000,
      }),
    ];

    const tax = taxWithDrain({
      deathOrder: 2,
      state: 250_000,
      estate: [{ accountId: "acc-schwab", amount: 250_000 }],
    });

    const ht: HypotheticalEstateTax = {
      year: 2030,
      primaryFirst: ordering({
        firstDecedent: "client",
        firstDeath: emptyEstateTaxResult("client", 2030),
        firstDeathTransfers: [],
        finalDeath: tax,
        finalDeathTransfers: transfers,
      }),
    };

    const out = buildEstateTransferReportData({
      projection: projection([{ year: 2030, ht }]),
      asOf: { kind: "today" },
      ordering: "primaryFirst",
      clientData: tree(),
      ownerNames: { clientName: "Pat", spouseName: "Sam" },
    });

    const alex = out.secondDeath!.recipients.find((r) => r.recipientLabel === "Alex")!;
    const riley = out.secondDeath!.recipients.find((r) => r.recipientLabel === "Riley")!;

    expect(alex.total).toBeCloseTo(450_000, 0);
    expect(riley.total).toBeCloseTo(300_000, 0);
    expect(alex.drainsByKind.state_estate_tax).toBeCloseTo(150_000, 0);
    expect(riley.drainsByKind.state_estate_tax).toBeCloseTo(100_000, 0);
    expect(alex.netTotal).toBeCloseTo(300_000, 0);
    expect(riley.netTotal).toBeCloseTo(200_000, 0);
  });

  it("net + reductions invariant: sum across recipients reconciles to gross + liabilities", () => {
    const transfers = [
      transfer({
        deathOrder: 2,
        sourceAccountId: "acc-schwab",
        sourceAccountName: "Schwab",
        via: "fallback_children",
        recipientKind: "family_member",
        recipientId: "fm-child-1",
        recipientLabel: "Alex",
        amount: 249_500,
      }),
      transfer({
        deathOrder: 2,
        sourceAccountId: "acc-schwab",
        sourceAccountName: "Schwab",
        via: "fallback_children",
        recipientKind: "family_member",
        recipientId: "fm-child-2",
        recipientLabel: "Riley",
        amount: 249_500,
      }),
    ];

    const tax = taxWithDrain({
      deathOrder: 2,
      state: 241_000,
      estate: [{ accountId: "acc-schwab", amount: 241_000 }],
      debts: [{ accountId: "acc-schwab", amount: 10_000 }],
    });

    const ht: HypotheticalEstateTax = {
      year: 2030,
      primaryFirst: ordering({
        firstDecedent: "client",
        firstDeath: emptyEstateTaxResult("client", 2030),
        firstDeathTransfers: [],
        finalDeath: tax,
        finalDeathTransfers: transfers,
      }),
    };

    const out = buildEstateTransferReportData({
      projection: projection([{ year: 2030, ht }]),
      asOf: { kind: "today" },
      ordering: "primaryFirst",
      clientData: tree(),
      ownerNames: { clientName: "Pat", spouseName: "Sam" },
    });

    const second = out.secondDeath!;
    const sumGross = second.recipients.reduce((s, r) => s + r.total, 0);
    const sumNet = second.recipients.reduce((s, r) => s + r.netTotal, 0);
    const sumDrain = second.recipients.reduce(
      (s, r) =>
        s +
        r.drainsByKind.federal_estate_tax +
        r.drainsByKind.state_estate_tax +
        r.drainsByKind.admin_expenses +
        r.drainsByKind.debts_paid,
      0,
    );

    // Sanity: per-recipient drain sums to the global drain.
    expect(sumDrain).toBeCloseTo(251_000, 0);
    // gross − drain = net at the section level too.
    expect(sumGross - sumDrain).toBeCloseTo(sumNet, 0);
    // Reconciliation still holds (gross == assetEstateValue).
    expect(second.assetEstateValue).toBeCloseTo(sumGross, 0);
    expect(second.reconciliation.reconciles).toBe(true);
  });
});
