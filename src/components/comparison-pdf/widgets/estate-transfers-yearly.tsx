// src/components/comparison-pdf/widgets/estate-transfers-yearly.tsx
//
// PDF renderer for the "estate-transfers-yearly" comparison widget.
//
// Layout: one block per plan, stacked vertically. Each block renders the
// year-by-year estate transfer table built by `buildYearlyEstateReport`,
// followed by per-year drill-down sub-rows for years that contain death
// events.
//
// Two divergences from the plan text are intentional:
//
// 1. Chart vs table. The screen widget at
//    src/components/comparison/estate-transfers-yearly-comparison-section.tsx
//    supports three view modes ("chart" | "table" | "chart+table"). The PDF
//    always renders the table — same precedent as the
//    estate-end-beneficiaries renderer (Task 4.9). Chart-mode export is
//    handled by the snapshot-cell PNG fallback; the table is the canonical
//    static representation. `cell.widget.config` is intentionally ignored.
//
// 2. No expand/collapse. The screen widget gates the per-decedent drill-down
//    behind a clickable Taxes & Expenses cell. The PDF surfaces every
//    drill-down unconditionally, immediately below the parent year row.
//
// 3. Drill-down column label "State Estate / Inheritance Tax" is shortened
//    to "State Estate Tax" so the narrower PDF cell holds the header.
//
// `yearRange` is intentionally NOT applied — the on-screen widget renders
// every projected year, so we preserve that here. The prop is accepted for
// interface uniformity (`_yearRange`).
//
// `mc` is unused (`_mc`).
//
// Column-fit: at span >= 4 the 7-column outer table fits comfortably. At
// span <= 3 we engage compact mode (smaller font + padding). Below span 3
// the table will be cramped — advisors typically place this widget at span
// 4 or 5; we don't aggressively drop columns here.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "@/components/pdf/theme";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { McSharedResult } from "@/lib/comparison/widgets/types";
import type { CellSpan, YearRange } from "@/lib/comparison/layout-schema";
import type { BrandingResolved } from "@/lib/comparison-pdf/branding";
import {
  buildYearlyEstateReport,
  type YearlyEstateReport,
  type YearlyEstateRow,
  type YearlyEstateDeathRow,
} from "@/lib/estate/yearly-estate-report";
import { deriveOwnerNames, deriveOwnerDobs } from "@/lib/comparison/owner-info";
import { seriesColor } from "@/lib/comparison/series-palette";

const SPAN_WIDTH: Record<CellSpan, string> = {
  1: "20%",
  2: "40%",
  3: "60%",
  4: "80%",
  5: "100%",
};

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function fmt(n: number): string {
  return CURRENCY.format(n);
}

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
  orderingLabel: {
    fontFamily: "Inter",
    fontSize: 8,
    fontWeight: 600,
    color: PDF_THEME.ink3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  emptyText: {
    fontFamily: "Inter",
    fontSize: 9,
    color: PDF_THEME.ink3,
    marginTop: 4,
  },
  // Outer table styles
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: PDF_THEME.hair,
    paddingBottom: 2,
    marginBottom: 1,
  },
  bodyRow: {
    flexDirection: "row",
    paddingVertical: 2,
  },
  totalRow: {
    flexDirection: "row",
    borderTopWidth: 0.5,
    borderTopColor: PDF_THEME.hair,
    paddingTop: 2,
    marginTop: 1,
  },
  cellHeader: {
    fontFamily: "Inter",
    fontSize: 7,
    fontWeight: 600,
    color: PDF_THEME.ink3,
  },
  cell: {
    fontFamily: "Inter",
    fontSize: 8,
    color: PDF_THEME.ink,
  },
  cellTotal: {
    fontFamily: "Inter",
    fontSize: 8,
    fontWeight: 700,
    color: PDF_THEME.ink,
  },
  alignLeft: { textAlign: "left" },
  alignRight: { textAlign: "right" },
  // Drill-down sub-table styles
  drilldownWrap: {
    backgroundColor: "#f0ead9", // subtle warm tint over paper
    paddingHorizontal: 4,
    paddingVertical: 3,
    marginTop: 1,
    marginBottom: 2,
    borderLeftWidth: 1,
    borderLeftColor: PDF_THEME.hair,
  },
  drilldownHeading: {
    fontFamily: "Inter",
    fontSize: 7,
    fontWeight: 700,
    color: PDF_THEME.ink3,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  innerHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 0.25,
    borderBottomColor: PDF_THEME.hair,
    paddingBottom: 1,
  },
  innerBodyRow: {
    flexDirection: "row",
    paddingVertical: 1,
  },
  innerCellHeader: {
    fontFamily: "Inter",
    fontSize: 6,
    fontWeight: 600,
    color: PDF_THEME.ink3,
  },
  innerCell: {
    fontFamily: "Inter",
    fontSize: 7,
    color: PDF_THEME.ink,
  },
  innerCellBold: {
    fontFamily: "Inter",
    fontSize: 7,
    fontWeight: 700,
    color: PDF_THEME.ink,
  },
  // Compact variants
  cellHeaderCompact: { fontSize: 6 },
  cellCompact: { fontSize: 7 },
  cellTotalCompact: { fontSize: 7 },
  orderingLabelCompact: { fontSize: 7, marginBottom: 2 },
  innerCellHeaderCompact: { fontSize: 5 },
  innerCellCompact: { fontSize: 6 },
  innerCellBoldCompact: { fontSize: 6 },
  drilldownHeadingCompact: { fontSize: 6 },
});

// ── Column model ─────────────────────────────────────────────────────────────

export interface OuterCol {
  key: keyof Pick<
    YearlyEstateRow,
    | "grossEstate"
    | "taxesAndExpenses"
    | "charitableBequests"
    | "netToHeirs"
    | "heirsAssets"
    | "totalToHeirs"
    | "charity"
  >;
  label: string;
  /** Lifetime total — undefined when no meaningful sum exists. */
  totalKey?: keyof YearlyEstateReport["totals"];
}

const ALL_OUTER_COLS: OuterCol[] = [
  { key: "grossEstate", label: "Gross Estate" },
  { key: "taxesAndExpenses", label: "Taxes & Expenses", totalKey: "taxesAndExpenses" },
  { key: "charitableBequests", label: "Charitable Bequests", totalKey: "charitableBequests" },
  { key: "netToHeirs", label: "Net To Heirs", totalKey: "netToHeirs" },
  { key: "heirsAssets", label: "Heirs Assets" },
  { key: "totalToHeirs", label: "Total To Heirs", totalKey: "totalToHeirs" },
  { key: "charity", label: "Charity", totalKey: "charity" },
];

/**
 * Pure helper: drop columns whose row values AND total are zero/undefined.
 * Mirrors the screen widget filter at yearly-estate-table.tsx:81-86.
 *
 * Exported so the column-filter logic is unit-testable independent of the
 * full PDF tree.
 */
export function filterVisibleCols(
  cols: OuterCol[],
  report: YearlyEstateReport,
): OuterCol[] {
  return cols.filter((c) => {
    const allRowsZero = report.rows.every(
      (r) => (r[c.key] as number) === 0,
    );
    const total = c.totalKey ? report.totals[c.totalKey] : undefined;
    const totalZero = total === undefined || total === 0;
    return !(allRowsZero && totalZero);
  });
}

// ── Inner block ──────────────────────────────────────────────────────────────

interface DeathSubRowProps {
  death: YearlyEstateDeathRow;
  ownerNames: { clientName: string; spouseName: string | null };
  compact: boolean;
}

function DeathSubRow({ death, ownerNames, compact }: DeathSubRowProps) {
  const orderLabel = death.deathOrder === 1 ? "1st death" : "Final death";
  const altName =
    death.deceased === "client"
      ? (ownerNames.spouseName ?? "Spouse")
      : ownerNames.clientName;
  const decedentLabel = `${death.decedentName} · ${orderLabel} · survived by ${altName}`;

  // 9 columns within the inner table — name takes 25%, the 8 numeric
  // columns split the remaining 75% evenly.
  const nameCol = "25%";
  const numCol = `${75 / 8}%`;
  const cellStyle = compact ? s.innerCellCompact : s.innerCell;
  const boldStyle = compact ? s.innerCellBoldCompact : s.innerCellBold;

  return (
    <View style={s.innerBodyRow}>
      <Text style={[cellStyle, s.alignLeft, { width: nameCol }]}>
        {decedentLabel}
      </Text>
      <Text style={[cellStyle, s.alignRight, { width: numCol }]}>
        {fmt(death.estateValue)}
      </Text>
      <Text style={[cellStyle, s.alignRight, { width: numCol }]}>
        {fmt(death.charitableDeduction)}
      </Text>
      <Text style={[cellStyle, s.alignRight, { width: numCol }]}>
        {fmt(death.taxableEstate)}
      </Text>
      <Text style={[cellStyle, s.alignRight, { width: numCol }]}>
        {fmt(death.stateEstateTax)}
      </Text>
      <Text style={[cellStyle, s.alignRight, { width: numCol }]}>
        {fmt(death.probateAndExpenses)}
      </Text>
      <Text style={[cellStyle, s.alignRight, { width: numCol }]}>
        {fmt(death.incomeTaxOnIRD)}
      </Text>
      <Text style={[cellStyle, s.alignRight, { width: numCol }]}>
        {fmt(death.estateTaxPayable)}
      </Text>
      <Text style={[boldStyle, s.alignRight, { width: numCol }]}>
        {fmt(death.totalTaxAtDeath)}
      </Text>
    </View>
  );
}

function DeathDrilldown({
  deaths,
  ownerNames,
  compact,
}: {
  deaths: YearlyEstateDeathRow[];
  ownerNames: { clientName: string; spouseName: string | null };
  compact: boolean;
}) {
  if (deaths.length === 0) return null;
  const nameCol = "25%";
  const numCol = `${75 / 8}%`;
  const headerStyle = compact ? s.innerCellHeaderCompact : s.innerCellHeader;

  return (
    <View style={s.drilldownWrap}>
      <Text
        style={compact ? [s.drilldownHeading, s.drilldownHeadingCompact] : s.drilldownHeading}
      >
        Tax detail by decedent
      </Text>
      <View style={s.innerHeaderRow}>
        <Text style={[headerStyle, s.alignLeft, { width: nameCol }]}>
          Decedent
        </Text>
        <Text style={[headerStyle, s.alignRight, { width: numCol }]}>
          Estate Value
        </Text>
        <Text style={[headerStyle, s.alignRight, { width: numCol }]}>
          Charitable Gifts
        </Text>
        <Text style={[headerStyle, s.alignRight, { width: numCol }]}>
          Taxable Estate
        </Text>
        <Text style={[headerStyle, s.alignRight, { width: numCol }]}>
          State Estate Tax
        </Text>
        <Text style={[headerStyle, s.alignRight, { width: numCol }]}>
          Probate & Expenses
        </Text>
        <Text style={[headerStyle, s.alignRight, { width: numCol }]}>
          Income Tax on IRD
        </Text>
        <Text style={[headerStyle, s.alignRight, { width: numCol }]}>
          Estate Tax Payable
        </Text>
        <Text style={[headerStyle, s.alignRight, { width: numCol }]}>
          Total Tax At Death
        </Text>
      </View>
      {deaths.map((d) => (
        <DeathSubRow
          key={`${d.deathOrder}-${d.deceased}`}
          death={d}
          ownerNames={ownerNames}
          compact={compact}
        />
      ))}
    </View>
  );
}

function ageLabelFor(row: YearlyEstateRow): string {
  if (row.ageClient != null && row.ageSpouse != null) {
    return `${row.ageClient}/${row.ageSpouse}`;
  }
  if (row.ageClient != null) return String(row.ageClient);
  if (row.ageSpouse != null) return String(row.ageSpouse);
  return "—";
}

/**
 * Pure inner renderer. Takes a `YearlyEstateReport` + `ownerNames` plus
 * presentation props and renders the per-plan block (optional plan header
 * + ordering line + table-with-drilldowns, or the empty-state message).
 *
 * Exported so unit tests can render the table body with canned
 * `YearlyEstateReport`-shaped fixtures without standing up a full
 * projection. Production code should call `EstateTransfersYearlyPdf` — it
 * owns the `buildYearlyEstateReport` call.
 */
export function EstateTransfersYearlyBlock({
  report,
  ownerNames,
  planLabel,
  multiPlan,
  dotColor,
  compact,
}: {
  report: YearlyEstateReport;
  ownerNames: { clientName: string; spouseName: string | null };
  planLabel: string | undefined;
  multiPlan: boolean;
  dotColor: string;
  compact: boolean;
}) {
  // Empty state
  if (report.rows.length === 0) {
    return (
      <View style={s.planBlock}>
        {multiPlan && (
          <View style={s.planHeader}>
            <View style={[s.dot, { backgroundColor: dotColor }]} />
            <Text style={s.planLabel}>{planLabel}</Text>
          </View>
        )}
        <Text style={s.emptyText}>No yearly estate data available.</Text>
      </View>
    );
  }

  const visibleCols = filterVisibleCols(ALL_OUTER_COLS, report);

  // Column widths: Year ~ 8%, Age ~ 8%, the remaining 84% split across
  // numeric columns.
  const yearW = "8%";
  const ageW = "8%";
  const numW =
    visibleCols.length > 0 ? `${84 / visibleCols.length}%` : "0%";

  const orderingLabel =
    report.ordering === "primaryFirst"
      ? `Hypothetical · ${ownerNames.clientName} dies first`
      : `Hypothetical · ${ownerNames.spouseName ?? "Spouse"} dies first`;

  const cellHeaderStyle = compact ? s.cellHeaderCompact : s.cellHeader;
  const cellStyle = compact ? s.cellCompact : s.cell;
  const cellTotalStyle = compact ? s.cellTotalCompact : s.cellTotal;

  return (
    <View style={s.planBlock}>
      {multiPlan && (
        <View style={s.planHeader}>
          <View style={[s.dot, { backgroundColor: dotColor }]} />
          <Text style={s.planLabel}>{planLabel}</Text>
        </View>
      )}

      <Text
        style={compact ? [s.orderingLabel, s.orderingLabelCompact] : s.orderingLabel}
      >
        {orderingLabel}
      </Text>

      {/* Outer header */}
      <View style={s.headerRow}>
        <Text
          style={[s.cellHeader, cellHeaderStyle, s.alignLeft, { width: yearW }]}
        >
          Year
        </Text>
        <Text
          style={[s.cellHeader, cellHeaderStyle, s.alignLeft, { width: ageW }]}
        >
          Age
        </Text>
        {visibleCols.map((c) => (
          <Text
            key={c.key}
            style={[s.cellHeader, cellHeaderStyle, s.alignRight, { width: numW }]}
          >
            {c.label}
          </Text>
        ))}
      </View>

      {/* Body rows + per-year drill-downs */}
      {report.rows.map((row) => (
        <View key={row.year}>
          <View style={s.bodyRow}>
            <Text
              style={[s.cell, cellStyle, s.alignLeft, { width: yearW }]}
            >
              {String(row.year)}
            </Text>
            <Text
              style={[s.cell, cellStyle, s.alignLeft, { width: ageW }]}
            >
              {ageLabelFor(row)}
            </Text>
            {visibleCols.map((c) => (
              <Text
                key={c.key}
                style={[s.cell, cellStyle, s.alignRight, { width: numW }]}
              >
                {fmt(row[c.key] as number)}
              </Text>
            ))}
          </View>
          {row.deaths.length > 0 && (
            <DeathDrilldown
              deaths={row.deaths}
              ownerNames={ownerNames}
              compact={compact}
            />
          )}
        </View>
      ))}

      {/* Total row */}
      <View style={s.totalRow}>
        <Text
          style={[s.cellTotal, cellTotalStyle, s.alignLeft, { width: yearW }]}
        >
          Total
        </Text>
        <Text
          style={[s.cellTotal, cellTotalStyle, s.alignLeft, { width: ageW }]}
        >
          {""}
        </Text>
        {visibleCols.map((c) => {
          const total = c.totalKey ? report.totals[c.totalKey] : undefined;
          return (
            <Text
              key={c.key}
              style={[
                s.cellTotal,
                cellTotalStyle,
                s.alignRight,
                { width: numW },
              ]}
            >
              {total === undefined ? "" : fmt(total)}
            </Text>
          );
        })}
      </View>
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
  const ownerDobs = deriveOwnerDobs(plan.tree);
  const report = buildYearlyEstateReport({
    projection: plan.result,
    clientData: plan.tree,
    ordering: "primaryFirst",
    ownerNames,
    ownerDobs,
  });
  const dotColor = seriesColor(index) ?? PDF_THEME.ink3;

  return (
    <EstateTransfersYearlyBlock
      report={report}
      ownerNames={ownerNames}
      planLabel={plan.label}
      multiPlan={multiPlan}
      dotColor={dotColor}
      compact={compact}
    />
  );
}

export function EstateTransfersYearlyPdf({
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
