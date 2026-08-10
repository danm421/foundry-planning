// src/components/tax-analysis-pdf/tax-analysis-pdf-document.tsx
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { TaxAnalysis } from "@/lib/tax-analysis/analysis";
import type { Finding } from "@/lib/tax-analysis/types";
import { computeBracketBarLayout } from "@/lib/tax-analysis/bracket-map";
import { fmtUsd, fmtPct } from "@/lib/tax-analysis/format";
import {
  deductionDetailRows, hasGrossColumn, incomeCompositionHeaders, incomeCompositionTotal, keyFigureTiles,
} from "@/lib/tax-analysis/breakdowns";
import { activityDetailRows } from "@/lib/tax-analysis/activity-detail";
import { reconstructionNote } from "@/lib/tax-analysis/reconstruction";
import { PDF_THEME } from "@/components/balance-sheet-report/tokens";
import { SEVERITY_GROUPS, CATEGORY_LABEL, FINDING_PARTS, sortFindings } from "@/lib/tax-analysis/findings/order";
import { formatLineRefs } from "@/lib/tax-analysis/findings/line-refs";

export interface TaxAnalysisPdfProps {
  clientName: string;
  taxYear: number;
  generatedAt: string;
  analysis: TaxAnalysis;
  firmName?: string | null;
  logoDataUrl?: string | null; // from resolveBranding — base64 data URL or null
}

// Muted-slate fill for "amount filled" bars — deliberately not the Foundry
// verdigris accent. Client PDFs use the report's own light/print theme
// (see PDF_THEME), never Foundry's product-chrome brand color.
const BAR_FILL = PDF_THEME.text.secondary;
const BAR_FLOOR = PDF_THEME.text.muted;

const styles = StyleSheet.create({
  page: { backgroundColor: PDF_THEME.surface.page, padding: 32, color: PDF_THEME.text.primary, fontFamily: "Helvetica", fontSize: 10 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1, borderBottomColor: PDF_THEME.surface.divider, paddingBottom: 10, marginBottom: 16 },
  title: { fontSize: 18, fontWeight: "bold" },
  subtitle: { color: PDF_THEME.text.muted, fontSize: 10, marginTop: 2 },
  logo: { height: 28, objectFit: "contain" },
  figuresRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  panel: { flex: 1, borderWidth: 1, borderColor: PDF_THEME.surface.panelBorder, backgroundColor: PDF_THEME.surface.panel, borderRadius: 4, padding: 8 },
  panelSpacer: { flex: 1 },
  panelLabel: { fontSize: 7, textTransform: "uppercase", color: PDF_THEME.text.muted },
  panelValue: { fontSize: 13, fontWeight: "bold", marginTop: 2 },
  sectionHeading: { fontSize: 9, textTransform: "uppercase", color: PDF_THEME.text.muted, marginTop: 14, marginBottom: 6 },
  footer: { marginTop: 18, fontSize: 8, color: PDF_THEME.text.muted, lineHeight: 1.4 },

  // Findings
  findingCard: { borderWidth: 1, borderColor: PDF_THEME.surface.panelBorder, borderRadius: 4, padding: 8, marginBottom: 6 },
  findingHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  findingHeadline: { fontSize: 10, fontWeight: "bold", flex: 4 },
  findingImpact: { flex: 1, fontSize: 9, fontWeight: "bold", textAlign: "right" },
  findingCategory: { fontSize: 7, textTransform: "uppercase", color: PDF_THEME.text.muted, marginTop: 2, marginBottom: 4 },
  findingPartLabel: { fontSize: 7, textTransform: "uppercase", color: PDF_THEME.text.muted, marginTop: 4 },
  findingPartBody: { fontSize: 9, color: PDF_THEME.text.primary, lineHeight: 1.4 },
  findingRefs: { fontSize: 8, color: PDF_THEME.text.muted, marginTop: 5, fontStyle: "italic" },

  // Bracket map
  bracketBlock: { marginBottom: 12 },
  bracketHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 4 },
  bracketBlockTitle: { fontSize: 9, fontWeight: "bold" },
  bracketCaption: { fontSize: 8, color: PDF_THEME.text.muted },
  bracketBarRow: { flexDirection: "row", height: 22, borderWidth: 1, borderColor: PDF_THEME.surface.panelBorder, borderRadius: 3, overflow: "hidden" },
  bracketSegment: { position: "relative", height: "100%", borderRightWidth: 0.5, borderRightColor: PDF_THEME.surface.panelBorder },
  bracketFill: { position: "absolute", top: 0, left: 0, bottom: 0, backgroundColor: BAR_FILL, opacity: 0.55 },
  bracketSegmentLabel: { fontSize: 7, textAlign: "center", marginTop: 6 },
  bracketFootnote: { fontSize: 8, color: PDF_THEME.text.muted, marginTop: 3 },
  capGainsBarWrap: { position: "relative", height: 22, borderWidth: 1, borderColor: PDF_THEME.surface.panelBorder, borderRadius: 3, overflow: "hidden" },
  capGainsFloor: { position: "absolute", top: 0, bottom: 0, left: 0, backgroundColor: BAR_FLOOR, opacity: 0.3 },
  capGainsFill: { position: "absolute", top: 0, bottom: 0, backgroundColor: BAR_FILL, opacity: 0.55 },
  capGainsMarker: { position: "absolute", top: 0, bottom: 0, borderLeftWidth: 1.5, borderLeftColor: PDF_THEME.text.primary, borderLeftStyle: "dashed" },

  // Tables (income composition, deductions, YoY)
  table: { marginTop: 2 },
  tableHeaderRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: PDF_THEME.surface.divider, paddingBottom: 3, marginBottom: 2 },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: PDF_THEME.surface.divider, paddingVertical: 3 },
  tableLabelCell: { flex: 2, fontSize: 9 },
  tableValueCell: { flex: 1, fontSize: 9, textAlign: "right" },
  tableHeaderLabelCell: { flex: 2, fontSize: 8, color: PDF_THEME.text.muted, textTransform: "uppercase" },
  tableHeaderValueCell: { flex: 1, fontSize: 8, color: PDF_THEME.text.muted, textTransform: "uppercase", textAlign: "right" },
  tableTotalRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: PDF_THEME.surface.divider, paddingTop: 3, marginTop: 1 },
  tableTotalLabelCell: { flex: 2, fontSize: 9, fontWeight: "bold" },
  tableTotalValueCell: { flex: 1, fontSize: 9, fontWeight: "bold", textAlign: "right" },

  // Business & rental detail
  activityCard: { borderWidth: 1, borderColor: PDF_THEME.surface.panelBorder, borderRadius: 4, padding: 8, marginBottom: 6 },
  activityTitle: { fontSize: 10, fontWeight: "bold" },
  activitySubtitle: { fontSize: 7, textTransform: "uppercase", color: PDF_THEME.text.muted, marginBottom: 4 },
  activityDetailLabelCell: { flex: 2, fontSize: 9, paddingLeft: 10, color: PDF_THEME.text.muted },
  activityMemoLabelCell: { flex: 2, fontSize: 9, color: PDF_THEME.text.muted },
  activityMemoValueCell: { flex: 1, fontSize: 9, textAlign: "right", color: PDF_THEME.text.muted },
});

function KeyFigure({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelLabel}>{label}</Text>
      <Text style={styles.panelValue}>{value}</Text>
    </View>
  );
}

/** Panels per row. Seven across already crowded the page; the gross-income
 *  tile would make eight. Chunking matches the screen's md:grid-cols-4. */
const FIGURES_PER_ROW = 4;

function KeyFiguresRow({ analysis }: { analysis: TaxAnalysis }) {
  const figures = keyFigureTiles(analysis.keyFigures);

  const rows: Array<typeof figures> = [];
  for (let i = 0; i < figures.length; i += FIGURES_PER_ROW) {
    rows.push(figures.slice(i, i + FIGURES_PER_ROW));
  }

  return (
    <View>
      {rows.map((row) => (
        <View key={row[0].label} style={styles.figuresRow}>
          {row.map((f) => (
            <KeyFigure key={f.label} label={f.label} value={f.value} />
          ))}
          {/* Keeps a short trailing row's panels the same width as a full one. */}
          {Array.from({ length: FIGURES_PER_ROW - row.length }, (_, i) => (
            <View key={`spacer-${i}`} style={styles.panelSpacer} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** Swaps Tailwind divs for react-pdf Views on top of the same layout geometry
 *  the screen's BracketMapBars uses (bracket-map-bars.tsx) — both consume
 *  computeBracketBarLayout, so the taxBase=0 scaleTop guard (an all-LTCG
 *  retiree return can't produce NaN segment widths) lives in exactly one
 *  place. */
function BracketMapSection({ analysis }: { analysis: TaxAnalysis }) {
  const map = analysis.bracketMap;
  if (!map) return null;
  const layout = computeBracketBarLayout(map);

  return (
    <View>
      <View style={styles.bracketBlock}>
        <View style={styles.bracketHeaderRow}>
          <Text style={styles.bracketBlockTitle}>Ordinary income brackets</Text>
          <Text style={styles.bracketCaption}>{fmtUsd(map.ordinary.taxBase)} of ordinary taxable income</Text>
        </View>
        <View style={styles.bracketBarRow}>
          {layout.segments.map((seg) => (
            <View key={seg.from} style={[styles.bracketSegment, { width: `${seg.widthPct}%` }]}>
              <View style={[styles.bracketFill, { width: `${seg.fillPct}%` }]} />
              <Text style={styles.bracketSegmentLabel}>{fmtPct(seg.rate)}</Text>
            </View>
          ))}
        </View>
        {map.ordinary.headroomToNext != null && map.ordinary.nextRate != null && (
          <Text style={styles.bracketFootnote}>
            {fmtUsd(map.ordinary.headroomToNext)} of headroom remains at {fmtPct(map.ordinary.marginalRate)} before
            the {fmtPct(map.ordinary.nextRate)} bracket.
          </Text>
        )}
      </View>

      <View style={styles.bracketBlock}>
        <View style={styles.bracketHeaderRow}>
          <Text style={styles.bracketBlockTitle}>Long-term gains &amp; qualified dividends</Text>
          <Text style={styles.bracketCaption}>{fmtUsd(map.capGains.preferentialBase)} stacked on top of ordinary income</Text>
        </View>
        <View style={styles.capGainsBarWrap}>
          <View style={[styles.capGainsFloor, { width: `${layout.capGains.floorPct}%` }]} />
          <View
            style={[
              styles.capGainsFill,
              { left: `${layout.capGains.fillLeftPct}%`, width: `${layout.capGains.fillWidthPct}%` },
            ]}
          />
          <View style={[styles.capGainsMarker, { left: `${layout.capGains.markerLeftPct}%` }]} />
        </View>
        <Text style={styles.bracketFootnote}>
          Dashed line = top of the 0% bracket ({fmtUsd(map.capGains.zeroPctTop)}).{" "}
          {map.capGains.zeroPctHeadroom > 0
            ? `${fmtUsd(map.capGains.zeroPctHeadroom)} of gains could still be realized at 0%.`
            : "This return's income is above the 0% capital-gains bracket."}
        </Text>
      </View>
    </View>
  );
}

function IncomeCompositionSection({ analysis }: { analysis: TaxAnalysis }) {
  const rows = analysis.incomeComposition;
  if (!rows) return null;
  const k = analysis.keyFigures;
  const total = incomeCompositionTotal(k.totalIncome, k.grossIncome);
  const showGross = hasGrossColumn(rows);
  return (
    <View>
      <Text style={styles.sectionHeading}>Income composition</Text>
      <View style={styles.table}>
        <View style={styles.tableHeaderRow}>
          {incomeCompositionHeaders(rows).map((h, i) => (
            <Text key={h} style={i === 0 ? styles.tableHeaderLabelCell : styles.tableHeaderValueCell}>
              {h}
            </Text>
          ))}
        </View>
        {rows.map((r) => (
          <View key={r.key} style={styles.tableRow}>
            <Text style={styles.tableLabelCell}>{r.label}</Text>
            <Text style={styles.tableValueCell}>{fmtUsd(r.amount)}</Text>
            {showGross && <Text style={styles.tableValueCell}>{fmtUsd(r.gross)}</Text>}
            <Text style={styles.tableValueCell}>{r.pctOfGross != null ? fmtPct(r.pctOfGross) : "—"}</Text>
          </View>
        ))}
        {total && (
          <View style={styles.tableTotalRow}>
            <Text style={styles.tableTotalLabelCell}>Total income</Text>
            <Text style={styles.tableTotalValueCell}>{total.amount}</Text>
            {showGross && <Text style={styles.tableTotalValueCell}>{total.gross}</Text>}
            <Text style={styles.tableTotalValueCell}>{total.pct}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

/** Per-variant row/label/value styles, keyed so the three lookups stay aligned
 *  — a nested ternary per cell drifts the moment a variant is added. */
const ACTIVITY_VARIANT_STYLES = {
  primary: { row: styles.tableRow, label: styles.tableLabelCell, value: styles.tableValueCell },
  detail: { row: styles.tableRow, label: styles.activityDetailLabelCell, value: styles.tableValueCell },
  total: { row: styles.tableTotalRow, label: styles.tableTotalLabelCell, value: styles.tableTotalValueCell },
  memo: { row: styles.tableRow, label: styles.activityMemoLabelCell, value: styles.activityMemoValueCell },
} as const;

function ActivityDetailSection({ analysis }: { analysis: TaxAnalysis }) {
  const activities = analysis.activityDetail;
  if (!activities) return null;
  return (
    <View>
      <Text style={styles.sectionHeading}>Business &amp; rental detail</Text>
      {activities.map((activity) => (
        <View key={activity.key} style={styles.activityCard} wrap={false}>
          <Text style={styles.activityTitle}>{activity.title}</Text>
          {activity.subtitle && <Text style={styles.activitySubtitle}>{activity.subtitle}</Text>}
          {activityDetailRows(activity).map((r) => {
            const s = ACTIVITY_VARIANT_STYLES[r.variant];
            return (
              <View key={r.label} style={s.row}>
                <Text style={s.label}>{r.label}</Text>
                <Text style={s.value}>{r.value}</Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function DeductionsSection({ analysis }: { analysis: TaxAnalysis }) {
  const d = analysis.deductionDetail;
  if (!d) return null;
  return (
    <View>
      <Text style={styles.sectionHeading}>Deductions</Text>
      <View style={styles.table}>
        {deductionDetailRows(d).map((r) => (
          <View key={r.label} style={styles.tableRow}>
            <Text style={styles.tableLabelCell}>{r.label}</Text>
            <Text style={styles.tableValueCell}>{r.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const refs = formatLineRefs(finding.lineRefs);
  return (
    <View style={styles.findingCard} wrap={false}>
      <View style={styles.findingHeaderRow}>
        <Text style={styles.findingHeadline}>{finding.headline}</Text>
        {finding.estimatedImpact != null && (
          <Text style={styles.findingImpact}>{fmtUsd(finding.estimatedImpact)}</Text>
        )}
      </View>
      <Text style={styles.findingCategory}>{CATEGORY_LABEL[finding.category]}</Text>
      {FINDING_PARTS.map(({ key, label }) =>
        finding[key] ? (
          <View key={key}>
            <Text style={styles.findingPartLabel}>{label}</Text>
            <Text style={styles.findingPartBody}>{finding[key]}</Text>
          </View>
        ) : null,
      )}
      {refs !== "" && <Text style={styles.findingRefs}>{refs}</Text>}
    </View>
  );
}

function FindingsSection({ analysis }: { analysis: TaxAnalysis }) {
  const findings = sortFindings(analysis.findings);
  return (
    <View>
      {SEVERITY_GROUPS.map(({ severity, heading }) => {
        const items = findings.filter((f) => f.severity === severity);
        if (items.length === 0) return null;
        return (
          <View key={severity}>
            <Text style={styles.sectionHeading}>{heading}</Text>
            {items.map((f) => (
              <FindingCard key={f.id} finding={f} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

function YoYSection({ analysis, taxYear }: { analysis: TaxAnalysis; taxYear: number }) {
  if (!analysis.yoy) return null;
  const f = (v: number | null, kind: "money" | "rate") => (v == null ? "—" : kind === "rate" ? fmtPct(v) : fmtUsd(v));
  return (
    <View>
      <Text style={styles.sectionHeading}>Year over year</Text>
      <View style={styles.table}>
        <View style={styles.tableHeaderRow}>
          <Text style={styles.tableHeaderLabelCell}>Measure</Text>
          <Text style={styles.tableHeaderValueCell}>Prior</Text>
          <Text style={styles.tableHeaderValueCell}>{taxYear}</Text>
          <Text style={styles.tableHeaderValueCell}>Change</Text>
        </View>
        {analysis.yoy.map((r) => (
          <View key={r.label} style={styles.tableRow}>
            <Text style={styles.tableLabelCell}>{r.label}</Text>
            <Text style={styles.tableValueCell}>{f(r.prior, r.kind)}</Text>
            <Text style={styles.tableValueCell}>{f(r.current, r.kind)}</Text>
            <Text style={styles.tableValueCell}>{f(r.delta, r.kind)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function TaxAnalysisPdfDocument(props: TaxAnalysisPdfProps) {
  const { analysis: a } = props;
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>{props.taxYear} Tax Analysis</Text>
            <Text style={styles.subtitle}>
              {props.clientName} · Prepared {props.generatedAt}
              {props.firmName ? ` · ${props.firmName}` : ""}
            </Text>
          </View>
          {props.logoDataUrl ? <Image src={props.logoDataUrl} style={styles.logo} /> : null}
        </View>

        <KeyFiguresRow analysis={a} />

        <BracketMapSection analysis={a} />

        <IncomeCompositionSection analysis={a} />
        <ActivityDetailSection analysis={a} />

        <DeductionsSection analysis={a} />

        <FindingsSection analysis={a} />

        <YoYSection analysis={a} taxYear={props.taxYear} />

        <View style={styles.footer}>
          <Text>{reconstructionNote(a.reconstruction)}</Text>
        </View>
      </Page>
    </Document>
  );
}
