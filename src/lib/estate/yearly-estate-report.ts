import type { ProjectionResult } from "@/engine";
import type {
  ClientData,
  DrainAttribution,
  EstateTaxResult,
  Gift,
  HypotheticalEstateTax,
  HypotheticalEstateTaxOrdering,
  ProjectionYear,
} from "@/engine/types";
import {
  computeInEstateAtYear,
  computeOutOfEstateAtYear,
} from "@/lib/estate/in-estate-at-year";

export type Ordering = "primaryFirst" | "spouseFirst";

export interface YearlyEstateReportInput {
  projection: ProjectionResult;
  clientData: ClientData;
  ordering: Ordering;
  ownerNames: { clientName: string; spouseName: string | null };
  ownerDobs: { clientDob: string | null; spouseDob: string | null };
}

export interface YearlyEstateRow {
  year: number;
  ageClient: number | null;
  ageSpouse: number | null;
  /** Combined household in-estate balance at year-end (both spouses). */
  grossEstate: number;
  /** Sum across both deaths in chosen ordering: federal + state + admin + IRD. */
  taxesAndExpenses: number;
  /** Form 706 charitable deduction summed across both deaths in chosen ordering. */
  charitableBequests: number;
  /** grossEstate − charitableBequests − taxesAndExpenses. */
  netToHeirs: number;
  /** Combined household out-of-estate balance at year-end. */
  heirsAssets: number;
  /** netToHeirs + heirsAssets. */
  totalToHeirs: number;
  /** Cumulative lifetime gifts to charity (compounded forward at inflation
   *  rate) plus this year's charitable bequest. */
  charity: number;
  /** Per-decedent rows for the drill-down. */
  deaths: YearlyEstateDeathRow[];
}

export interface YearlyEstateDeathRow {
  deathOrder: 1 | 2;
  deceased: "client" | "spouse";
  decedentName: string;
  estateValue: number;
  taxableEstate: number;
  charitableDeduction: number;
  stateEstateTax: number;
  probateAndExpenses: number;
  incomeTaxOnIRD: number;
  estateTaxPayable: number;
  /** stateEstateTax + probateAndExpenses + incomeTaxOnIRD + estateTaxPayable. */
  totalTaxAtDeath: number;
}

export interface YearlyEstateReport {
  ordering: Ordering;
  rows: YearlyEstateRow[];
  totals: {
    taxesAndExpenses: number;
    charitableBequests: number;
    netToHeirs: number;
    heirsAssets: number;
    totalToHeirs: number;
    charity: number;
  };
}

export function buildYearlyEstateReport(
  input: YearlyEstateReportInput,
): YearlyEstateReport {
  const { projection, clientData, ordering, ownerNames, ownerDobs } = input;
  const resolvedOrdering = pickAvailableOrdering(projection, ordering);

  const clientBirthYear = parseBirthYear(ownerDobs.clientDob);
  const spouseBirthYear = parseBirthYear(ownerDobs.spouseDob);
  const projectionStartYear = clientData.planSettings.planStartYear;
  const inflationRate = clientData.planSettings.inflationRate ?? 0;
  const charityIds = collectCharityExternalBeneficiaryIds(clientData);
  const giftEvents = clientData.giftEvents ?? [];

  const rows: YearlyEstateRow[] = [];
  for (const yearRow of projection.years) {
    const ht = yearRow.hypotheticalEstateTax;
    if (!ht) continue;
    const branch = pickBranch(ht, resolvedOrdering);
    rows.push(
      buildYearlyRow({
        yearRow,
        clientData,
        giftEvents,
        projectionStartYear,
        inflationRate,
        charityIds,
        branch,
        ageClient: clientBirthYear ? yearRow.year - clientBirthYear : null,
        ageSpouse: spouseBirthYear ? yearRow.year - spouseBirthYear : null,
        ownerNames,
      }),
    );
  }

  const totals = rows.reduce(
    (acc, r) => ({
      taxesAndExpenses: acc.taxesAndExpenses + r.taxesAndExpenses,
      charitableBequests: acc.charitableBequests + r.charitableBequests,
      netToHeirs: acc.netToHeirs + r.netToHeirs,
      heirsAssets: acc.heirsAssets + r.heirsAssets,
      totalToHeirs: acc.totalToHeirs + r.totalToHeirs,
      charity: acc.charity + r.charity,
    }),
    {
      taxesAndExpenses: 0,
      charitableBequests: 0,
      netToHeirs: 0,
      heirsAssets: 0,
      totalToHeirs: 0,
      charity: 0,
    },
  );

  return { ordering: resolvedOrdering, rows, totals };
}

interface RowBuilderArgs {
  yearRow: ProjectionYear;
  clientData: ClientData;
  giftEvents: NonNullable<ClientData["giftEvents"]>;
  projectionStartYear: number;
  inflationRate: number;
  charityIds: Set<string>;
  branch: HypotheticalEstateTaxOrdering;
  ageClient: number | null;
  ageSpouse: number | null;
  ownerNames: { clientName: string; spouseName: string | null };
}

function buildYearlyRow(args: RowBuilderArgs): YearlyEstateRow {
  const {
    yearRow,
    clientData,
    giftEvents,
    projectionStartYear,
    inflationRate,
    charityIds,
    branch,
    ageClient,
    ageSpouse,
    ownerNames,
  } = args;

  const accountBalances = pyAccountBalances(yearRow);
  const balanceArgs = {
    tree: clientData,
    giftEvents,
    year: yearRow.year,
    projectionStartYear,
    accountBalances,
    entityAccountSharesEoY: yearRow.entityAccountSharesEoY,
    familyAccountSharesEoY: yearRow.familyAccountSharesEoY,
  };
  const grossEstate = computeInEstateAtYear(balanceArgs);
  const heirsAssets = computeOutOfEstateAtYear(balanceArgs);

  const firstDeath = branch.firstDeath;
  const finalDeath = branch.finalDeath;

  const taxesAndExpenses =
    totalTaxAtDeath(firstDeath) + (finalDeath ? totalTaxAtDeath(finalDeath) : 0);
  const charitableBequests =
    firstDeath.charitableDeduction + (finalDeath?.charitableDeduction ?? 0);

  const netToHeirs = grossEstate - charitableBequests - taxesAndExpenses;
  const totalToHeirs = netToHeirs + heirsAssets;

  const charity =
    cumulativeCharityGifts(
      clientData.gifts ?? [],
      charityIds,
      yearRow.year,
      inflationRate,
    ) + charitableBequests;

  const deaths: YearlyEstateDeathRow[] = [
    buildDeathRow(firstDeath, ownerNames),
    ...(finalDeath ? [buildDeathRow(finalDeath, ownerNames)] : []),
  ];

  return {
    year: yearRow.year,
    ageClient,
    ageSpouse,
    grossEstate,
    taxesAndExpenses,
    charitableBequests,
    netToHeirs,
    heirsAssets,
    totalToHeirs,
    charity,
    deaths,
  };
}

function buildDeathRow(
  tax: EstateTaxResult,
  ownerNames: { clientName: string; spouseName: string | null },
): YearlyEstateDeathRow {
  const irdTax = sumDrainKind(tax.drainAttributions, "ird_tax");
  const decedentName =
    tax.deceased === "client"
      ? ownerNames.clientName
      : (ownerNames.spouseName ?? "Spouse");
  return {
    deathOrder: tax.deathOrder,
    deceased: tax.deceased,
    decedentName,
    estateValue: tax.grossEstate,
    taxableEstate: tax.taxableEstate,
    charitableDeduction: tax.charitableDeduction,
    stateEstateTax: tax.stateEstateTax,
    probateAndExpenses: tax.estateAdminExpenses,
    incomeTaxOnIRD: irdTax,
    estateTaxPayable: tax.federalEstateTax,
    totalTaxAtDeath:
      tax.federalEstateTax +
      tax.stateEstateTax +
      tax.estateAdminExpenses +
      irdTax,
  };
}

/** Matches the per-decedent "Total Taxes & Expenses" headline in the existing
 *  Estate Tax sub-report: engine's totalTaxesAndExpenses (estate tax + admin)
 *  plus IRD income tax (which the engine tracks as a drain attribution). */
function totalTaxAtDeath(tax: EstateTaxResult): number {
  return (
    tax.totalTaxesAndExpenses + sumDrainKind(tax.drainAttributions, "ird_tax")
  );
}

function sumDrainKind(
  attributions: DrainAttribution[] | undefined,
  kind: DrainAttribution["drainKind"],
): number {
  if (!attributions) return 0;
  let total = 0;
  for (const a of attributions) {
    if (a.drainKind === kind) total += a.amount;
  }
  return total;
}

/** Build year-N account-balance map from accountLedgers.endingValue. Mirrors
 *  the helper in src/app/.../projection/lib/derive-chart-series.ts. */
function pyAccountBalances(py: ProjectionYear): Map<string, number> {
  const balances = new Map<string, number>();
  for (const [accountId, ledger] of Object.entries(py.accountLedgers ?? {})) {
    balances.set(accountId, ledger.endingValue);
  }
  return balances;
}

function collectCharityExternalBeneficiaryIds(tree: ClientData): Set<string> {
  const ids = new Set<string>();
  for (const eb of tree.externalBeneficiaries ?? []) {
    if (eb.kind === "charity") ids.add(eb.id);
  }
  return ids;
}

/** Sum lifetime cash gifts to charity external beneficiaries given in years
 *  ≤ N, each compounded at the plan's inflation rate from gift year to N.
 *  Asset gifts to charity are not included here — those would require
 *  account-value lookups; out of scope for the v2 charity column. */
function cumulativeCharityGifts(
  gifts: Gift[],
  charityIds: Set<string>,
  year: number,
  inflationRate: number,
): number {
  let total = 0;
  for (const g of gifts) {
    if (g.year > year) continue;
    if (!g.recipientExternalBeneficiaryId) continue;
    if (!charityIds.has(g.recipientExternalBeneficiaryId)) continue;
    const yearsCompounded = Math.max(0, year - g.year);
    total += g.amount * Math.pow(1 + inflationRate, yearsCompounded);
  }
  return total;
}

function pickAvailableOrdering(
  projection: ProjectionResult,
  requested: Ordering,
): Ordering {
  const sample = projection.years.find((y) => y.hypotheticalEstateTax)
    ?.hypotheticalEstateTax;
  if (!sample) return "primaryFirst";
  if (requested === "spouseFirst" && !sample.spouseFirst) return "primaryFirst";
  return requested;
}

function pickBranch(
  ht: HypotheticalEstateTax,
  ordering: Ordering,
): HypotheticalEstateTaxOrdering {
  if (ordering === "spouseFirst" && ht.spouseFirst) return ht.spouseFirst;
  return ht.primaryFirst;
}

function parseBirthYear(dob: string | null): number | null {
  if (!dob) return null;
  const y = parseInt(dob.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}
