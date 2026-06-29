import { Text, View, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { PageFrame } from "../../shared/page-frame";
import type { EstateFlowReportData } from "@/lib/presentations/pages/estate-flow/view-model";
import type { DeathSectionData, RecipientGroup } from "@/lib/estate/transfer-report";
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
  reductFooter: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.5, borderTopColor: T.hair2, marginTop: 3, paddingTop: 2 },
  reductText: { fontSize: 6.5, color: T.ink2 },
  totalFooter: { flexDirection: "row", justifyContent: "space-between", backgroundColor: T.paper, borderRadius: 3, padding: 5, marginTop: 4 },
  totalLabel: { fontSize: 8, color: T.ink2, textTransform: "uppercase", letterSpacing: 0.5 },
  totalValue: { fontSize: 10, color: T.ink, fontFamily: "Inter" },
  empty: { fontSize: 8, color: T.ink3, marginTop: 10 },
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

function DeathColumn({
  section,
  ordinal,
}: {
  section: DeathSectionData | null;
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
  const gross = section.assetEstateValue + section.reconciliation.sumLiabilityTransfers;
  const tax = section.reconciliation.sumReductions;
  const net = section.reconciliation.sumRecipients;
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
        {tax > 0 && <Text style={styles.stripText}>− {fmt.format(tax)} taxes</Text>}
        <Text style={styles.stripNet}>Net {fmt.format(net)}</Text>
      </View>
      {section.recipients.length === 0 ? (
        <Text style={styles.empty}>No transfers in this death event.</Text>
      ) : (
        section.recipients.map((group) => {
          const drains = Object.values(group.drainsByKind).reduce((s, v) => s + v, 0);
          const hasReduct = Math.abs(drains) >= 0.5;
          return (
            <View key={group.key} style={styles.groupCard} wrap={false}>
              <View style={styles.groupHead}>
                <Text style={styles.groupLabel}>{group.recipientLabel}</Text>
                <Text style={styles.groupSubtotal}>{fmt.format(group.netTotal)}</Text>
              </View>
              {group.byMechanism
                .flatMap((m) =>
                  m.assets.map((a) => ({
                    a,
                    tag: SHORT_MECHANISM[m.mechanism] ?? m.mechanismLabel,
                  })),
                )
                .map(({ a, tag }, i) => (
                  <View key={`${a.sourceAccountId ?? a.sourceLiabilityId ?? "x"}-${i}`} style={styles.row}>
                    <View style={styles.rowLeft}>
                      <Text style={styles.rowLabel}>{a.label}</Text>
                      <Text style={styles.tag}>{tag}</Text>
                    </View>
                    <Text style={styles.rowValue}>{fmt.format(a.amount)}</Text>
                  </View>
                ))}
              {hasReduct && (
                <View style={styles.reductFooter}>
                  <Text style={styles.reductText}>
                    Gross {fmt.format(group.total)} − reductions {fmt.format(drains)}
                  </Text>
                  <Text style={styles.reductText}>{fmt.format(group.netTotal)}</Text>
                </View>
              )}
            </View>
          );
        })
      )}
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
