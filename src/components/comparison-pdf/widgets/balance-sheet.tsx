// src/components/comparison-pdf/widgets/balance-sheet.tsx
//
// PDF renderer for the "balance-sheet" comparison widget.
//
// Layout: one block per plan, stacked vertically. Each block contains an
// Assets matrix (one row per account, one column per owner with a Total
// column), an optional Liabilities matrix (only when liabilities exist), and
// a Net Worth box.
//
// NOTE: The plan text for task 4.6 lists category-grouped rows (Taxable,
// Cash, Retirement, Real estate, Business, Life insurance). That is NOT what
// the screen widget does. The on-screen Balance Sheet section shows an
// owner-column matrix — one row per account, columns for each owner (client,
// spouse, Joint/ROS, other family members, entities), with a Total column on
// the right. We mirror the screen widget exactly here (same precedent as
// task 4.5 reducing roth-ladder's columns to match available data).
//
// The shared layout helpers (distribute / buildColumns / isHouseholdPrincipalSplit
// / fmt + ColumnKey / ColumnSpec / MatrixRow / JOINT_COL) live in
// @/lib/comparison/widgets/balance-sheet-shared and are reused by the screen
// widget at src/components/comparison/balance-sheet-comparison-section.tsx
// (matches the kpi-metric.ts precedent from Task 3.2).
//
// compact mode is engaged when span ≤ 3 (slightly smaller font + padding).

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "@/components/pdf/theme";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { McSharedResult } from "@/lib/comparison/widgets/types";
import type { CellSpan, YearRange } from "@/lib/comparison/layout-schema";
import type { BrandingResolved } from "@/lib/comparison-pdf/branding";
import type { Account, EntitySummary, FamilyMember, Liability } from "@/engine/types";
import { seriesColor } from "@/lib/comparison/series-palette";
import {
  buildColumns,
  distribute,
  fmt,
  type ColumnSpec,
  type ColumnKey,
  type MatrixRow,
} from "@/lib/comparison/widgets/balance-sheet-shared";

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
    marginBottom: 4,
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
  sectionHeading: {
    fontFamily: "Inter",
    fontSize: 8,
    fontWeight: 700,
    color: PDF_THEME.ink3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 3,
  },
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
  nameCellHeader: {
    fontFamily: "Inter",
    fontSize: 7,
    fontWeight: 600,
    color: PDF_THEME.ink3,
    textAlign: "left",
  },
  valueCellHeader: {
    fontFamily: "Inter",
    fontSize: 7,
    fontWeight: 500,
    color: PDF_THEME.ink3,
    textAlign: "right",
  },
  nameCell: {
    fontFamily: "Inter",
    fontSize: 8,
    color: PDF_THEME.ink,
    textAlign: "left",
  },
  valueCell: {
    fontFamily: "Inter",
    fontSize: 8,
    color: PDF_THEME.ink,
    textAlign: "right",
  },
  nameCellTotal: {
    fontFamily: "Inter",
    fontSize: 8,
    fontWeight: 700,
    color: PDF_THEME.ink,
    textAlign: "left",
  },
  valueCellTotal: {
    fontFamily: "Inter",
    fontSize: 8,
    fontWeight: 700,
    color: PDF_THEME.ink,
    textAlign: "right",
  },
  matrixWrap: {
    marginBottom: 8,
  },
  netWorthBox: {
    borderWidth: 0.5,
    borderColor: PDF_THEME.hair,
    paddingVertical: 4,
    paddingHorizontal: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  netWorthLabel: {
    fontFamily: "Inter",
    fontSize: 9,
    fontWeight: 700,
    color: PDF_THEME.ink,
  },
  netWorthValue: {
    fontFamily: "Inter",
    fontSize: 9,
    fontWeight: 700,
    color: PDF_THEME.ink,
  },
  // Compact variants
  sectionHeadingCompact: { fontSize: 7, marginBottom: 2 },
  nameCellHeaderCompact: { fontSize: 6 },
  valueCellHeaderCompact: { fontSize: 6 },
  nameCellCompact: { fontSize: 7 },
  valueCellCompact: { fontSize: 7 },
  nameCellTotalCompact: { fontSize: 7 },
  valueCellTotalCompact: { fontSize: 7 },
  netWorthLabelCompact: { fontSize: 8 },
  netWorthValueCompact: { fontSize: 8 },
});

interface Props {
  config: unknown;
  plans: ComparisonPlan[];
  mc: McSharedResult | null;
  yearRange: YearRange | null;
  span: CellSpan;
  branding: BrandingResolved;
}

function OwnerMatrix({
  heading,
  rows,
  columns,
  totalsLabel,
  compact,
}: {
  heading: string;
  rows: MatrixRow[];
  columns: ColumnSpec[];
  totalsLabel: string;
  compact: boolean;
}) {
  const colTotals: Record<ColumnKey, number> = {};
  let grandTotal = 0;
  for (const r of rows) {
    grandTotal += r.value;
    for (const c of columns) {
      colTotals[c.key] = (colTotals[c.key] ?? 0) + (r.dist[c.key] ?? 0);
    }
  }

  // Compute column widths: first column (account name) gets 30%, the rest
  // (owner columns + Total) split the remaining 70%.
  const valueColCount = columns.length + 1; // owner cols + Total
  const valueColWidth = valueColCount > 0 ? `${70 / valueColCount}%` : "0%";
  const nameColWidth = "30%";

  return (
    <View style={s.matrixWrap}>
      <Text style={[s.sectionHeading, ...(compact ? [s.sectionHeadingCompact] : [])]}>
        {heading}
      </Text>
      <View style={s.headerRow}>
        <Text
          style={[
            s.nameCellHeader,
            ...(compact ? [s.nameCellHeaderCompact] : []),
            { width: nameColWidth },
          ]}
        >
          {heading}
        </Text>
        {columns.map((c) => (
          <Text
            key={c.key}
            style={[
              s.valueCellHeader,
              ...(compact ? [s.valueCellHeaderCompact] : []),
              { width: valueColWidth },
            ]}
          >
            {c.label}
          </Text>
        ))}
        <Text
          style={[
            s.valueCellHeader,
            ...(compact ? [s.valueCellHeaderCompact] : []),
            { width: valueColWidth },
          ]}
        >
          Total
        </Text>
      </View>
      {rows.map((r) => (
        <View key={r.id} style={s.bodyRow}>
          <Text
            style={[
              s.nameCell,
              ...(compact ? [s.nameCellCompact] : []),
              { width: nameColWidth },
            ]}
          >
            {r.name}
          </Text>
          {columns.map((c) => (
            <Text
              key={c.key}
              style={[
                s.valueCell,
                ...(compact ? [s.valueCellCompact] : []),
                { width: valueColWidth },
              ]}
            >
              {fmt(r.dist[c.key] ?? 0)}
            </Text>
          ))}
          <Text
            style={[
              s.valueCell,
              ...(compact ? [s.valueCellCompact] : []),
              { width: valueColWidth },
            ]}
          >
            {fmt(r.value)}
          </Text>
        </View>
      ))}
      <View style={s.totalRow}>
        <Text
          style={[
            s.nameCellTotal,
            ...(compact ? [s.nameCellTotalCompact] : []),
            { width: nameColWidth },
          ]}
        >
          {totalsLabel}
        </Text>
        {columns.map((c) => (
          <Text
            key={c.key}
            style={[
              s.valueCellTotal,
              ...(compact ? [s.valueCellTotalCompact] : []),
              { width: valueColWidth },
            ]}
          >
            {fmt(colTotals[c.key] ?? 0)}
          </Text>
        ))}
        <Text
          style={[
            s.valueCellTotal,
            ...(compact ? [s.valueCellTotalCompact] : []),
            { width: valueColWidth },
          ]}
        >
          {fmt(grandTotal)}
        </Text>
      </View>
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
  const accounts = (plan.tree.accounts ?? []) as Account[];
  const liabilities = (plan.tree.liabilities ?? []) as Liability[];
  const entities = (plan.tree.entities ?? []) as EntitySummary[];
  const familyMembers = (plan.tree.familyMembers ?? []) as FamilyMember[];
  const familyById = new Map<string, FamilyMember>(familyMembers.map((fm) => [fm.id, fm]));

  const assetRows: MatrixRow[] = accounts.map((a) => {
    const value = Number(a.value) || 0;
    return {
      id: a.id,
      name: a.name,
      value,
      dist: distribute(value, a.owners, familyById),
    };
  });
  const liabilityRows: MatrixRow[] = liabilities.map((l) => {
    const value = Number(l.balance) || 0;
    return {
      id: l.id,
      name: l.name,
      value,
      dist: distribute(value, l.owners, familyById),
    };
  });

  // Compute a unified column set across assets+liabilities so the two tables
  // stack with the same headers.
  const columns = buildColumns(
    [...assetRows, ...liabilityRows].map((r) => r.dist),
    familyMembers,
    entities,
  );

  const totalAssets = assetRows.reduce((sum, r) => sum + r.value, 0);
  const totalLiabs = liabilityRows.reduce((sum, r) => sum + r.value, 0);
  const netWorth = totalAssets - totalLiabs;
  const dotColor = seriesColor(index) ?? PDF_THEME.ink3;

  return (
    <View style={s.planBlock}>
      {multiPlan && (
        <View style={s.planHeader}>
          <View style={[s.dot, { backgroundColor: dotColor }]} />
          <Text style={s.planLabel}>{plan.label}</Text>
        </View>
      )}
      {assetRows.length > 0 && (
        <OwnerMatrix
          heading="Assets"
          rows={assetRows}
          columns={columns}
          totalsLabel="Total Assets"
          compact={compact}
        />
      )}
      {liabilityRows.length > 0 && (
        <OwnerMatrix
          heading="Liabilities"
          rows={liabilityRows}
          columns={columns}
          totalsLabel="Total Liabilities"
          compact={compact}
        />
      )}
      <View style={s.netWorthBox}>
        <Text style={compact ? [s.netWorthLabel, s.netWorthLabelCompact] : s.netWorthLabel}>
          Net Worth
        </Text>
        <Text style={compact ? [s.netWorthValue, s.netWorthValueCompact] : s.netWorthValue}>
          {fmt(netWorth)}
        </Text>
      </View>
    </View>
  );
}

export function BalanceSheetPdf({ plans, span }: Props) {
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
