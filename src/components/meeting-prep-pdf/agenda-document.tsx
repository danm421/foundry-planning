// src/components/meeting-prep-pdf/agenda-document.tsx
//
// CLIENT-FACING meeting agenda. Uses the white-label presentation theme
// (PRESENTATION_THEME — firm-neutral light/print) so it reads as the advisor's
// own document. Deliberately narrow: agenda items, a portfolio-at-a-glance that
// shows ONLY category totals + the grand total (never account rows, alerts, or
// internal vitals), and ruled note lines. Single-page target.
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";
import type { MeetingPrepPdfModel } from "./view-model";
import type { AgendaDraft } from "@/lib/crm/meeting-prep/schemas";

const TH = PRESENTATION_THEME;
const NOTE_LINES = 6;

// react-pdf never breaks a single long token — clamp oversized words so a
// pasted slug can't overflow its cell.
function clampToken(value: string, max: number): string {
  return value
    .split(/\s+/)
    .map((w) => (w.length > max ? `${w.slice(0, max - 1)}…` : w))
    .join(" ");
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: TH.paper,
    paddingVertical: 44,
    paddingHorizontal: 48,
    color: TH.ink,
    fontFamily: "Helvetica",
    fontSize: 11,
    lineHeight: 1.5,
  },
  // Branded header.
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: TH.accent,
    paddingBottom: 14,
    marginBottom: 22,
  },
  headerLeft: { flexDirection: "column" },
  logo: { height: 26, marginBottom: 10, objectFit: "contain" },
  eyebrow: {
    fontFamily: "Courier",
    fontSize: 8,
    letterSpacing: 1.5,
    color: TH.accent,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  title: { fontSize: 24, fontWeight: "bold", color: TH.ink },
  household: { fontSize: 13, color: TH.ink2, marginTop: 3 },
  headerRight: { flexDirection: "column", alignItems: "flex-end" },
  metaLabel: { fontSize: 8, textTransform: "uppercase", letterSpacing: 0.6, color: TH.ink3 },
  metaValue: { fontFamily: "Courier", fontSize: 11, color: TH.ink, marginBottom: 6 },
  metaValueText: { fontSize: 11, color: TH.ink, marginBottom: 6 },
  // Sections.
  sectionTitle: {
    fontSize: 10,
    fontWeight: "bold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: TH.ink2,
    marginBottom: 12,
  },
  // Agenda items.
  agendaItem: { flexDirection: "row", marginBottom: 14, gap: 12 },
  agendaNumber: {
    fontFamily: "Courier",
    fontSize: 13,
    fontWeight: "bold",
    color: TH.accent,
    width: 22,
  },
  agendaBody: { flex: 1 },
  agendaTitle: { fontSize: 12, fontWeight: "bold", color: TH.ink },
  agendaDesc: { fontSize: 10.5, color: TH.ink2, marginTop: 2 },
  // Glance panel.
  glancePanel: {
    borderWidth: 1,
    borderColor: TH.hair2,
    backgroundColor: TH.card,
    borderRadius: 6,
    padding: 14,
    marginTop: 8,
    marginBottom: 22,
  },
  glanceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: TH.hair,
  },
  glanceLabel: { fontSize: 11, color: TH.ink2 },
  glanceValue: { fontFamily: "Courier", fontSize: 11, color: TH.ink },
  glanceTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 10,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: TH.hair2,
  },
  glanceTotalLabel: { fontSize: 11, fontWeight: "bold", textTransform: "uppercase", letterSpacing: 0.5, color: TH.ink },
  glanceTotalValue: { fontFamily: "Courier", fontSize: 15, fontWeight: "bold", color: TH.ink },
  // Notes.
  noteLine: {
    borderBottomWidth: 1,
    borderBottomColor: TH.hair2,
    height: 26,
  },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 48,
    right: 48,
    fontSize: 8,
    color: TH.ink3,
    textAlign: "center",
  },
});

export function AgendaDocument({
  model,
  draft,
  logoDataUrl,
}: {
  model: MeetingPrepPdfModel;
  draft: AgendaDraft;
  logoDataUrl: string | null;
}) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Branded header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            {logoDataUrl && <Image src={logoDataUrl} style={styles.logo} />}
            <Text style={styles.eyebrow}>Meeting Agenda</Text>
            <Text style={styles.title}>Our conversation</Text>
            <Text style={styles.household}>{clampToken(model.householdName, 40)}</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.metaLabel}>Date</Text>
            <Text style={styles.metaValue}>{model.meetingDate}</Text>
            {model.preparedBy && (
              <>
                <Text style={styles.metaLabel}>Advisor</Text>
                <Text style={styles.metaValueText}>{clampToken(model.preparedBy, 30)}</Text>
              </>
            )}
          </View>
        </View>

        {/* Numbered agenda items */}
        <Text style={styles.sectionTitle}>{"What we'll cover"}</Text>
        {draft.agendaItems.map((item, i) => (
          <View key={i} style={styles.agendaItem}>
            <Text style={styles.agendaNumber}>{i + 1}.</Text>
            <View style={styles.agendaBody}>
              <Text style={styles.agendaTitle}>{clampToken(item.title, 60)}</Text>
              {item.description ? <Text style={styles.agendaDesc}>{clampToken(item.description, 80)}</Text> : null}
            </View>
          </View>
        ))}

        {/* Portfolio at a glance — category totals + grand total ONLY.
            Gate on byCategory alone: totalDisplay is a formatted money string
            (money(0) === "$0") and is therefore always truthy, so it must
            never be used to decide whether the panel renders. */}
        {model.portfolio.byCategory.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Your portfolio at a glance</Text>
            <View style={styles.glancePanel}>
              {model.portfolio.byCategory.map((c, i) => (
                <View key={i} style={styles.glanceRow}>
                  <Text style={styles.glanceLabel}>{clampToken(c.category, 40)}</Text>
                  <Text style={styles.glanceValue}>{c.totalDisplay}</Text>
                </View>
              ))}
              <View style={styles.glanceTotalRow}>
                <Text style={styles.glanceTotalLabel}>Total</Text>
                <Text style={styles.glanceTotalValue}>{model.portfolio.totalDisplay}</Text>
              </View>
            </View>
          </>
        )}

        {/* Notes — ruled lines */}
        <Text style={styles.sectionTitle}>Notes</Text>
        {Array.from({ length: NOTE_LINES }).map((_, i) => (
          <View key={i} style={styles.noteLine} />
        ))}

        <Text style={styles.footer}>
          {model.householdName} · Prepared {model.generatedAt}
        </Text>
      </Page>
    </Document>
  );
}
