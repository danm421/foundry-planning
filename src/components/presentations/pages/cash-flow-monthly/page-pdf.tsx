// Monthly Cash Flow sheet. Summary card → chart → one of the two tables →
// the standing notes. The card is deliberately first: "you have this much a
// month to live on" is the sentence the advisor reads out loud, and everything
// below it is the working.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T, type SectionAccent } from "@/lib/presentations/theme";
import { exactCurrency, compactCurrency, jointAge } from "@/lib/presentations/format";
import { DEPLETED_GLYPH } from "@/lib/presentations/pages/cash-flow-monthly/view-model";
import type {
  MonthlyCashFlowPageData,
  MonthlyMonthRow,
  MonthlyPlanRow,
  MonthlySummary,
} from "@/lib/presentations/pages/cash-flow-monthly/types";
import { PageFrame } from "../../shared/page-frame";
import { SectionHead } from "../../shared/section-head";
import { CashflowChartPdf } from "../cash-flow/chart-pdf";

const s = StyleSheet.create({
  card: {
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.hair2,
    borderRadius: 3,
    padding: 8,
    marginBottom: 8,
  },
  cardHead: { flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: 4 },
  cardYear: { fontSize: 11, fontWeight: 700, color: T.ink },
  cardAges: { fontSize: 8, color: T.ink3 },
  cardCols: { flexDirection: "row", gap: 14 },
  cardCol: { flex: 1 },
  hero: { fontSize: 22, fontWeight: 700, color: T.ink },
  heroLbl: {
    fontSize: 6.5,
    fontWeight: 700,
    color: T.ink2,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  h4: {
    fontSize: 6.5,
    fontWeight: 700,
    color: T.ink2,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 3,
  },
  line: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 1.5,
    borderBottomWidth: 0.5,
    borderBottomColor: T.hair,
  },
  lineLbl: { fontSize: 8, color: T.ink2 },
  lineVal: { fontSize: 8, fontWeight: 600, color: T.ink },
  lineValNeg: { fontSize: 8, fontWeight: 600, color: T.crit },
  banner: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: T.crit,
    borderRadius: 2,
    paddingVertical: 3,
    paddingHorizontal: 5,
    fontSize: 7.5,
    color: T.crit,
  },
  table: { marginTop: 10 },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderTopWidth: 1,
    borderTopColor: T.hair2,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderLeftColor: T.hair2,
    borderRightColor: T.hair2,
    borderBottomWidth: 1,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  dataRow: {
    flexDirection: "row",
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderLeftColor: T.hair2,
    borderRightColor: T.hair2,
    borderBottomWidth: 0.5,
    borderBottomColor: T.hair2,
    paddingVertical: 3,
    paddingHorizontal: 2,
  },
  th: { fontFamily: "Inter", fontSize: 6.5, fontWeight: 600, color: T.ink, paddingHorizontal: 1 },
  td: { fontFamily: "Inter", fontSize: 6.5, color: T.ink2, paddingHorizontal: 1 },
  tdStrong: { fontFamily: "Inter", fontSize: 6.5, fontWeight: 600, color: T.ink, paddingHorizontal: 1 },
  tdNeg: { color: T.crit, fontWeight: 600 },
  right: { textAlign: "right" },
  left: { textAlign: "left" },
  note: { marginTop: 6, fontSize: 7, color: T.ink3, lineHeight: 1.35 },
  footnote: { marginTop: 10, fontFamily: "Inter", fontSize: 7, color: T.ink3 },
  empty: { fontSize: 11, color: T.ink2, textAlign: "center", marginTop: 60 },
});

const ZEBRA = "#faf6ea";
const LABEL_W = 46;
const flexCell = { flex: 1 } as const;

export function MonthlyCashFlowPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  accent,
}: {
  data: MonthlyCashFlowPageData;
  firmName: string;
  clientName: string;
  reportDate: string;
  pageIndex: number;
  totalPages: number;
  accent: SectionAccent;
}) {
  const empty = data.planRows.length === 0 && data.monthRows.length === 0;

  return (
    <PageFrame
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
    >
      <SectionHead title={data.title} subtitle={data.subtitle} accent={accent} />
      {empty ? (
        <Text style={s.empty}>No projection years to show.</Text>
      ) : (
        <>
          {data.summary && <SummaryCard summary={data.summary} />}
          {data.chartSpec && <CashflowChartPdf spec={data.chartSpec} />}
          {data.view === "plan" ? (
            <PlanTable rows={data.planRows} accent={accent} />
          ) : (
            <MonthTable rows={data.monthRows} accent={accent} />
          )}
          {data.notes.map((n, i) => (
            <Text key={i} style={s.note}>
              {n}
            </Text>
          ))}
        </>
      )}
      <Text style={s.footnote}>{data.footnote}</Text>
    </PageFrame>
  );
}

function SummaryCard({ summary: m }: { summary: MonthlySummary }) {
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={s.cardYear}>{String(m.year)}</Text>
        <Text style={s.cardAges}>{m.ageLabel}</Text>
      </View>

      <Text style={s.heroLbl}>Available each month</Text>
      <Text style={s.hero}>{exactCurrency(m.available)}</Text>

      <View style={[s.cardCols, { marginTop: 6 }]}>
        <View style={s.cardCol}>
          <Text style={s.h4}>How it gets there</Text>
          <Line label="Income" value={m.income} />
          <Line label="Fixed costs" value={m.fixedTotal} />
          <Line label="Left after fixed costs" value={m.leftAfterFixed} signed />
          <Line label="Portfolio draw" value={m.portfolioDraw} />
        </View>
        <View style={s.cardCol}>
          <Text style={s.h4}>Where it goes</Text>
          <Line label="Living expenses" value={m.living} />
          <Line label="Surplus spent" value={m.surplusSpent} />
          <Line label="Surplus unspent" value={m.surplusUnspent} />
          {/* Only when the parts genuinely failed to account for something —
              never folded into a named line above. */}
          {m.unexplained !== 0 && <Line label="Unaccounted for" value={m.unexplained} signed />}
        </View>
      </View>

      {m.depleted && (
        <Text style={s.banner}>
          {`${DEPLETED_GLYPH} The accounts are exhausted in ${m.year}. The plan keeps spending against an overdrawn account, so this figure is money that does not exist.`}
        </Text>
      )}
    </View>
  );
}

function Line({ label, value, signed }: { label: string; value: number; signed?: boolean }) {
  return (
    <View style={s.line}>
      <Text style={s.lineLbl}>{label}</Text>
      <Text style={signed && value < 0 ? s.lineValNeg : s.lineVal}>{exactCurrency(value)}</Text>
    </View>
  );
}

// ── Tables ───────────────────────────────────────────────────────────────────

function HeaderRow({
  labels,
  accent,
  leftAligned = 1,
}: {
  labels: string[];
  accent: SectionAccent;
  /** How many leading columns are text rather than money. */
  leftAligned?: number;
}) {
  return (
    <View
      style={[s.headerRow, { backgroundColor: accent.tint, borderBottomColor: accent.accent }]}
      fixed
    >
      {labels.map((l, i) => (
        <Text
          key={l}
          style={[s.th, i === 0 ? { width: LABEL_W } : flexCell, i < leftAligned ? s.left : s.right]}
        >
          {l}
        </Text>
      ))}
    </View>
  );
}

function PlanTable({ rows, accent }: { rows: MonthlyPlanRow[]; accent: SectionAccent }) {
  return (
    <View style={s.table}>
      <HeaderRow
        // "Portfolio draw" sits WITH Income, ahead of the costs, because it is
        // money in. Among the cost columns it would read as a fifth cost and
        // the row would not add up; in this order it does.
        labels={["Year", "Age(s)", "Income", "Portfolio\ndraw", "Taxes", "Debt", "Savings", "Other", "Available"]}
        leftAligned={2}
        accent={accent}
      />
      {rows.map((r, i) => (
        <View key={r.year} style={[s.dataRow, i % 2 === 1 ? { backgroundColor: ZEBRA } : {}]} wrap={false}>
          <Text style={[s.td, { width: LABEL_W }, s.left]}>
            {/* Shape, not colour: the flag has to survive a greyscale print. */}
            {r.depleted ? `${r.year} ${DEPLETED_GLYPH}` : String(r.year)}
          </Text>
          <Text style={[s.td, flexCell, s.left]}>{jointAge(r.ageClient, r.ageSpouse)}</Text>
          <Cell v={r.income} />
          <Cell v={r.portfolioDraw} />
          <Cell v={r.taxes} />
          <Cell v={r.debt} />
          <Cell v={r.savings} />
          <Cell v={r.other} />
          <Cell v={r.available} strong />
        </View>
      ))}
    </View>
  );
}

function MonthTable({ rows, accent }: { rows: MonthlyMonthRow[]; accent: SectionAccent }) {
  return (
    <View style={s.table}>
      <HeaderRow
        labels={["Month", "Income", "Portfolio\ndraw", "Taxes", "Debt", "Savings", "Other", "Living", "Net", "Cash on\nhand"]}
        accent={accent}
      />
      {rows.map((m, i) => (
        <View key={m.label} style={[s.dataRow, i % 2 === 1 ? { backgroundColor: ZEBRA } : {}]} wrap={false}>
          <Text style={[s.td, { width: LABEL_W }, s.left]}>{m.label}</Text>
          <Cell v={m.income} />
          <Cell v={m.portfolioDraw} />
          <Cell v={m.taxes} />
          {/* Printed exactly as the allocator returned it. A mid-year-originated
              entity-owned loan really does produce negative debt months, and
              clamping one to zero would turn a row that reconciles into one that
              silently does not. */}
          <Cell v={m.debt} />
          <Cell v={m.savings} />
          <Cell v={m.other} />
          <Cell v={m.living} />
          <Cell v={m.net} signed />
          <Cell v={m.cashOnHand} strong signed />
        </View>
      ))}
    </View>
  );
}

function Cell({ v, strong, signed }: { v: number; strong?: boolean; signed?: boolean }) {
  return (
    <Text
      style={[
        strong ? s.tdStrong : s.td,
        flexCell,
        s.right,
        ...(signed && v < 0 ? [s.tdNeg] : []),
      ]}
    >
      {compactCurrency(v)}
    </Text>
  );
}
