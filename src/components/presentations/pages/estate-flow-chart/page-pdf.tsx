import { Text, View, StyleSheet, Svg, Path } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T, ZEBRA_FILL, type SectionAccent } from "@/lib/presentations/theme";
import { PageFrame, PAGE_PAD_X, PAGE_WIDTH_PORTRAIT } from "../../shared/page-frame";
import { SectionHead } from "../../shared/section-head";
import type { EstateFlowChartData } from "@/lib/presentations/pages/estate-flow-chart/view-model";
import type {
  DeathStage,
  DeathSubBoxKind,
  EstateFlowSummary,
  HeirBox,
  OoeEntity,
} from "@/lib/estate/estate-flow-summary";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

// Mirrors the on-screen flow chart (estate-flow-summary.tsx): bequests to
// trusts share the heirs' green there, so they do here.
const SUBBOX_COLOR: Record<DeathSubBoxKind, string> = {
  taxes: T.crit,
  trusts: T.good,
  inheritance_spouse: T.steel,
  heirs_outright: T.good,
};

type Tone = "estate" | "survivor" | "tax" | "heirs" | "neutral";

const TONE: Record<Tone, { bg: string; border: string; ink: string }> = {
  estate: { bg: T.accent, border: T.accent, ink: T.card },
  survivor: { bg: T.card, border: T.ink3, ink: T.ink },
  tax: { bg: T.crit, border: T.crit, ink: T.card },
  heirs: { bg: T.good, border: T.good, ink: T.card },
  neutral: { bg: ZEBRA_FILL, border: T.hair2, ink: T.ink },
};

// The in-estate flow keeps the screen's narrow center column; the side
// columns split what's left so the flow stays centered on the page whether
// or not there's a surviving spouse or anything out of the estate.
const CENTER_WIDTH = 210;

// Four heir cards fill one row of the content box, so a typical family
// stays on the page's single sheet.
const HEIR_GAP = 8;
const HEIR_WIDTH = Math.floor((PAGE_WIDTH_PORTRAIT - 2 * PAGE_PAD_X - 3 * HEIR_GAP) / 4);

const styles = StyleSheet.create({
  grid: { flexDirection: "row", gap: 14 },
  side: { flex: 1 },
  center: { width: CENTER_WIDTH },
  headRow: { flexDirection: "row", gap: 14, marginBottom: 8 },
  headCenter: { width: CENTER_WIDTH, flexDirection: "row", justifyContent: "center" },
  head: { flexDirection: "row", alignItems: "center", gap: 5 },
  headDot: { width: 4, height: 4, borderRadius: 2 },
  headLabel: { fontSize: 7, fontWeight: 600, color: T.ink3, textTransform: "uppercase", letterSpacing: 1.4 },
  leftCol: { flex: 1, alignItems: "flex-end" },
  rightCol: { flex: 1, alignItems: "flex-start", gap: 8 },
  sideBox: { width: "100%", maxWidth: 150 },
  box: { borderRadius: 6, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 10, alignItems: "center" },
  boxTitle: { fontSize: 6.5, fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.8, textAlign: "center", opacity: 0.85 },
  boxValue: { fontSize: 11.5, fontWeight: 600, marginTop: 1.5 },
  inset: { borderRadius: 7, borderWidth: 1, borderColor: T.hair, backgroundColor: ZEBRA_FILL, padding: 3.5, gap: 3 },
  subBox: { borderRadius: 4, paddingVertical: 4.5, paddingHorizontal: 8 },
  subHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  subDivider: { borderTopWidth: 0.75, borderTopColor: T.card, opacity: 0.4, marginTop: 3, marginBottom: 1 },
  subLabel: { fontSize: 7.5, fontWeight: 500, color: T.card },
  subValue: { fontSize: 8.5, fontWeight: 600, color: T.card },
  arrow: { alignItems: "center", paddingVertical: 3 },
  ooeGroup: { width: "100%", maxWidth: 150, gap: 4 },
  ooeGroupLabel: { fontSize: 6.5, fontWeight: 600, color: T.ink3, textTransform: "uppercase", letterSpacing: 1.2, paddingHorizontal: 2 },
  ooeEmpty: { width: "100%", maxWidth: 150, borderRadius: 6, borderWidth: 1, borderStyle: "dashed", borderColor: T.hair2, backgroundColor: ZEBRA_FILL, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center", gap: 2 },
  ooeEmptyTitle: { fontSize: 7.5, fontWeight: 500, color: T.ink2, textAlign: "center" },
  ooeEmptyNote: { fontSize: 6.5, color: T.ink3, textAlign: "center" },
  heirsWrap: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: HEIR_GAP, marginTop: 16 },
  heirCard: { width: HEIR_WIDTH, borderRadius: 6, backgroundColor: T.good, paddingVertical: 7, paddingHorizontal: 8 },
  heirName: { fontSize: 8.5, fontWeight: 600, color: T.card, marginBottom: 3 },
  heirRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 1.5 },
  heirRowText: { fontSize: 7.5, color: T.card },
  sectionTitle: { fontSize: 7, fontWeight: 500, color: T.card, marginTop: 4, marginBottom: 1 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: 4, marginTop: 1 },
  detailText: { fontSize: 6.5, color: T.card, opacity: 0.85 },
  detailLabel: { flex: 1 },
  detailAmount: { flexShrink: 0 },
  heirDivider: { borderTopWidth: 0.75, borderTopColor: T.card, opacity: 0.4, marginTop: 5, marginBottom: 3 },
  heirTotalText: { fontSize: 8, fontWeight: 600, color: T.card },
  empty: { fontSize: 10, color: T.ink3, marginTop: 40, textAlign: "center" },
});

function FlowArrow({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.arrow}>
      <Svg width={compact ? 7 : 9} height={compact ? 11 : 14} viewBox="0 0 14 22">
        <Path
          d="M7 0 L7 18 M1 14 L7 20 L13 14"
          stroke={T.ink3}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
    </View>
  );
}

function SectionHeader({ label, dot }: { label: string; dot: string }) {
  return (
    <View style={styles.head}>
      <View style={[styles.headDot, { backgroundColor: dot }]} />
      <Text style={styles.headLabel}>{label}</Text>
    </View>
  );
}

function FlowBox({ tone, title, value }: { tone: Tone; title: string; value: number }) {
  const t = TONE[tone];
  return (
    <View style={[styles.box, { backgroundColor: t.bg, borderColor: t.border }]}>
      <Text style={[styles.boxTitle, { color: t.ink }]}>{title}</Text>
      <Text style={[styles.boxValue, { color: t.ink }]}>{fmt.format(value)}</Text>
    </View>
  );
}

function DeathStep({ stage }: { stage: DeathStage }) {
  return (
    <View>
      <FlowBox tone="estate" title={`${stage.decedentLabel} · ${stage.year}`} value={stage.estateValue} />
      {stage.subBoxes.length > 0 && (
        <>
          <FlowArrow compact />
          <View style={styles.inset}>
            {stage.subBoxes.map((box) => (
              <View key={box.kind} style={[styles.subBox, { backgroundColor: SUBBOX_COLOR[box.kind] }]}>
                <View style={styles.subHead}>
                  <Text style={styles.subLabel}>{box.label}</Text>
                  <Text style={styles.subValue}>{fmt.format(box.total)}</Text>
                </View>
                {/* The taxes box says where its total comes from — estate
                    tax, probate, admin, debts, IRD — like the screen's panel. */}
                {box.kind === "taxes" && box.lines.length > 0 && (
                  <>
                    <View style={styles.subDivider} />
                    {box.lines.map((l, li) => (
                      <View key={li} style={styles.detailRow}>
                        <Text style={[styles.detailText, styles.detailLabel]}>{l.label}</Text>
                        <Text style={[styles.detailText, styles.detailAmount]}>{fmt.format(l.amount)}</Text>
                      </View>
                    ))}
                  </>
                )}
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

function OoeGroup({ label, entities }: { label: string; entities: OoeEntity[] }) {
  return (
    <View style={styles.ooeGroup}>
      <Text style={styles.ooeGroupLabel}>{label}</Text>
      {entities.map((e) => (
        <FlowBox key={e.entityId} tone="neutral" title={e.entityLabel} value={e.amount} />
      ))}
    </View>
  );
}

function HeirRow({ label, amount, total = false }: { label: string; amount: number; total?: boolean }) {
  const text = total ? styles.heirTotalText : styles.heirRowText;
  return (
    <View style={styles.heirRow}>
      <Text style={text}>{label}</Text>
      <Text style={text}>{fmt.format(amount)}</Text>
    </View>
  );
}

function HeirCard({ heir, showDetail }: { heir: HeirBox; showDetail: boolean }) {
  return (
    <View style={styles.heirCard} wrap={false}>
      <Text style={styles.heirName}>{heir.recipientLabel}</Text>
      <HeirRow label="Outright" amount={heir.outright} />
      <HeirRow label="In Trust" amount={heir.inTrust} />
      {showDetail &&
        heir.sections.map((s, si) => (
          <View key={si}>
            <Text style={styles.sectionTitle}>{s.title}</Text>
            {s.lines.map((l, li) => (
              <View key={li} style={styles.detailRow}>
                <Text style={[styles.detailText, styles.detailLabel]}>{l.label}</Text>
                <Text style={[styles.detailText, styles.detailAmount]}>{fmt.format(l.amount)}</Text>
              </View>
            ))}
          </View>
        ))}
      <View style={styles.heirDivider} />
      <HeirRow label="Total" amount={heir.total} total />
    </View>
  );
}

function Flow({ s, showHeirDetail }: { s: EstateFlowSummary; showHeirDetail: boolean }) {
  const { survivorNetWorth, firstDeath, secondDeath, outOfEstate, heirBoxes, totals } = s;
  const hasOoe = outOfEstate.heirs.entities.length > 0 || outOfEstate.irrevTrusts.entities.length > 0;
  return (
    <>
      <View style={styles.headRow}>
        <View style={styles.side} />
        <View style={styles.headCenter}>
          <SectionHeader label="In Estate" dot={T.accent} />
        </View>
        <View style={styles.side}>
          <SectionHeader label="Out of Estate" dot={T.ink3} />
        </View>
      </View>

      <View style={styles.grid}>
        <View style={styles.leftCol}>
          {survivorNetWorth && (
            <View style={styles.sideBox}>
              <FlowBox
                tone="survivor"
                title={`${survivorNetWorth.ownerLabel}'s Net Worth`}
                value={survivorNetWorth.amount}
              />
            </View>
          )}
        </View>

        <View style={styles.center}>
          {firstDeath && <DeathStep stage={firstDeath} />}
          {firstDeath && secondDeath && <FlowArrow />}
          {secondDeath && <DeathStep stage={secondDeath} />}
          {(firstDeath || secondDeath) && (
            <>
              <FlowArrow />
              <View style={{ gap: 4 }}>
                <FlowBox tone="tax" title="Total Taxes & Expenses" value={totals.totalTaxesAndExpenses} />
                <FlowBox tone="heirs" title="Total to Heirs" value={totals.totalToHeirs} />
              </View>
            </>
          )}
        </View>

        <View style={styles.rightCol}>
          {hasOoe ? (
            <>
              {outOfEstate.heirs.entities.length > 0 && (
                <OoeGroup label="Heirs" entities={outOfEstate.heirs.entities} />
              )}
              {outOfEstate.irrevTrusts.entities.length > 0 && (
                <OoeGroup label="Irrev Trusts" entities={outOfEstate.irrevTrusts.entities} />
              )}
            </>
          ) : (
            <View style={styles.ooeEmpty}>
              <Text style={styles.ooeEmptyTitle}>Nothing outside the estate</Text>
              <Text style={styles.ooeEmptyNote}>All assets are included in the taxable estate.</Text>
            </View>
          )}
        </View>
      </View>

      {heirBoxes.length > 0 && (
        <View style={styles.heirsWrap}>
          {heirBoxes.map((h) => (
            <HeirCard key={h.recipientKey} heir={h} showDetail={showHeirDetail} />
          ))}
        </View>
      )}
    </>
  );
}

export function EstateFlowChartPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  accent,
}: {
  data: EstateFlowChartData;
  firmName: string;
  clientName: string;
  reportDate: string;
  pageIndex: number;
  totalPages: number;
  accent: SectionAccent;
}) {
  return (
    <PageFrame
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
    >
      <SectionHead title={data.title} subtitle={data.subtitle} accent={accent} />
      {!data.summary ? (
        <Text style={styles.empty}>No estate data available for this scenario.</Text>
      ) : (
        <Flow s={data.summary} showHeirDetail={data.showHeirDetail} />
      )}
    </PageFrame>
  );
}
