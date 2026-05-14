// src/components/comparison-pdf/widgets/major-transactions.tsx
//
// PDF renderer for the "major-transactions" comparison widget.
//
// Divergences from the task plan text — documented inline per established
// precedent (Tasks 4.5–4.10):
//
// 1. "Threshold config" deviation. The plan text references a dollar-amount
//    threshold filter that does NOT exist in the screen widget at
//    `src/components/comparison/major-transactions-comparison-section.tsx`
//    or its widget definition at `src/lib/comparison/widgets/major-transactions.tsx`.
//    The actual filter is the widget's `hasDataInYear` predicate: drop years
//    where `techniqueBreakdown.sales.length === 0 AND techniqueBreakdown.purchases.length === 0`.
//    We mirror that active-year filter rather than invent a threshold.
//
// 2. Flat DataTable vs nested per-year sub-tables. The screen widget renders
//    a per-year card containing a "Sales" sub-table, a "Purchases" sub-table,
//    and a "Net Surplus" footer. The plan asks for a single flat DataTable
//    with columns Year | Description | Inflow | Outflow, which is more
//    PDF-friendly. Year grouping is preserved via the Year column; net
//    inflow/outflow is derivable from the Total row.
//
// 3. `yearRange` IS honored here. Unlike most bucket-4 widgets that render
//    their full data series and ignore the prop, the screen widget for major
//    transactions explicitly clips by `yearRange` before applying its active-
//    year filter, so we preserve that behavior here.
//
// Row data mapping:
//   - For each `sale` in a year: { year, description: sale.name, inflow: sale.netProceeds, outflow: 0 }
//   - For each `purchase` in a year: { year, description: purchase.name, inflow: 0, outflow: purchase.purchasePrice }
//
// Sort order: year ascending, then sales before purchases within a year
// (matches reading order in the screen widget).
//
// Currency formatting: USD with no fractional digits via Intl.NumberFormat.
// Zero values in the Inflow / Outflow columns render as an em-dash ("—")
// — same convention as gift-tax — to keep the table readable.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "@/components/pdf/theme";
import { DataTable } from "@/components/pdf/widgets/data-table";
import type { DataTableColumn } from "@/components/pdf/widgets/data-table";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { McSharedResult } from "@/lib/comparison/widgets/types";
import type { CellSpan, YearRange } from "@/lib/comparison/layout-schema";
import type { BrandingResolved } from "@/lib/comparison-pdf/branding";
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

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function fmt(n: number): string {
  return n === 0 ? "—" : CURRENCY.format(n);
}

export interface TransactionRow {
  year: number;
  description: string;
  inflow: number;
  outflow: number;
}

/**
 * Pure helper: build the flat row list for a single plan.
 *
 * Apply (in order):
 *   1. `yearRange` clipping (inclusive on both ends), if provided.
 *   2. Active-year filter — drop years with empty sales AND empty purchases.
 *   3. Emit one row per sale (inflow column) and one row per purchase
 *      (outflow column).
 *
 * Sales are emitted before purchases within a year. Years are already in
 * ascending order in `plan.result.years`; we preserve that.
 *
 * Exported so the widget's filter / mapping logic is unit-testable without
 * full `ComparisonPlan` fixtures in the renderer tests.
 */
export function buildTransactionRows(
  plan: ComparisonPlan,
  yearRange: YearRange | null,
): TransactionRow[] {
  let years = plan.result.years;
  if (yearRange) {
    years = years.filter((y) => y.year >= yearRange.start && y.year <= yearRange.end);
  }
  // Sort by year ascending so output respects reading order even when the
  // engine emits years out of order (defensive — production years are
  // already chronologically ordered).
  years = [...years].sort((a, b) => a.year - b.year);

  const rows: TransactionRow[] = [];
  for (const y of years) {
    const t = y.techniqueBreakdown;
    if (!t) continue;
    if (t.sales.length === 0 && t.purchases.length === 0) continue;

    for (const sale of t.sales) {
      rows.push({
        year: y.year,
        description: sale.name,
        inflow: sale.netProceeds,
        outflow: 0,
      });
    }
    for (const purchase of t.purchases) {
      rows.push({
        year: y.year,
        description: purchase.name,
        inflow: 0,
        outflow: purchase.purchasePrice,
      });
    }
  }
  return rows;
}

// The Year accessor treats `description === "Total"` as a footer marker and
// returns "" for that cell, so the Total label sits in the Description column
// on the footer row (since DataTable uses one accessor per column for both
// body and footer rows).
const COLUMNS: DataTableColumn<TransactionRow>[] = [
  {
    header: "Year",
    accessor: (r) => (r.description === "Total" ? "" : String(r.year)),
    align: "left",
    width: "10%",
  },
  {
    header: "Description",
    accessor: (r) => r.description,
    align: "left",
    width: "50%",
  },
  {
    header: "Inflow",
    accessor: (r) => fmt(r.inflow),
    align: "right",
    width: "20%",
  },
  {
    header: "Outflow",
    accessor: (r) => fmt(r.outflow),
    align: "right",
    width: "20%",
  },
];

/**
 * Pure inner renderer. Takes pre-filtered `rows` plus presentation props
 * (plan label, multi-plan flag, dot color, compact mode) and renders one
 * per-plan block — optional plan header dot + label, DataTable with a Total
 * footer row, or the empty-state message.
 *
 * Exported so tests can render the block directly with canned rows and
 * skip the `ComparisonPlan` fixture plumbing.
 */
export function MajorTransactionsBlock({
  rows,
  planLabel,
  multiPlan,
  dotColor,
  compact,
}: {
  rows: TransactionRow[];
  planLabel: string | undefined;
  multiPlan: boolean;
  dotColor: string;
  compact: boolean;
}) {
  if (rows.length === 0) {
    return (
      <View style={s.planBlock}>
        {multiPlan && (
          <View style={s.planHeader}>
            <View style={[s.dot, { backgroundColor: dotColor }]} />
            <Text style={s.planLabel}>{planLabel}</Text>
          </View>
        )}
        <Text style={s.emptyText}>No major transactions in selected range.</Text>
      </View>
    );
  }

  const totalInflow = rows.reduce((sum, r) => sum + r.inflow, 0);
  const totalOutflow = rows.reduce((sum, r) => sum + r.outflow, 0);
  const footerRow: TransactionRow = {
    year: 0,
    description: "Total",
    inflow: totalInflow,
    outflow: totalOutflow,
  };

  return (
    <View style={s.planBlock}>
      {multiPlan && (
        <View style={s.planHeader}>
          <View style={[s.dot, { backgroundColor: dotColor }]} />
          <Text style={s.planLabel}>{planLabel}</Text>
        </View>
      )}
      <DataTable<TransactionRow>
        columns={COLUMNS}
        rows={rows}
        footerRow={footerRow}
        compact={compact}
      />
    </View>
  );
}

// ── Outer wrapper (production entrypoint) ────────────────────────────────────

interface Props {
  config: unknown;
  plans: ComparisonPlan[];
  mc: McSharedResult | null;
  yearRange: YearRange | null;
  span: CellSpan;
  branding: BrandingResolved;
}

export function MajorTransactionsPdf({
  plans,
  mc: _mc,
  yearRange,
  span,
}: Props) {
  const compact = span <= 3;
  const multiPlan = plans.length > 1;

  return (
    <View style={[s.wrap, { width: SPAN_WIDTH[span] }]}>
      {plans.map((plan, idx) => {
        const rows = buildTransactionRows(plan, yearRange);
        const dotColor = seriesColor(idx) ?? PDF_THEME.ink3;
        return (
          <MajorTransactionsBlock
            key={plan.id}
            rows={rows}
            planLabel={plan.label}
            multiPlan={multiPlan}
            dotColor={dotColor}
            compact={compact}
          />
        );
      })}
    </View>
  );
}
