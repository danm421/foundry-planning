import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame, PAGE_PAD_X, PAGE_WIDTH_LANDSCAPE } from "@/components/presentations/shared/page-frame";
import { SectionHead } from "@/components/presentations/shared/section-head";
import { Callout } from "@/components/presentations/shared/callout";
import { SplitBarPdf } from "@/components/presentations/shared/split-bar-pdf";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { exactCurrency, jointAge, percentLabel, signed } from "@/lib/presentations/format";
import { fmtUsd } from "@/lib/presentations/pages/tax-summary/aggregate";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type {
  LifetimeRow,
  RothConversionPageData,
  RothConversionYearRow,
  SavingsMix,
} from "@/lib/presentations/pages/roth-conversion/types";
import { scheduleSheets } from "@/lib/presentations/pages/roth-conversion/estimate-page-count";
import { ChartLegend } from "../retirement-comparison/chart-legend-pdf";
import { ConversionChartPdf, CONVERTED_FILL, TAX_FILL } from "./conversion-chart-pdf";
import { AdvantageChartPdf } from "./advantage-chart-pdf";

export const STRATEGY_SHEET_TITLE = "Roth Conversion Strategy";
export const DETAIL_SHEET_TITLE = "Roth Conversion — Year by Year";

const CONTENT_W = PAGE_WIDTH_LANDSCAPE - 2 * PAGE_PAD_X;
const GAP = 10;
const PANEL_PAD = 10;
// Sheet 1: strategy text left, conversion chart right.
const CHART_PANEL_W = 380;
// Sheet 2: table left, the right column carries chart + two small panels.
const SIDE_W = 286;

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: GAP },
  panel: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderRadius: 3, padding: PANEL_PAD },
  sidePanel: { paddingVertical: 7 },
  h4: { fontSize: 8, color: T.ink2, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 },
  strategyLine: { flexDirection: "row", marginBottom: 5 },
  bullet: { width: 9, fontSize: 10, color: T.ink2 },
  strategyText: { flex: 1, fontSize: 10, color: T.ink, lineHeight: 1.4 },
  kpis: { flexDirection: "row", gap: 8, marginTop: GAP, marginBottom: GAP },
  kpi: { flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderRadius: 3, padding: 7 },
  kpiLbl: { fontSize: 7, color: T.ink2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 },
  kpiVal: { fontSize: 16, fontWeight: 700, color: T.ink, marginTop: 4 },
  kpiNote: { fontSize: 7.5, color: T.ink3, marginTop: 2 },
  takeaway: { borderLeftWidth: 3, borderLeftColor: T.ink2 },
  takeawayText: { fontSize: 10, color: T.ink, lineHeight: 1.4, marginBottom: 3 },
  // Year-by-year table
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: T.hair2, paddingBottom: 3, alignItems: "flex-end" },
  // Cell widths include a left gutter, so a right-aligned heading that wraps
  // never runs into the column beside it.
  thCell: { fontSize: 6.5, color: T.ink3, fontWeight: 700, textTransform: "uppercase", textAlign: "right", paddingLeft: 6 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: T.hair, alignItems: "center", paddingVertical: 3 },
  td: { fontSize: 8.5, color: T.ink, textAlign: "right", paddingLeft: 6 },
  continued: { fontSize: 7, color: T.ink3, marginTop: 4, textAlign: "right" },
  tdMark: { width: 16, fontSize: 7, color: T.ink2, paddingLeft: 6 },
  markKey: { fontSize: 7, color: T.ink2, marginTop: 4 },
  total: { flexDirection: "row", borderTopWidth: 1, borderTopColor: T.hair2, paddingTop: 3, marginTop: 1 },
  // Side-by-side table
  cmpHead: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: T.hair2, paddingBottom: 2 },
  cmpHeadLbl: { flex: 1, fontSize: 6.5, color: T.ink3, fontWeight: 700, textTransform: "uppercase" },
  cmpHeadCell: { width: 46, fontSize: 6.5, color: T.ink3, fontWeight: 700, textTransform: "uppercase", textAlign: "right" },
  cmpRow: { flexDirection: "row", alignItems: "center", paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: T.hair },
  cmpLbl: { flex: 1, fontSize: 8, color: T.ink },
  cmpCell: { width: 46, fontSize: 8.5, color: T.ink, textAlign: "right" },
  // Savings mix
  mixRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  mixLbl: { width: 74, fontSize: 7, color: T.ink2, fontWeight: 700 },
  mixTrack: { flex: 1, height: 10, backgroundColor: T.hair },
  footnote: { fontSize: 6.5, color: T.ink3, lineHeight: 1.35, marginTop: 1.5 },
  empty: { fontSize: 11, color: T.ink2, textAlign: "center", marginTop: 60 },
});

const MIX_SEGMENTS: Array<{ key: keyof Omit<SavingsMix, "total">; label: string; color: string }> = [
  { key: "roth", label: "Roth", color: CONVERTED_FILL },
  { key: "preTax", label: "Pre-tax", color: TAX_FILL },
  { key: "taxable", label: "Taxable & cash", color: T.ink3 },
];

/** Green when the change is good for the client, red when it is not. The sign
 *  and the column heading say the same thing in words. */
function changeColor(row: LifetimeRow): string {
  const delta = row.with - row.without;
  if (Math.abs(delta) < 0.5) return T.ink;
  const better = row.betterIsLower ? delta < 0 : delta > 0;
  return better ? T.good : T.crit;
}

interface Kpi {
  label: string;
  value: string;
  note: string;
  color?: string;
}

function strategyKpis(data: RothConversionPageData): Kpi[] {
  const t = data.totals!;
  const first = data.schedule[0].year;
  const last = data.schedule[data.schedule.length - 1].year;
  const years = first === last ? `${first}` : `${first}–${last} · ${data.schedule.length} years`;
  const be = data.breakeven!;
  return [
    { label: "Total converted", value: fmtUsd(t.converted), note: years },
    { label: "Tax cost of converting", value: fmtUsd(t.extraTax), note: "paid in the conversion years" },
    t.laterTaxSaved >= 0
      ? { label: "Tax saved afterward", value: fmtUsd(t.laterTaxSaved), note: "over the rest of the plan", color: T.good }
      : { label: "Extra tax afterward", value: fmtUsd(-t.laterTaxSaved), note: "over the rest of the plan", color: T.crit },
    {
      label: "Heirs receive",
      value: signed(t.heirsChange, fmtUsd),
      note: "after tax, at the end of the plan",
      color: t.heirsChange > 0 ? T.good : t.heirsChange < 0 ? T.crit : undefined,
    },
    be.kind === "year"
      ? { label: "Break-even", value: String(be.year), note: "family ahead from then on" }
      : be.kind === "immediate"
        ? { label: "Break-even", value: "Right away", note: "ahead from the first conversion" }
        : { label: "Break-even", value: "Not reached", note: "within this plan" },
  ];
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  return (
    <View style={s.kpi}>
      <Text style={s.kpiLbl}>{kpi.label}</Text>
      <Text style={[s.kpiVal, kpi.color ? { color: kpi.color } : {}]}>{kpi.value}</Text>
      <Text style={s.kpiNote}>{kpi.note}</Text>
    </View>
  );
}

// ── Year-by-year table ──────────────────────────────────────────────────────

interface Column {
  key: string;
  label: string;
  width: number;
  cell: (r: RothConversionYearRow) => string;
  total?: (rows: RothConversionYearRow[]) => string;
}

const sumOf = (rows: RothConversionYearRow[], pick: (r: RothConversionYearRow) => number) =>
  rows.reduce((acc, r) => acc + pick(r), 0);

function scheduleColumns(data: RothConversionPageData): Column[] {
  const hasSpouse = data.schedule.some((r) => r.spouseAge != null);
  const cols: Column[] = [
    { key: "year", label: "Year", width: 30, cell: (r) => String(r.year) },
    { key: "age", label: hasSpouse ? "Ages" : "Age", width: 38, cell: (r) => jointAge(r.clientAge, r.spouseAge) },
    {
      key: "converted",
      label: "Converted",
      width: 56,
      cell: (r) => exactCurrency(r.converted),
      total: (rows) => exactCurrency(sumOf(rows, (r) => r.converted)),
    },
  ];
  if (data.showTaxable) {
    cols.push({
      key: "taxable",
      label: "Taxable part",
      width: 56,
      cell: (r) => exactCurrency(r.taxable),
      total: (rows) => exactCurrency(sumOf(rows, (r) => r.taxable)),
    });
  }
  cols.push({
    key: "tax",
    label: "Extra tax",
    width: 52,
    cell: (r) => exactCurrency(r.extraTax),
    total: (rows) => exactCurrency(sumOf(rows, (r) => r.extraTax)),
  });
  if (data.showBracket) {
    cols.push({
      key: "bracket",
      label: "Top bracket",
      width: 44,
      cell: (r) => (r.bracket === "amt" ? "AMT" : r.bracket == null ? "—" : percentLabel(r.bracket)),
    });
  }
  // A household with no one on Medicare in any year two after a conversion
  // would print a column of dashes; leave it out instead.
  if (data.schedule.some((r) => r.extraMedicare != null)) {
    cols.push({
      key: "medicare",
      label: "Medicare surcharge 2 yrs later",
      width: 68,
      cell: (r) =>
        r.extraMedicare == null ? "—" : Math.abs(r.extraMedicare) < 0.5 ? "None" : signed(r.extraMedicare, exactCurrency),
      total: (rows) =>
        signed(sumOf(rows.filter((r) => r.extraMedicare != null), (r) => r.extraMedicare!), exactCurrency),
    });
  }
  return cols;
}

/** One sheet's slice of the schedule. The total — of EVERY year, not the
 *  slice — closes the last slice; earlier slices point to the next sheet. */
function ScheduleTable({
  data,
  rows,
  isLast,
}: {
  data: RothConversionPageData;
  rows: RothConversionYearRow[];
  isLast: boolean;
}) {
  const cols = scheduleColumns(data);
  // A note is a short marker in its own column, keyed under the table: written
  // out in the row it had ~30pt once every column shows, and wrapped to four
  // lines. Lettered over EVERY year, so a continued table keeps its letters.
  const marks = noteMarks(data.schedule);
  const keyed = [...new Set(rows.map((r) => r.note).filter((n): n is string => !!n))];
  return (
    <View>
      <View style={s.th}>
        {cols.map((c) => (
          <Text key={c.key} style={[s.thCell, { width: c.width }]}>
            {c.label}
          </Text>
        ))}
        {marks.size > 0 ? <Text style={s.tdMark}> </Text> : null}
      </View>
      {rows.map((r) => (
        <View key={r.year} style={s.tr}>
          {cols.map((c) => (
            <Text key={c.key} style={[s.td, { width: c.width }]}>
              {c.cell(r)}
            </Text>
          ))}
          {marks.size > 0 ? <Text style={s.tdMark}>{r.note ? marks.get(r.note) : ""}</Text> : null}
        </View>
      ))}
      {isLast ? (
        <View style={s.total}>
          {cols.map((c, i) => (
            <Text key={c.key} style={[s.td, { width: c.width, fontWeight: 700 }]}>
              {i === 0 ? "Total" : c.total ? c.total(data.schedule) : ""}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={s.continued}>Continued on the next page.</Text>
      )}
      {keyed.length > 0 ? (
        <Text style={s.markKey}>{keyed.map((n) => `${marks.get(n)}  ${n}`).join("     ")}</Text>
      ) : null}
    </View>
  );
}

function noteMarks(rows: RothConversionYearRow[]): Map<string, string> {
  const marks = new Map<string, string>();
  for (const r of rows) {
    if (r.note && !marks.has(r.note)) marks.set(r.note, String.fromCharCode(97 + marks.size));
  }
  return marks;
}

// ── Side panels ─────────────────────────────────────────────────────────────

function SideBySide({ rows }: { rows: LifetimeRow[] }) {
  return (
    <View>
      <View style={s.cmpHead}>
        <Text style={s.cmpHeadLbl}> </Text>
        <Text style={s.cmpHeadCell}>Without</Text>
        <Text style={s.cmpHeadCell}>With</Text>
        <Text style={s.cmpHeadCell}>Change</Text>
      </View>
      {rows.map((row) => (
        <View key={row.label} style={s.cmpRow}>
          <Text style={s.cmpLbl}>{row.label}</Text>
          <Text style={[s.cmpCell, { color: T.ink2 }]}>{fmtUsd(row.without)}</Text>
          <Text style={[s.cmpCell, { fontWeight: 700 }]}>{fmtUsd(row.with)}</Text>
          <Text style={[s.cmpCell, { fontWeight: 700, color: changeColor(row) }]}>
            {signed(row.with - row.without, fmtUsd)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function SavingsMixPanel({ mix }: { mix: NonNullable<RothConversionPageData["mix"]> }) {
  return (
    <View>
      <View style={s.mixRow}>
        <Text style={s.mixLbl}>{`Without · ${fmtUsd(mix.without.total)}`}</Text>
        <SplitBarPdf parts={mix.without} segments={MIX_SEGMENTS} style={s.mixTrack} />
      </View>
      <View style={s.mixRow}>
        <Text style={s.mixLbl}>{`With · ${fmtUsd(mix.with.total)}`}</Text>
        <SplitBarPdf parts={mix.with} segments={MIX_SEGMENTS} style={s.mixTrack} />
      </View>
      <ChartLegend
        items={MIX_SEGMENTS.map((seg) => ({
          label: `${seg.label} ${fmtUsd(mix.without[seg.key])} → ${fmtUsd(mix.with[seg.key])}`,
          color: seg.color,
        }))}
      />
    </View>
  );
}

// ── The page ────────────────────────────────────────────────────────────────

export function RothConversionPagePdf(input: RenderPdfInput<RothConversionPageData>) {
  const { data, firmName, clientName, reportDate, pageIndex, totalPages, accent } = input;
  const frame = { firmName, clientName, reportDate, pageIndex, totalPages, orientation: "landscape" as const };

  if (data.emptyMessage || !data.totals || !data.breakeven) {
    return (
      <PageFrame {...frame}>
        <SectionHead title={STRATEGY_SHEET_TITLE} subtitle={data.planLabel || undefined} accent={accent} />
        <Text style={s.empty}>{data.emptyMessage ?? ""}</Text>
      </PageFrame>
    );
  }

  const tableSheets = scheduleSheets(data.schedule);
  const chartW = CHART_PANEL_W - 2 * PANEL_PAD - 2;
  const sideInnerW = SIDE_W - 2 * PANEL_PAD - 2;
  return (
    <>
      <PageFrame {...frame}>
        <SectionHead title={STRATEGY_SHEET_TITLE} subtitle={data.planLabel} accent={accent} />
        <Callout accent={accent}>{data.comparisonNote}</Callout>

        <View style={s.row}>
          <View style={[s.panel, { flex: 1 }]}>
            <Text style={s.h4}>The strategy</Text>
            {data.strategy.map((line, i) => (
              <View key={i} style={s.strategyLine}>
                <Text style={s.bullet}>•</Text>
                <Text style={s.strategyText}>{line}</Text>
              </View>
            ))}
          </View>
          <View style={[s.panel, { width: CHART_PANEL_W }]}>
            <Text style={s.h4}>When the conversions happen</Text>
            <ConversionChartPdf rows={data.schedule} width={chartW} height={150} />
          </View>
        </View>

        <View style={s.kpis}>
          {strategyKpis(data).map((kpi) => (
            <KpiCard key={kpi.label} kpi={kpi} />
          ))}
        </View>

        <View style={[s.panel, s.takeaway]}>
          <Text style={s.h4}>What it means</Text>
          {data.takeaway.map((line, i) => (
            <Text key={i} style={s.takeawayText}>
              {line}
            </Text>
          ))}
        </View>
      </PageFrame>

      <PageFrame {...frame}>
        <SectionHead title={DETAIL_SHEET_TITLE} subtitle={data.planLabel} accent={accent} />
        <Callout accent={accent}>{data.comparisonNote}</Callout>

        <View style={s.row}>
          <View style={[s.panel, { width: CONTENT_W - SIDE_W - GAP }]}>
            <Text style={s.h4}>Each conversion year</Text>
            <ScheduleTable data={data} rows={tableSheets[0]} isLast={tableSheets.length === 1} />
          </View>

          <View style={{ width: SIDE_W, gap: 6 }}>
            {data.advantage.length >= 2 ? (
              <View style={[s.panel, s.sidePanel]}>
                <Text style={s.h4}>What your heirs would receive, with vs. without</Text>
                <AdvantageChartPdf points={data.advantage} breakeven={data.breakeven} width={sideInnerW} height={84} />
              </View>
            ) : null}
            <View style={[s.panel, s.sidePanel]}>
              <Text style={s.h4}>Side by side</Text>
              <SideBySide rows={data.lifetime} />
            </View>
            {data.mix ? (
              <View style={[s.panel, s.sidePanel]}>
                <Text style={s.h4}>{`Savings at the end of the plan (${data.mix.year})`}</Text>
                <SavingsMixPanel mix={data.mix} />
              </View>
            ) : null}
          </View>
        </View>

        <View style={{ marginTop: 8 }}>
          {data.footnotes.map((note, i) => (
            <Text key={i} style={s.footnote}>
              {note}
            </Text>
          ))}
        </View>
      </PageFrame>

      {tableSheets.slice(1).map((rows, i) => (
        <PageFrame key={rows[0].year} {...frame}>
          <SectionHead title={DETAIL_SHEET_TITLE} subtitle={`${data.planLabel} · continued`} accent={accent} />
          <View style={[s.panel, { width: CONTENT_W - SIDE_W - GAP }]}>
            <Text style={s.h4}>Each conversion year, continued</Text>
            <ScheduleTable data={data} rows={rows} isLast={i === tableSheets.length - 2} />
          </View>
        </PageFrame>
      ))}
    </>
  );
}
