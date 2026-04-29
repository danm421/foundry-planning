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
    (tax as { grossEstate: number }).grossEstate = 1_200_000;

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
    expect(out.firstDeath!.grossEstate).toBe(1_200_000);

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

  it("flags reconciliation as failing when transfers don't sum to gross within tolerance", () => {
    // This is the engine-bug case: precedence chain failed to allocate part
    // of the gross estate. transfers sum != gross.
    const tax = emptyEstateTaxResult("client", 2030);
    Object.assign(tax, { grossEstate: 1_000_000, federalEstateTax: 0 });
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
    expect(out.firstDeath!.reconciliation.unattributed).toBe(500_000);
    expect(out.firstDeath!.reconciliation.reconciles).toBe(false);
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
    Object.assign(tax2030, { grossEstate: 100 });
    const tax2040 = emptyEstateTaxResult("client", 2040);
    Object.assign(tax2040, { grossEstate: 200 });

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

    expect(out.firstDeath!.grossEstate).toBe(200);
  });

  it("uses asOf.kind=split to read deathTransfers off the actual death-event year rows", () => {
    // Split mode is implemented in Task 8 by reading
    // projection.firstDeathEvent / secondDeathEvent + the matching year rows'
    // deathTransfers. This test asserts the contract.
    const firstTax = emptyEstateTaxResult("client", 2032);
    Object.assign(firstTax, { grossEstate: 1_000_000 });
    const secondTax = emptyEstateTaxResult("spouse", 2040);
    Object.assign(secondTax, { grossEstate: 800_000, federalEstateTax: 0 });

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
    expect(out.firstDeath!.grossEstate).toBe(1_000_000);
    expect(out.secondDeath!.year).toBe(2040);
    expect(out.secondDeath!.recipients[0].recipientLabel).toBe("Alex");
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
