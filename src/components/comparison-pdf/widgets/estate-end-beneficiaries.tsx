// src/components/comparison-pdf/widgets/estate-end-beneficiaries.tsx
//
// PDF renderer for the "estate-end-beneficiaries" comparison widget.
//
// Two divergences from the plan text are intentional:
//
// 1. Data shape correction. The plan describes reading
//    `plan.finalEstate.beneficiaries`. That field does not exist —
//    `plan.finalEstate` is a `YearlyEstateRow | null` (see
//    src/lib/estate/yearly-estate-report.ts) that carries scalar totals
//    (grossEstate, netToHeirs, …) and no per-beneficiary breakdown. The
//    actual beneficiary-level data is produced by
//    `buildEstateTransferReportData` and surfaced as
//    `aggregateRecipientTotals` — the same source the screen widget
//    consumes. We use that source here.
//
// 2. Table vs. chart. The screen widget at
//    src/components/comparison/estate-end-beneficiaries-comparison-section.tsx
//    renders a `YearlyEstateBeneficiaryChart`. The plan calls for a table
//    in the PDF. Charts are handled separately via the snapshot-cell
//    DOM-canvas → PNG fallback; a table is the cleaner, more accessible
//    print representation. Both views are valid and reflect the same
//    underlying data — by-recipient totals across both deaths, excluding
//    the surviving spouse (transfers to spouse aren't "end beneficiaries"
//    in this view, they pass on to the second-death recipients).
//
// Columns: Beneficiary | Share | Amount.
//   Beneficiary = recipient.recipientLabel
//   Share       = recipient.total / sum(recipients.total) * 100 (1 decimal)
//                 If denominator is zero, show "—" for share.
//   Amount      = recipient.total formatted as USD with no decimals.
// Rows are sorted by Amount descending.
// A final "Total" row shows the sum amount and 100.0% (omitted when the
// denominator is zero, i.e. there is nothing meaningful to sum).
//
// Empty state: when there are no non-spouse recipients (e.g. no deaths in
// the projection window) we render "No beneficiary data available." with
// no table.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "@/components/pdf/theme";
import { DataTable } from "@/components/pdf/widgets/data-table";
import type { DataTableColumn } from "@/components/pdf/widgets/data-table";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { McSharedResult } from "@/lib/comparison/widgets/types";
import type { CellSpan, YearRange } from "@/lib/comparison/layout-schema";
import type { BrandingResolved } from "@/lib/comparison-pdf/branding";
import {
  buildEstateTransferReportData,
  type RecipientTotal,
} from "@/lib/estate/transfer-report";
import { deriveOwnerNames } from "@/lib/comparison/owner-info";
import { seriesColor } from "@/lib/comparison/series-palette";

const SPAN_WIDTH: Record<CellSpan, string> = {
  1: "20%",
  2: "40%",
  3: "60%",
  4: "80%",
  5: "100%",
};

const s = StyleSheet.create({
  wrap: { padding: 6 },
  planBlock: { marginBottom: 12 },
  planHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  planLabel: {
    fontFamily: "Inter",
    fontSize: 10,
    fontWeight: 700,
    color: PDF_THEME.ink,
  },
  emptyText: {
    fontFamily: "Inter",
    fontSize: 9,
    color: PDF_THEME.ink3,
    marginTop: 4,
  },
});

interface Props {
  config: unknown;
  plans: ComparisonPlan[];
  mc: McSharedResult | null;
  yearRange: YearRange | null;
  span: CellSpan;
  branding: BrandingResolved;
}

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function fmtCurrency(n: number): string {
  return CURRENCY.format(n);
}

function fmtShare(amount: number, denominator: number): string {
  if (denominator <= 0) return "—";
  const pct = (amount / denominator) * 100;
  return `${pct.toFixed(1)}%`;
}

export interface BeneficiaryRow {
  beneficiary: string;
  share: string;
  amount: string;
}

/**
 * Pure helper: build display rows from a list of RecipientTotal.
 * - Drops spouse entries (recipient.recipientKind === "spouse").
 * - Sorts remaining rows by total amount descending.
 * - Formats share as `N.N%` against the post-filter total; "—" when zero.
 *
 * Exported so the row-building logic can be unit-tested independent of
 * the full projection + buildEstateTransferReportData pipeline.
 */
export function buildBeneficiaryRows(
  recipients: RecipientTotal[],
): BeneficiaryRow[] {
  const filtered = recipients.filter((r) => r.recipientKind !== "spouse");
  if (filtered.length === 0) return [];
  const sorted = [...filtered].sort((a, b) => b.total - a.total);
  const denom = sorted.reduce((sum, r) => sum + r.total, 0);
  return sorted.map((r) => ({
    beneficiary: r.recipientLabel,
    share: fmtShare(r.total, denom),
    amount: fmtCurrency(r.total),
  }));
}

function buildTotalRow(recipients: RecipientTotal[]): BeneficiaryRow | null {
  const filtered = recipients.filter((r) => r.recipientKind !== "spouse");
  const denom = filtered.reduce((sum, r) => sum + r.total, 0);
  if (denom <= 0) return null;
  return {
    beneficiary: "Total",
    share: "100.0%",
    amount: fmtCurrency(denom),
  };
}

/** Exposed for tests only. Not part of the public widget surface. */
export const __TEST_ONLY__ = { buildTotalRow };

const COLUMNS: DataTableColumn<BeneficiaryRow>[] = [
  { header: "Beneficiary", accessor: (r) => r.beneficiary, align: "left",  width: "50%" },
  { header: "Share",       accessor: (r) => r.share,       align: "right", width: "20%" },
  { header: "Amount",      accessor: (r) => r.amount,      align: "right", width: "30%" },
];

/**
 * Pure inner renderer: given a pre-computed list of `RecipientTotal`,
 * renders the per-plan block (optional plan header + beneficiary table +
 * total row, or the empty-state message).
 *
 * Exported so unit tests can render the table body directly with canned
 * recipients without standing up a full projection fixture and routing
 * through `buildEstateTransferReportData`. Production code should call
 * `EstateEndBeneficiariesPdf` instead — it owns the data-fetching.
 */
export function EstateBeneficiariesBlock({
  recipients,
  planLabel,
  multiPlan,
  dotColor,
  compact,
}: {
  recipients: RecipientTotal[];
  planLabel: string | undefined;
  multiPlan: boolean;
  dotColor: string;
  compact: boolean;
}) {
  const rows = buildBeneficiaryRows(recipients);
  const total = buildTotalRow(recipients);

  return (
    <View style={s.planBlock}>
      {multiPlan && (
        <View style={s.planHeader}>
          <View style={[s.dot, { backgroundColor: dotColor }]} />
          <Text style={s.planLabel}>{planLabel}</Text>
        </View>
      )}
      {rows.length === 0 ? (
        <Text style={s.emptyText}>No beneficiary data available.</Text>
      ) : (
        <DataTable<BeneficiaryRow>
          columns={COLUMNS}
          rows={rows}
          footerRow={total ?? undefined}
          compact={compact}
        />
      )}
    </View>
  );
}

function PlanBlock({
  plan,
  index,
  multiPlan,
  compact,
}: {
  plan: ComparisonPlan;
  index: number;
  multiPlan: boolean;
  compact: boolean;
}) {
  const ownerNames = deriveOwnerNames(plan.tree);
  const split = buildEstateTransferReportData({
    projection: plan.result,
    asOf: { kind: "split" },
    ordering: "primaryFirst",
    clientData: plan.tree,
    ownerNames,
  });
  const dotColor = seriesColor(index) ?? PDF_THEME.ink3;

  return (
    <EstateBeneficiariesBlock
      recipients={split.aggregateRecipientTotals}
      planLabel={plan.label}
      multiPlan={multiPlan}
      dotColor={dotColor}
      compact={compact}
    />
  );
}

export function EstateEndBeneficiariesPdf({
  plans,
  mc: _mc,
  yearRange: _yearRange,
  span,
}: Props) {
  const compact = span <= 3;
  const multiPlan = plans.length > 1;

  return (
    <View style={[s.wrap, { width: SPAN_WIDTH[span] }]}>
      {plans.map((plan, idx) => (
        <PlanBlock
          key={plan.id}
          plan={plan}
          index={idx}
          multiPlan={multiPlan}
          compact={compact}
        />
      ))}
    </View>
  );
}
