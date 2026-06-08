import type {
  DeathSectionData,
  EstateTransferReportData,
  ReductionsLine,
} from "@/lib/estate/transfer-report";

// ── Formatting (single source; the page-pdf imports these) ──────────────────
export function fmtUsd(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}
export function fmtPct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

// ── Household totals for one as-of selection ────────────────────────────────
export interface EstateSummaryHousehold {
  federal: number;
  state: number;
  probate: number; // admin_expenses + probate
  ird: number;
  debts: number;
  netToHeirs: number;
  taxAndCosts: number; // federal + state + probate + ird
  estateValue: number; // netToHeirs + four taxes + debts
}

/** Estate shrinkage = taxes & costs as a share of total estate value (0 if empty). */
export function shrink(h: EstateSummaryHousehold): number {
  return h.estateValue > 0 ? h.taxAndCosts / h.estateValue : 0;
}

function reductionAmount(section: DeathSectionData, kind: ReductionsLine["kind"]): number {
  return section.reductions.find((r) => r.kind === kind)?.amount ?? 0;
}

function presentSections(report: EstateTransferReportData): DeathSectionData[] {
  return [report.firstDeath, report.secondDeath].filter(
    (s): s is DeathSectionData => s != null,
  );
}

export function summarizeHousehold(report: EstateTransferReportData): EstateSummaryHousehold {
  const sections = presentSections(report);
  const sum = (kind: ReductionsLine["kind"]) =>
    sections.reduce((acc, s) => acc + reductionAmount(s, kind), 0);
  const federal = sum("federal_estate_tax");
  const state = sum("state_estate_tax");
  const probate = sum("admin_expenses") + sum("probate");
  const ird = sum("ird_tax");
  const debts = sum("debts_paid");
  const netToHeirs = report.aggregateRecipientTotals.reduce((acc, t) => acc + t.total, 0);
  const taxAndCosts = federal + state + probate + ird;
  const estateValue = netToHeirs + taxAndCosts + debts;
  return { federal, state, probate, ird, debts, netToHeirs, taxAndCosts, estateValue };
}

// ── Per-death-event rows (Form 706 gross) ───────────────────────────────────
export interface EstateSummaryDeathRow {
  label: string;
  decedentName: string;
  deathOrder: 1 | 2;
  year: number;
  grossEstate: number;
  federal: number;
  state: number;
  probate: number;
  ird: number;
  netAfterTax: number;
}

export function buildDeathRows(report: EstateTransferReportData): EstateSummaryDeathRow[] {
  const rows: EstateSummaryDeathRow[] = [];
  const pairs: Array<[DeathSectionData | null, 1 | 2]> = [
    [report.firstDeath, 1],
    [report.secondDeath, 2],
  ];
  for (const [section, order] of pairs) {
    if (!section) continue;
    const federal = reductionAmount(section, "federal_estate_tax");
    const state = reductionAmount(section, "state_estate_tax");
    const probate =
      reductionAmount(section, "admin_expenses") + reductionAmount(section, "probate");
    const ird = reductionAmount(section, "ird_tax");
    rows.push({
      label: order === 1 ? "First death" : "Second death",
      decedentName: section.decedentName,
      deathOrder: order,
      year: section.year,
      grossEstate: section.grossEstate,
      federal,
      state,
      probate,
      ird,
      netAfterTax: section.grossEstate - federal - state - probate - ird,
    });
  }
  return rows;
}
