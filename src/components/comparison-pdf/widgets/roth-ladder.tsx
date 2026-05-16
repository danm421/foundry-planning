// src/components/comparison-pdf/widgets/roth-ladder.tsx
//
// PDF renderer for the "roth-ladder" comparison widget.
//
// Layout: one DataTable per plan (mirroring snapshot-cell's per-plan layout).
// Columns: Year | Age | Gross Conversion | Taxable Portion
//
// Note: The spec also lists "Ending Roth balance" and "Tax on conversion" as
// distinct columns, but the engine's ProjectionYear only exposes
// `rothConversions[].gross` and `rothConversions[].taxable` per conversion
// entry. There is no pre-computed "tax on conversion" dollar figure or a
// dedicated "ending Roth balance" field on ProjectionYear — those would require
// a full marginal tax calc and an account-ledger scan that belong in a separate
// helper. The two available columns (gross and taxable income recognized) give
// advisors the information needed to reason about the ladder.
//
// Zero-conversion years are filtered out.
// yearRange filter is inclusive on both ends.
// compact mode is engaged when span ≤ 3.
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
});

interface Props {
  config: unknown;
  plans: ComparisonPlan[];
  mc: McSharedResult | null;
  yearRange: YearRange | null;
  span: CellSpan;
  branding: BrandingResolved;
}

interface Row {
  year: string;
  age: string;
  gross: string;
  taxable: string;
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

type ProjectionYearLike = ComparisonPlan["result"]["years"][number];

function sumConversions(year: ProjectionYearLike): { gross: number; taxable: number } {
  const conversions = (year as { rothConversions?: { gross: number; taxable: number }[] }).rothConversions ?? [];
  let gross = 0;
  let taxable = 0;
  for (const c of conversions) {
    gross += c.gross;
    taxable += c.taxable;
  }
  return { gross, taxable };
}

const COLUMNS: DataTableColumn<Row>[] = [
  { header: "Year", accessor: (r) => r.year, align: "left", width: "15%" },
  { header: "Age", accessor: (r) => r.age, align: "right", width: "15%" },
  { header: "Gross Conversion", accessor: (r) => r.gross, align: "right", width: "35%" },
  { header: "Taxable Portion", accessor: (r) => r.taxable, align: "right", width: "35%" },
];

const COLUMNS_COMPACT: DataTableColumn<Row>[] = [
  { header: "Year", accessor: (r) => r.year, align: "left", width: "20%" },
  { header: "Age", accessor: (r) => r.age, align: "right", width: "20%" },
  { header: "Gross", accessor: (r) => r.gross, align: "right", width: "60%" },
];

function buildRows(plan: ComparisonPlan, yearRange: YearRange | null): Row[] {
  let years = plan.result.years;
  if (yearRange) {
    years = years.filter((y) => y.year >= yearRange.start && y.year <= yearRange.end);
  }

  return years
    .filter((y) => sumConversions(y).gross > 0)
    .map((y) => {
      const { gross, taxable } = sumConversions(y);
      return {
        year: String(y.year),
        age: y.ages?.client != null ? String(y.ages.client) : "—",
        gross: usd.format(gross),
        taxable: usd.format(taxable),
      };
    });
}

export function RothLadderPdf({ plans, yearRange, span }: Props) {
  const compact = span <= 3;
  const multiPlan = plans.length > 1;
  const columns = compact ? COLUMNS_COMPACT : COLUMNS;

  return (
    <View style={[s.wrap, { width: SPAN_WIDTH[span] }]}>
      {plans.map((plan, idx) => {
        const rows = buildRows(plan, yearRange);
        const dotColor = seriesColor(idx) ?? PDF_THEME.ink3;

        return (
          <View key={plan.id} style={s.planBlock}>
            {multiPlan && (
              <View style={s.planHeader}>
                <View style={[s.dot, { backgroundColor: dotColor }]} />
                <Text style={s.planLabel}>{plan.label}</Text>
              </View>
            )}
            <DataTable<Row>
              columns={columns}
              rows={rows}
              compact={compact}
            />
          </View>
        );
      })}
    </View>
  );
}
