// src/components/meeting-prep-pdf/prep-brief-document.tsx
//
// INTERNAL advisor prep brief. Light/print theme (balance-sheet PDF_THEME) —
// this is an advisor-only working document, not a client-facing report, so it
// carries a clear INTERNAL marking and can surface tasks, alerts, and vitals.
// Numbers render in a mono face (Courier) per the brand "numbers are mono" rule;
// built-in fonts keep the renderer dependency-free for the export route.
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../balance-sheet-report/tokens";
import type { MeetingPrepPdfModel } from "./view-model";
import type { PrepBriefDraft } from "@/lib/crm/meeting-prep/schemas";

// react-pdf never breaks a single long token (a pasted URL, a run-on custodian
// slug) — it overflows the fixed-width cell and bleeds into its neighbor. Clamp
// oversized tokens JS-side; the surrounding row still identifies the item.
function clampToken(value: string, max: number): string {
  const longest = value.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0);
  if (longest <= max) return value;
  return value
    .split(/\s+/)
    .map((w) => (w.length > max ? `${w.slice(0, max - 1)}…` : w))
    .join(" ");
}

const T = PDF_THEME.text;
const S = PDF_THEME.surface;
const DANGER = PDF_THEME.status.down.fg;

const styles = StyleSheet.create({
  page: {
    backgroundColor: S.page,
    paddingVertical: 36,
    paddingHorizontal: 40,
    color: T.primary,
    fontFamily: "Helvetica",
    fontSize: 10,
    lineHeight: 1.5,
  },
  // Header band — the INTERNAL marking + meeting identity.
  header: {
    backgroundColor: S.panelHeader,
    borderWidth: 1,
    borderColor: S.panelBorder,
    borderRadius: 4,
    padding: 12,
    marginBottom: 16,
  },
  eyebrowRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  eyebrow: {
    fontFamily: "Courier",
    fontSize: 8,
    letterSpacing: 1,
    color: T.muted,
  },
  internalTag: {
    fontFamily: "Courier",
    fontSize: 8,
    letterSpacing: 1,
    color: DANGER,
    borderWidth: 1,
    borderColor: PDF_THEME.status.down.border,
    backgroundColor: PDF_THEME.status.down.bg,
    borderRadius: 2,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  title: { fontSize: 17, fontWeight: "bold" },
  focus: { fontSize: 11, color: T.secondary, marginTop: 2 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 },
  meta: { fontSize: 8.5, color: T.muted },
  mono: { fontFamily: "Courier" },
  // Sections.
  section: { marginBottom: 14 },
  sectionTitle: {
    fontSize: 9,
    fontWeight: "bold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: T.secondary,
    borderBottomWidth: 1,
    borderBottomColor: S.divider,
    paddingBottom: 3,
    marginBottom: 6,
  },
  paragraph: { marginBottom: 5, color: T.primary },
  bulletRow: { flexDirection: "row", marginBottom: 3 },
  bulletMark: { width: 12, color: T.muted },
  bulletText: { flex: 1, color: T.primary },
  // Tasks.
  subLabel: { fontSize: 8, fontWeight: "bold", color: T.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4, marginBottom: 3 },
  taskRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 3, gap: 6 },
  taskMark: { width: 10, fontSize: 10 },
  taskTitle: { flex: 1 },
  taskMeta: { fontFamily: "Courier", fontSize: 8, color: T.muted },
  chip: {
    fontFamily: "Courier",
    fontSize: 7,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    borderWidth: 0.5,
    borderRadius: 2,
    paddingHorizontal: 3,
    paddingVertical: 0.5,
  },
  // Portfolio.
  vitalsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  vitalCard: {
    borderWidth: 1,
    borderColor: S.panelBorder,
    backgroundColor: S.panel,
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    minWidth: 110,
  },
  vitalLabel: { fontSize: 7.5, textTransform: "uppercase", letterSpacing: 0.4, color: T.muted },
  vitalValue: { fontFamily: "Courier", fontSize: 13, fontWeight: "bold", color: T.primary, marginTop: 2 },
  catRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  catLabel: { color: T.secondary },
  // Account table.
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: S.panelBorder,
    paddingBottom: 3,
    marginTop: 4,
  },
  th: { fontSize: 7.5, textTransform: "uppercase", letterSpacing: 0.4, color: T.muted },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: S.divider,
    paddingVertical: 2.5,
  },
  cName: { flex: 3 },
  cCat: { flex: 2, color: T.secondary },
  cCustodian: { flex: 2, color: T.muted },
  cBal: { flex: 2, fontFamily: "Courier", textAlign: "right" },
  cAsOf: { flex: 1.4, fontFamily: "Courier", fontSize: 8, color: T.muted, textAlign: "right" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: 5, marginTop: 2 },
  totalLabel: { fontSize: 9, fontWeight: "bold", textTransform: "uppercase", letterSpacing: 0.5 },
  totalValue: { fontFamily: "Courier", fontSize: 11, fontWeight: "bold" },
  // Alerts.
  alertRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  alertDot: { width: 6, height: 6, borderRadius: 3 },
  twoCol: { flexDirection: "row", gap: 20 },
  col: { flex: 1 },
  footer: {
    position: "absolute",
    bottom: 18,
    left: 40,
    right: 40,
    fontSize: 8,
    color: T.muted,
    textAlign: "center",
    fontFamily: "Courier",
  },
});

function priorityChipStyle(priority: string): { color: string; borderColor: string; backgroundColor: string } {
  const p = priority.toLowerCase();
  if (p === "high") return { color: PDF_THEME.status.down.fg, borderColor: PDF_THEME.status.down.border, backgroundColor: PDF_THEME.status.down.bg };
  if (p === "low") return { color: T.muted, borderColor: S.panelBorder, backgroundColor: S.panel };
  // medium / default
  return { color: PDF_THEME.status.flat.fg, borderColor: PDF_THEME.status.flat.border, backgroundColor: PDF_THEME.status.flat.bg };
}

function Bullets({ items }: { items: string[] }) {
  return (
    <>
      {items.map((item, i) => (
        <View key={i} style={styles.bulletRow}>
          <Text style={styles.bulletMark}>•</Text>
          <Text style={styles.bulletText}>{clampToken(item, 60)}</Text>
        </View>
      ))}
    </>
  );
}

export function PrepBriefDocument({ model, draft }: { model: MeetingPrepPdfModel; draft: PrepBriefDraft }) {
  const paragraphs = draft.briefing.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const hasTasks = model.completedTasks.length > 0 || model.outstandingTasks.length > 0;
  const hasPortfolio =
    model.vitals.length > 0 ||
    model.portfolio.byCategory.length > 0 ||
    model.portfolio.accounts.length > 0 ||
    model.alerts.length > 0;
  const hasTalking = draft.talkingPoints.length > 0 || draft.openQuestions.length > 0;

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header band */}
        <View style={styles.header}>
          <View style={styles.eyebrowRow}>
            <Text style={styles.eyebrow}>MEETING PREP</Text>
            <Text style={styles.internalTag}>INTERNAL — NOT FOR CLIENT</Text>
          </View>
          <Text style={styles.title}>{clampToken(model.householdName, 40)}</Text>
          <Text style={styles.focus}>{model.focus}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>
              Meeting <Text style={styles.mono}>{model.meetingDate}</Text>
            </Text>
            {model.lastMeetingDate && (
              <Text style={styles.meta}>
                {"  ·  "}Last meeting <Text style={styles.mono}>{model.lastMeetingDate}</Text>
              </Text>
            )}
            <Text style={styles.meta}>
              {"  ·  "}Client since <Text style={styles.mono}>{model.clientSince}</Text>
            </Text>
          </View>
          <View style={styles.metaRow}>
            {model.preparedBy && <Text style={styles.meta}>Prepared by {clampToken(model.preparedBy, 40)}</Text>}
            <Text style={styles.meta}>
              {model.preparedBy ? "  ·  " : ""}Generated <Text style={styles.mono}>{model.generatedAt}</Text>
            </Text>
          </View>
        </View>

        {/* Briefing */}
        {paragraphs.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Briefing</Text>
            {paragraphs.map((p, i) => (
              <Text key={i} style={styles.paragraph}>{p}</Text>
            ))}
          </View>
        )}

        {/* Since last meeting */}
        {draft.sinceLastMeeting.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Since last meeting</Text>
            <Bullets items={draft.sinceLastMeeting} />
          </View>
        )}

        {/* Tasks */}
        {hasTasks && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tasks</Text>
            {model.completedTasks.length > 0 && (
              <View>
                <Text style={styles.subLabel}>Completed</Text>
                {model.completedTasks.map((t, i) => (
                  <View key={i} style={styles.taskRow}>
                    <Text style={[styles.taskMark, { color: PDF_THEME.status.up.fg }]}>✓</Text>
                    <Text style={styles.taskTitle}>{clampToken(t.title, 60)}</Text>
                    {t.completedAt && <Text style={styles.taskMeta}>{t.completedAt}</Text>}
                  </View>
                ))}
              </View>
            )}
            {model.outstandingTasks.length > 0 && (
              <View>
                <Text style={styles.subLabel}>Outstanding</Text>
                {model.outstandingTasks.map((t, i) => (
                  <View key={i} style={styles.taskRow}>
                    <Text style={[styles.taskMark, { color: t.overdue ? DANGER : T.muted }]}>○</Text>
                    <Text style={[styles.taskTitle, t.overdue ? { color: DANGER } : {}]}>
                      {clampToken(t.title, 56)}
                    </Text>
                    <Text style={[styles.chip, priorityChipStyle(t.priority)]}>{t.priority}</Text>
                    {t.dueDate && (
                      <Text style={[styles.taskMeta, t.overdue ? { color: DANGER } : {}]}>
                        {t.overdue ? "overdue " : "due "}
                        {t.dueDate}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Portfolio snapshot */}
        {hasPortfolio && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Portfolio snapshot {model.portfolio.source === "crm" ? "(CRM records)" : "(planning)"}
            </Text>

            {model.vitals.length > 0 && (
              <View style={styles.vitalsRow}>
                {model.vitals.map((v, i) => (
                  <View key={i} style={styles.vitalCard}>
                    <Text style={styles.vitalLabel}>{v.label}</Text>
                    <Text style={styles.vitalValue}>{v.value}</Text>
                  </View>
                ))}
              </View>
            )}

            {model.portfolio.byCategory.length > 0 && (
              <View style={{ marginBottom: 6 }}>
                {model.portfolio.byCategory.map((c, i) => (
                  <View key={i} style={styles.catRow}>
                    <Text style={styles.catLabel}>{clampToken(c.category, 40)}</Text>
                    <Text style={styles.mono}>{c.totalDisplay}</Text>
                  </View>
                ))}
              </View>
            )}

            {model.portfolio.accounts.length > 0 && (
              <View>
                <View style={styles.tableHead}>
                  <Text style={[styles.th, styles.cName]}>Account</Text>
                  <Text style={[styles.th, styles.cCat]}>Category</Text>
                  <Text style={[styles.th, styles.cCustodian]}>Custodian</Text>
                  <Text style={[styles.th, styles.cBal]}>Balance</Text>
                  <Text style={[styles.th, styles.cAsOf]}>As of</Text>
                </View>
                {model.portfolio.accounts.map((a, i) => (
                  <View key={i} style={styles.tr}>
                    <Text style={styles.cName}>{clampToken(a.name, 34)}</Text>
                    <Text style={styles.cCat}>{clampToken(a.category, 24)}</Text>
                    <Text style={styles.cCustodian}>{a.custodian ? clampToken(a.custodian, 20) : "—"}</Text>
                    <Text style={styles.cBal}>{a.balanceDisplay}</Text>
                    <Text style={styles.cAsOf}>{a.balanceAsOf ?? "—"}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total portfolio</Text>
              <Text style={styles.totalValue}>{model.portfolio.totalDisplay}</Text>
            </View>

            {model.alerts.length > 0 && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.subLabel}>Alerts</Text>
                {model.alerts.map((al, i) => {
                  const c = al.severity === "critical" ? DANGER : PDF_THEME.status.flat.fg;
                  return (
                    <View key={i} style={styles.alertRow}>
                      <View style={[styles.alertDot, { backgroundColor: c }]} />
                      <Text style={{ color: c }}>{clampToken(al.title, 70)}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Talking points & open questions */}
        {hasTalking && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Talking points &amp; open questions</Text>
            <View style={styles.twoCol}>
              {draft.talkingPoints.length > 0 && (
                <View style={styles.col}>
                  <Text style={styles.subLabel}>Talking points</Text>
                  <Bullets items={draft.talkingPoints} />
                </View>
              )}
              {draft.openQuestions.length > 0 && (
                <View style={styles.col}>
                  <Text style={styles.subLabel}>Open questions</Text>
                  <Bullets items={draft.openQuestions} />
                </View>
              )}
            </View>
          </View>
        )}

        {/* Personal notes */}
        {draft.personalNotes.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Personal notes</Text>
            <Bullets items={draft.personalNotes} />
          </View>
        )}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `INTERNAL · ${model.householdName} · Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
