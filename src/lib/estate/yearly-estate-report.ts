import type { ProjectionResult } from "@/engine";
import type {
  DeathTransfer,
  DrainAttribution,
  EstateTaxResult,
  HypotheticalEstateTax,
  HypotheticalEstateTaxOrdering,
} from "@/engine/types";

export type Ordering = "primaryFirst" | "spouseFirst";

export interface YearlyEstateReportInput {
  projection: ProjectionResult;
  ordering: Ordering;
  ownerNames: { clientName: string; spouseName: string | null };
  ownerDobs: { clientDob: string | null; spouseDob: string | null };
}

export interface YearlyEstateRow {
  year: number;
  ageClient: number | null;
  ageSpouse: number | null;
  /** Sole or final-death gross estate value (Form 706 §1). */
  grossEstate: number;
  /** Sum across both deaths: federal + state + admin + IRD income tax. */
  taxesAndExpenses: number;
  /** grossEstate − taxesAndExpenses. The post-tax probate estate. */
  netToHeirs: number;
  /** Out-of-estate assets passing to charity (post-drain net). */
  charityAssets: number;
  /** Out-of-estate assets passing to heirs (post-drain net). */
  heirsAssets: number;
  /** netToHeirs + heirsAssets. */
  totalToHeirs: number;
  /** totalToHeirs + charityAssets. */
  totalToHeirsAndCharity: number;
  /** Per-decedent rows for the drill-down. One entry per death event in the
   *  chosen ordering (1 for single, 2 for married). */
  deaths: YearlyEstateDeathRow[];
}

export interface YearlyEstateDeathRow {
  deathOrder: 1 | 2;
  deceased: "client" | "spouse";
  decedentName: string;
  /** Form 706 gross estate for THIS death event. */
  estateValue: number;
  taxableEstate: number;
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
  /** Sum across all rows of taxesAndExpenses (used for table footer). */
  totals: {
    taxesAndExpenses: number;
    netToHeirs: number;
    charityAssets: number;
    heirsAssets: number;
    totalToHeirs: number;
    totalToHeirsAndCharity: number;
  };
}

/** Public entry point. */
export function buildYearlyEstateReport(
  input: YearlyEstateReportInput,
): YearlyEstateReport {
  const { projection, ordering, ownerNames, ownerDobs } = input;
  const resolvedOrdering = pickAvailableOrdering(projection, ordering);

  const clientBirthYear = parseBirthYear(ownerDobs.clientDob);
  const spouseBirthYear = parseBirthYear(ownerDobs.spouseDob);

  const rows: YearlyEstateRow[] = [];
  for (const yearRow of projection.years) {
    const ht = yearRow.hypotheticalEstateTax;
    if (!ht) continue;
    const branch = pickBranch(ht, resolvedOrdering);
    const row = buildYearlyRow({
      year: yearRow.year,
      ageClient: clientBirthYear ? yearRow.year - clientBirthYear : null,
      ageSpouse: spouseBirthYear ? yearRow.year - spouseBirthYear : null,
      branch,
      ownerNames,
    });
    rows.push(row);
  }

  return {
    ordering: resolvedOrdering,
    rows,
    totals: rows.reduce(
      (acc, r) => ({
        taxesAndExpenses: acc.taxesAndExpenses + r.taxesAndExpenses,
        netToHeirs: acc.netToHeirs + r.netToHeirs,
        charityAssets: acc.charityAssets + r.charityAssets,
        heirsAssets: acc.heirsAssets + r.heirsAssets,
        totalToHeirs: acc.totalToHeirs + r.totalToHeirs,
        totalToHeirsAndCharity:
          acc.totalToHeirsAndCharity + r.totalToHeirsAndCharity,
      }),
      {
        taxesAndExpenses: 0,
        netToHeirs: 0,
        charityAssets: 0,
        heirsAssets: 0,
        totalToHeirs: 0,
        totalToHeirsAndCharity: 0,
      },
    ),
  };
}

interface RowBuilderArgs {
  year: number;
  ageClient: number | null;
  ageSpouse: number | null;
  branch: HypotheticalEstateTaxOrdering;
  ownerNames: { clientName: string; spouseName: string | null };
}

function buildYearlyRow(args: RowBuilderArgs): YearlyEstateRow {
  const { year, ageClient, ageSpouse, branch, ownerNames } = args;

  const firstDeath = branch.firstDeath;
  const finalDeath = branch.finalDeath;

  // Gross estate for the SUMMARY row. For married households this is the
  // final death's gross estate (the surviving spouse's combined assets,
  // grown to that year). For single filers there's only one death so use
  // firstDeath.
  const summaryEstate = finalDeath ?? firstDeath;
  const grossEstate = summaryEstate.grossEstate;

  // Taxes & Expenses across all death events in this hypothetical.
  const firstTaxes = computeTotalTaxAtDeath(firstDeath);
  const finalTaxes = finalDeath ? computeTotalTaxAtDeath(finalDeath) : 0;
  const taxesAndExpenses = firstTaxes + finalTaxes;

  // Aggregate transfer ledger across both death events. Engine populates
  // these post-drain at second death and gross at first; we sum t.amount so
  // first-death transfers re-gross to first-death gross-estate value (which
  // includes life-insurance proceeds, etc., that pour out before any drain
  // hits). For the summary "Heirs/Charity Assets" we want post-drain net,
  // so we subtract each recipient's drain share.
  const allTransfers: DeathTransfer[] = [
    ...branch.firstDeathTransfers,
    ...(branch.finalDeathTransfers ?? []),
  ];
  const allDrainAttributions: DrainAttribution[] = [
    ...firstDeath.drainAttributions,
    ...(finalDeath?.drainAttributions ?? []),
  ];

  const buckets = bucketRecipientFlows(allTransfers, allDrainAttributions);

  // Net to heirs = probate-estate slice flowing through Form 706.
  const netToHeirs = grossEstate - taxesAndExpenses;

  // Heirs Assets = OUT-OF-estate value flowing to non-spouse heirs.
  // Subtract `netToHeirs` from total-net-to-heirs so the column captures
  // only the slice that bypasses probate (ILITs, irrevocable trusts, etc.).
  const heirsAssets = Math.max(0, buckets.heirsNet - netToHeirs);

  // Charity Assets = entire charity-net flow. At first death, charity
  // bequests are also reflected as a charitable deduction in Form 706
  // (so they're not in the gross estate or netToHeirs). At second death,
  // charitable bequests come out of gross estate but Form 706 deducts them
  // before tax; they still show up here as recipient flow.
  const charityAssets = buckets.charityNet;

  const totalToHeirs = netToHeirs + heirsAssets;
  const totalToHeirsAndCharity = totalToHeirs + charityAssets;

  const deaths: YearlyEstateDeathRow[] = [
    buildDeathRow(firstDeath, ownerNames),
    ...(finalDeath ? [buildDeathRow(finalDeath, ownerNames)] : []),
  ];

  return {
    year,
    ageClient,
    ageSpouse,
    grossEstate,
    taxesAndExpenses,
    netToHeirs,
    charityAssets,
    heirsAssets,
    totalToHeirs,
    totalToHeirsAndCharity,
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
  const totalTaxAtDeath =
    tax.federalEstateTax +
    tax.stateEstateTax +
    tax.estateAdminExpenses +
    irdTax;
  return {
    deathOrder: tax.deathOrder,
    deceased: tax.deceased,
    decedentName,
    estateValue: tax.grossEstate,
    taxableEstate: tax.taxableEstate,
    stateEstateTax: tax.stateEstateTax,
    probateAndExpenses: tax.estateAdminExpenses,
    incomeTaxOnIRD: irdTax,
    estateTaxPayable: tax.federalEstateTax,
    totalTaxAtDeath,
  };
}

function computeTotalTaxAtDeath(tax: EstateTaxResult): number {
  const ird = sumDrainKind(tax.drainAttributions, "ird_tax");
  return (
    tax.federalEstateTax + tax.stateEstateTax + tax.estateAdminExpenses + ird
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

interface RecipientFlowBuckets {
  /** Post-drain net flow to non-spouse, non-charity recipients. */
  heirsNet: number;
  /** Post-drain net flow to external_beneficiary recipients. */
  charityNet: number;
}

/**
 * Group transfer flows post-drain by recipient class. Spouse flows are
 * dropped (they stay in the household). Entity recipients are bucketed as
 * heirs by default — distinguishing charitable vs heir-benefiting trusts
 * requires entity metadata not carried on the transfer; for v1 we treat
 * external_beneficiary as the canonical charity bucket and entity as heirs.
 */
function bucketRecipientFlows(
  transfers: DeathTransfer[],
  drains: DrainAttribution[],
): RecipientFlowBuckets {
  type Key = string;
  const grossByKey = new Map<Key, number>();
  const drainByKey = new Map<Key, number>();
  const kindByKey = new Map<Key, DeathTransfer["recipientKind"]>();

  const keyOf = (
    kind: DeathTransfer["recipientKind"],
    id: string | null,
  ): Key => `${kind}|${id ?? ""}`;

  for (const t of transfers) {
    const k = keyOf(t.recipientKind, t.recipientId);
    grossByKey.set(k, (grossByKey.get(k) ?? 0) + t.amount);
    kindByKey.set(k, t.recipientKind);
  }
  for (const d of drains) {
    const k = keyOf(d.recipientKind, d.recipientId);
    drainByKey.set(k, (drainByKey.get(k) ?? 0) + d.amount);
    if (!kindByKey.has(k)) kindByKey.set(k, d.recipientKind);
  }

  let heirsNet = 0;
  let charityNet = 0;
  for (const [k, gross] of grossByKey.entries()) {
    const kind = kindByKey.get(k);
    if (!kind || kind === "spouse" || kind === "system_default") continue;
    const net = gross - (drainByKey.get(k) ?? 0);
    if (net <= 0) continue;
    if (kind === "external_beneficiary") {
      charityNet += net;
    } else {
      heirsNet += net;
    }
  }

  return { heirsNet, charityNet };
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
