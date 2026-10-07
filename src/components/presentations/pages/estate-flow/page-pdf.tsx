import type { ReactNode } from "react";
import { Text, View, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { PageFrame } from "../../shared/page-frame";
import type {
  EstateFlowDeathColumnData,
  EstateFlowDeathTax,
  EstateFlowReportData,
} from "@/lib/presentations/pages/estate-flow/view-model";
import {
  estateAtDeathOf,
  netToRecipientsOf,
  type RecipientGroup,
} from "@/lib/estate/transfer-report";
import type { OwnershipGroup } from "@/lib/estate/estate-flow-ownership";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const SHORT_MECHANISM: Partial<Record<RecipientGroup["byMechanism"][number]["mechanism"], string>> = {
  titling: "Titling",
  beneficiary_designation: "Beneficiary",
  will: "Bequest",
  will_residuary: "Remainder",
  will_liability_bequest: "Will debt",
  fallback_spouse: "Default",
  fallback_children: "Default",
  fallback_other_heirs: "Default",
  unlinked_liability_proportional: "Unlinked debt",
  trust_pour_out: "Pour-out",
};

const KIND_LABEL: Record<OwnershipGroup["kind"], string> = {
  client: "Individual",
  spouse: "Individual",
  joint: "Joint",
  trust: "Trust",
};

function fmtAccountType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Death-column boxes: a header band fills to the box's share in the hue of its
// kind of recipient, as on the screen (estate-flow-death-column.tsx). The hues
// are the light-theme `--share-*` colours in globals.css; each tint is 16% of
// its hue over the header's TRACK. Fixed hexes rather than opacity — a printed
// PDF's alpha blend is not the same colour on every printer.
type ShareColor = { hue: string; tint: string };
const TRACK = "#f4f3ef";
const SHARE_COLOR: Record<RecipientGroup["recipientKind"], ShareColor> = {
  spouse: { hue: "#4338ca", tint: "#d8d5e9" },
  family_member: { hue: "#0b5d50", tint: "#cfdbd6" },
  entity: { hue: "#6d28d9", tint: "#ded3eb" },
  external_beneficiary: { hue: "#9d174d", tint: "#e6d0d5" },
  // The screen stripes this band; on paper the amber and the flag carry it.
  system_default: { hue: "#92400e", tint: "#e4d6cb" },
};
const TAX_COLOR: ShareColor = { hue: "#9f1239", tint: "#e6cfd2" };
const BOX_RADIUS = 3;

/** "88%", or "<1%" for a sliver that would otherwise round to nothing. */
function percent(share: number): string {
  return share > 0 && share < 0.005 ? "<1%" : `${Math.round(share * 100)}%`;
}

/** Debts carry a true minus sign, matching the reductions line. */
function signed(n: number): string {
  return n < 0 ? `−${fmt.format(-n)}` : fmt.format(n);
}

const styles = StyleSheet.create({
  title: { fontSize: 13, fontFamily: "Fraunces", color: T.ink },
  subtitle: { fontSize: 8, color: T.ink2, marginTop: 1, marginBottom: 10 },
  columns: { flexDirection: "row", gap: 12, flex: 1 },
  column: { flex: 1, borderWidth: 0.5, borderColor: T.hair2, borderRadius: 4, padding: 8 },
  colHead: { fontSize: 8, color: T.ink2, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  colHeadRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  colYear: { fontSize: 9, color: T.ink, fontFamily: "Inter" },
  totalsStrip: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: T.paper,
    borderRadius: 3,
    paddingVertical: 3,
    paddingHorizontal: 5,
    marginBottom: 6,
  },
  stripText: { fontSize: 7, color: T.ink2 },
  stripNet: { fontSize: 7, color: T.ink, fontFamily: "Inter" },
  groupCard: { borderWidth: 0.5, borderColor: T.hair2, borderRadius: 3, padding: 5, marginBottom: 5 },
  groupHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  groupLabel: { fontSize: 8, color: T.ink, fontFamily: "Inter" },
  groupKind: { fontSize: 6, color: T.ink3, textTransform: "uppercase", letterSpacing: 0.5 },
  groupSubtotal: { fontSize: 9, color: T.ink, fontFamily: "Inter" },
  row: { flexDirection: "row", justifyContent: "space-between", marginTop: 2, gap: 4 },
  rowLeft: { flexDirection: "row", gap: 3, flex: 1 },
  rowLabel: { fontSize: 7, color: T.ink2 },
  tag: { fontSize: 5.5, color: T.ink3, textTransform: "uppercase", letterSpacing: 0.3 },
  rowValue: { fontSize: 7, color: T.ink },
  liabLine: { flexDirection: "row", justifyContent: "space-between", marginTop: 1, paddingLeft: 6 },
  liabValue: { fontSize: 6.5, color: T.crit },
  netLine: { fontSize: 6.5, color: T.ink3, textAlign: "right", marginTop: 1 },
  totalFooter: { flexDirection: "row", justifyContent: "space-between", backgroundColor: T.paper, borderRadius: 3, padding: 5, marginTop: 4 },
  totalLabel: { fontSize: 8, color: T.ink2, textTransform: "uppercase", letterSpacing: 0.5 },
  totalValue: { fontSize: 10, color: T.ink, fontFamily: "Inter" },
  empty: { fontSize: 8, color: T.ink3, marginTop: 10 },
  box: { borderWidth: 0.5, borderColor: T.hair2, borderRadius: BOX_RADIUS, marginBottom: 4 },
  bandHead: {
    position: "relative",
    backgroundColor: TRACK,
    borderTopLeftRadius: BOX_RADIUS,
    borderTopRightRadius: BOX_RADIUS,
    paddingVertical: 3,
    paddingHorizontal: 5,
  },
  band: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    minWidth: 2,
    borderBottomWidth: 1.5,
    borderTopLeftRadius: BOX_RADIUS,
  },
  bandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 4 },
  bandLabel: { flex: 1, fontSize: 8, lineHeight: 1.15, fontWeight: 600, color: T.ink },
  bandFigure: { fontSize: 8.5, lineHeight: 1.15, fontWeight: 600, color: T.ink },
  netLabel: { fontSize: 6, fontWeight: 400, color: T.ink3 },
  bandSub: { flexDirection: "row", alignItems: "center", gap: 4 },
  bandShare: { fontSize: 6.5, lineHeight: 1.15, color: T.ink2 },
  bandPercent: { fontWeight: 600 },
  noPlanFlag: {
    fontSize: 5.5,
    fontWeight: 600,
    color: SHARE_COLOR.system_default.hue,
    backgroundColor: T.paper,
    borderWidth: 0.5,
    borderColor: SHARE_COLOR.system_default.hue,
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 0.5,
  },
  boxBody: { paddingHorizontal: 5, paddingTop: 2, paddingBottom: 3 },
  assetRow: { flexDirection: "row", alignItems: "baseline", gap: 5, marginTop: 1 },
  runStart: { marginTop: 3 },
  // Rows are set tight so two heirs' long lists and the tax box fit one page.
  assetName: { flex: 1, fontSize: 7, lineHeight: 1.1, color: T.ink2 },
  passesBy: { fontSize: 6, lineHeight: 1.1, color: T.ink3 },
  assetValue: { fontSize: 7, lineHeight: 1.1, color: T.ink2 },
  assetValueMuted: { color: T.ink3 },
  folded: { fontSize: 6.5, lineHeight: 1.1, color: T.ink3, marginTop: 2 },
  boxFoot: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: T.hair2,
    borderTopStyle: "dashed",
    marginTop: 3,
    paddingTop: 1,
  },
  footText: { fontSize: 6.5, lineHeight: 1.1, color: T.ink3 },
  taxRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 1 },
});

function OwnershipColumn({ data }: { data: EstateFlowReportData }) {
  return (
    <View style={styles.column}>
      <Text style={styles.colHead}>Ownership · {data.asOfYear}</Text>
      {data.ownership.groups.length === 0 ? (
        <Text style={styles.empty}>No assets.</Text>
      ) : (
        data.ownership.groups.map((g) => (
          <View key={g.key} style={styles.groupCard} wrap={false}>
            <View style={styles.groupHead}>
              <Text style={styles.groupLabel}>
                {g.label} <Text style={styles.groupKind}>{KIND_LABEL[g.kind]}</Text>
              </Text>
              <Text style={styles.groupSubtotal}>{fmt.format(g.subtotal)}</Text>
            </View>
            {g.assets.map((a) => (
              <View key={a.accountId}>
                <View style={styles.row}>
                  <View style={styles.rowLeft}>
                    <Text style={styles.rowLabel}>{a.name}</Text>
                    <Text style={styles.tag}>{fmtAccountType(a.accountType)}</Text>
                  </View>
                  <Text style={styles.rowValue}>{fmt.format(a.value)}</Text>
                </View>
                {a.linkedLiabilities.map((l) => (
                  <View key={l.liabilityId} style={styles.liabLine}>
                    <Text style={styles.rowLabel}>{l.name}</Text>
                    <Text style={styles.liabValue}>−{fmt.format(l.balance)}</Text>
                  </View>
                ))}
                {a.linkedLiabilities.length > 0 && (
                  <Text style={styles.netLine}>net {fmt.format(a.netValue)}</Text>
                )}
              </View>
            ))}
          </View>
        ))
      )}
      <View style={styles.totalFooter}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalValue}>{fmt.format(data.ownership.grandTotal)}</Text>
      </View>
    </View>
  );
}

/** A death-column box's header: the share band behind the label and figure,
 *  with the share in words underneath. */
function ShareHead({
  share,
  color,
  label,
  figure,
  shareOf,
  noPlan = false,
}: {
  /** Fraction of the column, 0–1. Zero draws no band. */
  share: number;
  color: ShareColor;
  label: string;
  figure: ReactNode;
  /** What the percent is a share of, e.g. "the total". */
  shareOf: string;
  noPlan?: boolean;
}) {
  const width = Math.min(share, 1);
  return (
    <View style={styles.bandHead}>
      {share > 0 && (
        <View
          style={[
            styles.band,
            {
              width: `${width * 100}%`,
              backgroundColor: color.tint,
              borderBottomColor: color.hue,
              borderTopRightRadius: width > 0.98 ? BOX_RADIUS : 0,
            },
          ]}
        />
      )}
      <View style={styles.bandRow}>
        <Text style={styles.bandLabel}>{label}</Text>
        <Text style={styles.bandFigure}>{figure}</Text>
      </View>
      <View style={styles.bandSub}>
        <Text style={styles.bandShare}>
          <Text style={[styles.bandPercent, { color: color.hue }]}>{percent(share)}</Text> of{" "}
          {shareOf}
        </Text>
        {noPlan && <Text style={styles.noPlanFlag}>No plan</Text>}
      </View>
    </View>
  );
}

/** One recipient, always open on paper: what they inherit in runs that pass
 *  the same way, accounts with no balance folded into a count, then what
 *  taxes, expenses and debts took. */
function RecipientBox({ group, share }: { group: RecipientGroup; share: number }) {
  const totalDrains = Object.values(group.drainsByKind).reduce((s, v) => s + v, 0);
  const hasReductions = Math.abs(totalDrains) >= 0.5;
  const rows = group.byMechanism.flatMap((m) =>
    m.assets.map((asset) => ({
      asset,
      mechanismLabel: SHORT_MECHANISM[m.mechanism] ?? m.mechanismLabel,
    })),
  );
  // Displays as $0.
  const shown = rows.filter((r) => Math.abs(r.asset.amount) >= 0.5);
  const emptyCount = rows.length - shown.length;
  return (
    <View style={styles.box} wrap={false}>
      <ShareHead
        share={share}
        color={SHARE_COLOR[group.recipientKind]}
        label={group.recipientLabel}
        figure={
          <>
            {hasReductions && <Text style={styles.netLabel}>net </Text>}
            {fmt.format(group.netTotal)}
          </>
        }
        shareOf="the total"
        noPlan={group.recipientKind === "system_default"}
      />
      <View style={styles.boxBody}>
        {shown.map(({ asset: a, mechanismLabel }, i) => {
          const runStart = i === 0 || shown[i - 1].mechanismLabel !== mechanismLabel;
          return (
            <View
              key={`${a.sourceAccountId ?? a.sourceLiabilityId ?? "x"}-${i}`}
              style={runStart && i > 0 ? [styles.assetRow, styles.runStart] : styles.assetRow}
            >
              <Text style={styles.assetName}>{a.label}</Text>
              {runStart && <Text style={styles.passesBy}>{mechanismLabel}</Text>}
              <Text style={a.amount > 0 ? styles.assetValue : [styles.assetValue, styles.assetValueMuted]}>
                {signed(a.amount)}
              </Text>
            </View>
          );
        })}
        {emptyCount > 0 && (
          <Text style={styles.folded}>
            plus {emptyCount} account{emptyCount === 1 ? "" : "s"} with no balance
          </Text>
        )}
        {hasReductions && (
          // One line, not the screen's two, so long columns keep to one page.
          <View style={styles.boxFoot}>
            <Text style={styles.footText}>Gross {fmt.format(group.total)}</Text>
            <Text style={styles.footText}>Taxes, expenses and debts {signed(-totalDrains)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

/** The foot of a death column: this death's projected tax, banded to its
 *  share of the estate at death like the recipient boxes above it. */
function TaxBox({ tax, estateAtDeath }: { tax: EstateFlowDeathTax; estateAtDeath: number }) {
  const lines = [
    { label: "Federal estate tax", amount: tax.federal },
    { label: "State estate tax", amount: tax.state },
    ...(tax.inheritance > 0 ? [{ label: "State inheritance tax", amount: tax.inheritance }] : []),
    { label: "Income tax (IRD)", amount: tax.ird },
  ];
  const total = lines.reduce((s, line) => s + line.amount, 0);
  return (
    <View style={styles.box} wrap={false}>
      <ShareHead
        share={estateAtDeath > 0 ? total / estateAtDeath : 0}
        color={TAX_COLOR}
        label="Projected tax"
        figure={fmt.format(total)}
        shareOf="the estate"
      />
      <View style={styles.boxBody}>
        {lines.map((line) => (
          <View key={line.label} style={styles.taxRow}>
            <Text style={styles.footText}>{line.label}</Text>
            <Text style={styles.assetValue}>{fmt.format(line.amount)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function DeathColumn({
  section,
  ordinal,
}: {
  section: EstateFlowDeathColumnData | null;
  ordinal: "First" | "Second";
}) {
  if (!section) {
    return (
      <View style={styles.column}>
        <Text style={styles.colHead}>{ordinal} to die</Text>
        <Text style={styles.empty}>No {ordinal.toLowerCase()} death projected.</Text>
      </View>
    );
  }
  // Taxes have their own box at the foot of the column; the gap between gross
  // and net also carries debts paid, so the strip shows no tax figure.
  const gross = estateAtDeathOf(section);
  const net = netToRecipientsOf(section);
  // Each band is a recipient's share of what the column's recipients net.
  const shareBase = section.recipients.reduce((s, g) => s + Math.max(0, g.netTotal), 0);
  return (
    <View style={styles.column}>
      <View style={styles.colHeadRow}>
        <Text style={styles.colHead}>
          {section.decedentName} — {ordinal} to die
        </Text>
        <Text style={styles.colYear}>{section.year}</Text>
      </View>
      <View style={styles.totalsStrip}>
        <Text style={styles.stripText}>Gross {fmt.format(gross)}</Text>
        <Text style={styles.stripNet}>Net {fmt.format(net)}</Text>
      </View>
      {section.recipients.length === 0 ? (
        <Text style={styles.empty}>No transfers in this death event.</Text>
      ) : (
        section.recipients.map((group) => (
          <RecipientBox
            key={group.key}
            group={group}
            share={shareBase > 0 ? Math.max(0, group.netTotal) / shareBase : 0}
          />
        ))
      )}
      <TaxBox tax={section.tax} estateAtDeath={gross} />
    </View>
  );
}

export function EstateFlowReportPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
}: {
  data: EstateFlowReportData;
  firmName: string;
  clientName: string;
  reportDate: string;
  pageIndex: number;
  totalPages: number;
}) {
  return (
    <PageFrame
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
      orientation="landscape"
    >
      <Text style={styles.title}>{data.title}</Text>
      <Text style={styles.subtitle}>{data.subtitle}</Text>
      <View style={styles.columns}>
        <OwnershipColumn data={data} />
        <DeathColumn section={data.firstColumn} ordinal="First" />
        <DeathColumn section={data.secondColumn} ordinal="Second" />
      </View>
    </PageFrame>
  );
}
