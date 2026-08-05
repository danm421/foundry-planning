// src/components/risk-profile-pdf/risk-profile-pdf-document.tsx
//
// The Risk profile export. Same three components the detail page shows
// (tolerance, capacity, environment), the capacity breakdown expanded with the
// help copy the screen hides behind tooltips, and the full change log.
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "@/components/balance-sheet-report/tokens";
import { CAPACITY_WEIGHTS, type CapacityFactors } from "@/lib/insights/risk-capacity";
import {
  CAPACITY_FACTOR_ORDER,
  TOLERANCE_SOURCE_LABELS,
  bindingConstraintLine,
  formatAdjustment,
} from "@/lib/risk/labels";
import { RISK_LEVEL_LABELS } from "@/lib/risk-levels";
import type { MismatchState } from "@/lib/risk/portfolio-mismatch";
import type { RiskDetailRow, RiskListFlags } from "@/lib/risk/queries";

/** One change-log line, already resolved to display strings — the actor lookup
 *  is a Clerk call, so it happens in the route, not in the render tree. */
export interface RiskEventLine {
  id: string;
  date: string;
  summary: string;
  actor: string;
}

export interface RiskProfilePdfProps {
  row: RiskDetailRow;
  flags: RiskListFlags;
  /** Null when the household has no plan to derive capacity from. */
  factors: CapacityFactors | null;
  mismatch: MismatchState;
  events: RiskEventLine[];
  generatedAt: string;
  firmName?: string | null;
  logoDataUrl?: string | null; // from resolveBranding — base64 data URL or null
}

const DASH = "—";

// Muted-slate bar fill, deliberately not the Foundry verdigris accent — client
// PDFs use the report's own print theme (see PDF_THEME), never product chrome.
const BAR_FILL = PDF_THEME.text.secondary;

const styles = StyleSheet.create({
  // paddingBottom clears the fixed footer block below (a two-line disclaimer
  // plus the page number, anchored at bottom: 20) -- without it, content flows
  // underneath the disclaimer instead of breaking to the next page.
  page: { backgroundColor: PDF_THEME.surface.page, padding: 32, paddingBottom: 68, color: PDF_THEME.text.primary, fontFamily: "Helvetica", fontSize: 10 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1, borderBottomColor: PDF_THEME.surface.divider, paddingBottom: 10, marginBottom: 14 },
  title: { fontSize: 18, fontWeight: "bold" },
  subtitle: { color: PDF_THEME.text.muted, fontSize: 10, marginTop: 2 },
  logo: { height: 28, objectFit: "contain" },

  headline: { borderWidth: 1, borderColor: PDF_THEME.surface.panelBorder, backgroundColor: PDF_THEME.surface.panel, borderRadius: 4, padding: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  headlineScore: { fontSize: 30, fontWeight: "bold" },
  headlineLevel: { fontSize: 13, fontWeight: "bold" },
  headlineNote: { fontSize: 9, color: PDF_THEME.text.muted, marginTop: 2 },
  formula: { fontSize: 8, color: PDF_THEME.text.muted, marginTop: 6, lineHeight: 1.4 },

  panelRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  panel: { flex: 1, borderWidth: 1, borderColor: PDF_THEME.surface.panelBorder, backgroundColor: PDF_THEME.surface.panel, borderRadius: 4, padding: 8 },
  panelLabel: { fontSize: 7, textTransform: "uppercase", color: PDF_THEME.text.muted },
  panelValue: { fontSize: 16, fontWeight: "bold", marginTop: 2 },
  panelMeta: { fontSize: 8, color: PDF_THEME.text.muted, marginTop: 2, lineHeight: 1.4 },
  panelBody: { fontSize: 9, color: PDF_THEME.text.secondary, marginTop: 2, lineHeight: 1.4 },

  sectionHeading: { fontSize: 9, textTransform: "uppercase", color: PDF_THEME.text.muted, marginTop: 16, marginBottom: 6 },

  factorRow: { marginBottom: 7 },
  factorHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  factorLabel: { fontSize: 9, fontWeight: "bold" },
  factorScore: { fontSize: 9, color: PDF_THEME.text.muted },
  barTrack: { height: 4, borderRadius: 2, backgroundColor: PDF_THEME.surface.panelHeader, marginTop: 3, marginBottom: 2 },
  barFill: { height: 4, borderRadius: 2, backgroundColor: BAR_FILL },
  factorHelp: { fontSize: 7.5, color: PDF_THEME.text.muted, lineHeight: 1.35 },

  callout: { borderWidth: 1, borderRadius: 4, padding: 8, marginTop: 12, borderColor: PDF_THEME.status.down.border, backgroundColor: PDF_THEME.status.down.bg },
  calloutText: { fontSize: 9, lineHeight: 1.4, color: PDF_THEME.status.down.fg },

  bucketRow: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 0.5, borderBottomColor: PDF_THEME.surface.divider, paddingVertical: 3 },
  bucketLabel: { fontSize: 9 },
  bucketValue: { fontSize: 9, color: PDF_THEME.text.secondary },

  table: { marginTop: 2 },
  tableHeaderRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: PDF_THEME.surface.divider, paddingBottom: 3, marginBottom: 2 },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: PDF_THEME.surface.divider, paddingVertical: 3 },
  thDate: { width: "18%", fontSize: 8, color: PDF_THEME.text.muted, textTransform: "uppercase" },
  thChange: { width: "60%", fontSize: 8, color: PDF_THEME.text.muted, textTransform: "uppercase" },
  thBy: { width: "22%", fontSize: 8, color: PDF_THEME.text.muted, textTransform: "uppercase" },
  tdDate: { width: "18%", fontSize: 9, color: PDF_THEME.text.muted },
  tdChange: { width: "60%", fontSize: 9, paddingRight: 6 },
  tdBy: { width: "22%", fontSize: 9, color: PDF_THEME.text.secondary },

  empty: { fontSize: 9, color: PDF_THEME.text.muted },
  footer: { position: "absolute", bottom: 20, left: 32, right: 32 },
  footerNote: { fontSize: 8, color: PDF_THEME.text.muted, lineHeight: 1.4 },
  footerPage: { fontSize: 8, color: PDF_THEME.text.muted, textAlign: "center", marginTop: 4 },
});

function formatDate(d: Date | null): string {
  return d ? new Date(d).toISOString().slice(0, 10) : DASH;
}

function Headline({ row }: { row: RiskDetailRow }) {
  return (
    <View>
      <View style={styles.headline}>
        <Text style={styles.headlineScore}>{row.compositeScore ?? DASH}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.headlineLevel}>
            {row.compositeLevel ? RISK_LEVEL_LABELS[row.compositeLevel] : "Not established"}
          </Text>
          <Text style={styles.headlineNote}>{bindingConstraintLine(row.bindingConstraint)}</Text>
          <Text style={styles.headlineNote}>Profile last updated {formatDate(row.updatedAt)}</Text>
        </View>
      </View>
      <Text style={styles.formula}>
        The composite is the lower of tolerance (adjusted for circumstances) and capacity, never an
        average of the two. Capacity is a ceiling: a household willing to take more risk than its
        plan can absorb is held at what the plan can absorb.
      </Text>
    </View>
  );
}

function ComponentPanels({ row, flags }: { row: RiskDetailRow; flags: RiskListFlags }) {
  const source = TOLERANCE_SOURCE_LABELS[row.toleranceSource ?? ""] ?? DASH;
  return (
    <View style={styles.panelRow}>
      <View style={styles.panel}>
        <Text style={styles.panelLabel}>Tolerance</Text>
        {row.toleranceScore === null ? (
          <Text style={styles.panelBody}>Not established</Text>
        ) : (
          <>
            <Text style={styles.panelValue}>{row.toleranceScore}</Text>
            <Text style={styles.panelMeta}>
              {source} · confirmed {formatDate(row.toleranceConfirmedAt)}
            </Text>
            {flags.reviewDue && <Text style={styles.panelMeta}>Review due</Text>}
            {row.spouseToleranceScore !== null && (
              <Text style={styles.panelMeta}>
                Spouse {row.spouseToleranceScore} — household tolerance uses the lower of the two
              </Text>
            )}
          </>
        )}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelLabel}>Capacity</Text>
        {row.capacityScore === null ? (
          <Text style={styles.panelBody}>No plan yet — build a plan to establish capacity</Text>
        ) : (
          <>
            <Text style={styles.panelValue}>{row.capacityScore}</Text>
            <Text style={styles.panelMeta}>
              Computed from the base scenario on {formatDate(row.capacityComputedAt)}
            </Text>
          </>
        )}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelLabel}>Environment</Text>
        <Text style={styles.panelValue}>{formatAdjustment(row.environmentAdj)}</Text>
        <Text style={styles.panelBody}>{row.environmentReason ?? DASH}</Text>
      </View>
    </View>
  );
}

/**
 * Five bars, one per `computeCapacityScore` contribution — the same weighted
 * contributions and per-weight ceilings the screen's CapacityBreakdown draws.
 * The ceilings sum to 143, not to the score: the blend is capped at
 * CAPACITY_SCORE_MAX, and that headroom is what lets real strength in one
 * factor cover a gap in another. So a maxed-out household's bars visibly total
 * more than its score, and the note below the bars says so.
 */
function CapacityBreakdownSection({ factors }: { factors: CapacityFactors }) {
  return (
    <View>
      <Text style={styles.sectionHeading}>What drives capacity</Text>
      {CAPACITY_FACTOR_ORDER.map(({ key, label, help }) => {
        const ceiling = CAPACITY_WEIGHTS[key];
        const value = factors[key];
        const fillPct = ceiling > 0 ? Math.min(100, Math.max(0, (value / ceiling) * 100)) : 0;
        return (
          <View key={key} style={styles.factorRow} wrap={false}>
            <View style={styles.factorHead}>
              <Text style={styles.factorLabel}>{label}</Text>
              <Text style={styles.factorScore}>
                {Math.round(value * 100)} / {Math.round(ceiling * 100)}
              </Text>
            </View>
            <View style={styles.barTrack}>
              <View style={{ ...styles.barFill, width: `${fillPct}%` }} />
            </View>
            <Text style={styles.factorHelp}>{help}</Text>
          </View>
        );
      })}
      <Text style={styles.factorHelp}>
        The five ceilings add up to 143 and the total is capped at 100. That headroom is deliberate:
        it lets real strength in one area cover a gap in another, so these numbers sum to the
        capacity score only below the cap.
      </Text>
    </View>
  );
}

function OverReachingCallout({ row }: { row: RiskDetailRow }) {
  return (
    <View style={styles.callout}>
      <Text style={styles.calloutText}>
        Funding these goals needs {row.requiredGrowthPct}% growth exposure, above this
        household&apos;s capacity of {row.capacityScore}. The plan needs to change, not the
        portfolio.
      </Text>
    </View>
  );
}

/** Every state except `no_profile`, which the section drops entirely rather
 *  than describing. */
type ComparableMismatch = Exclude<MismatchState, { kind: "no_profile" }>;

function alignmentLine(mismatch: ComparableMismatch): string {
  switch (mismatch.kind) {
    case "untagged":
      return `No model portfolio is tagged ${RISK_LEVEL_LABELS[mismatch.level]}, so there is no target to compare the plan against.`;
    case "aligned":
      return `The plan runs on ${mismatch.targetName}, the portfolio tagged ${RISK_LEVEL_LABELS[mismatch.level]}. Profile and plan agree.`;
    case "mismatch":
      return `This profile calls for ${mismatch.targetName}, the portfolio tagged ${RISK_LEVEL_LABELS[mismatch.level]}. The plan is not running on it.`;
  }
}

function PortfolioAlignmentSection({ mismatch }: { mismatch: MismatchState }) {
  if (mismatch.kind === "no_profile") return null;
  return (
    <View wrap={false}>
      <Text style={styles.sectionHeading}>Portfolio alignment</Text>
      <Text style={styles.panelBody}>{alignmentLine(mismatch)}</Text>
      {mismatch.buckets.length > 0 && (
        <View style={styles.table}>
          {mismatch.buckets.map((b) => (
            <View key={b.label} style={styles.bucketRow}>
              <Text style={styles.bucketLabel}>{b.label}</Text>
              <Text style={styles.bucketValue}>{b.value}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function ChangeLogRow({ event }: { event: RiskEventLine }) {
  return (
    <View style={styles.tableRow} wrap={false}>
      <Text style={styles.tdDate}>{event.date}</Text>
      <Text style={styles.tdChange}>{event.summary}</Text>
      <Text style={styles.tdBy}>{event.actor}</Text>
    </View>
  );
}

function ChangeLogSection({ events }: { events: RiskEventLine[] }) {
  if (events.length === 0) {
    return (
      <View wrap={false}>
        <Text style={styles.sectionHeading}>Change log</Text>
        <Text style={styles.empty}>No changes recorded yet.</Text>
      </View>
    );
  }
  const [first, ...rest] = events;
  return (
    <View>
      {/* Heading, column header, and the first row travel as one unit. Neither
          minPresenceAhead nor a `fixed` header stops the heading stranding at
          the foot of a page on its own -- only a block too tall to fit there
          does, and this is that block. */}
      <View wrap={false}>
        <Text style={styles.sectionHeading}>Change log</Text>
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={styles.thDate}>Date</Text>
            <Text style={styles.thChange}>Change</Text>
            <Text style={styles.thBy}>By</Text>
          </View>
          <ChangeLogRow event={first} />
        </View>
      </View>
      {rest.map((e) => (
        <ChangeLogRow key={e.id} event={e} />
      ))}
    </View>
  );
}

export function RiskProfilePdfDocument(props: RiskProfilePdfProps) {
  const { row, flags, factors, mismatch, events } = props;
  const overReaching =
    flags.goalsOverReaching && row.requiredGrowthPct !== null && row.capacityScore !== null;

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Risk Profile</Text>
            <Text style={styles.subtitle}>
              {row.householdName} · Prepared {props.generatedAt}
              {props.firmName ? ` · ${props.firmName}` : ""}
            </Text>
          </View>
          {props.logoDataUrl ? <Image src={props.logoDataUrl} style={styles.logo} /> : null}
        </View>

        <Headline row={row} />

        <ComponentPanels row={row} flags={flags} />

        {overReaching && <OverReachingCallout row={row} />}

        {factors && <CapacityBreakdownSection factors={factors} />}

        <PortfolioAlignmentSection mismatch={mismatch} />

        <ChangeLogSection events={events} />

        <View style={styles.footer} fixed>
          <Text style={styles.footerNote}>
            This profile summarizes the household&apos;s risk tolerance, the risk its plan can
            absorb, and the changes recorded against both. It is informational and is not a
            recommendation to buy or sell any security.
          </Text>
          <Text
            style={styles.footerPage}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
