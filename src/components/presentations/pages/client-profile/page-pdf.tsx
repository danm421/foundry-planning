import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type {
  ClientProfilePageData,
  ProfileChildCard,
  ProfileExpenseRow,
  ProfileIncomeRow,
  ProfilePersonCard,
} from "@/lib/presentations/pages/client-profile/types";
import { PRESENTATION_THEME, type SectionAccent } from "@/lib/presentations/theme";
import { exactCurrency } from "@/lib/presentations/format";
import { PageFrame } from "../../shared/page-frame";
import { SectionHead } from "../../shared/section-head";

const styles = StyleSheet.create({
  // Person cards
  personRow: { flexDirection: "row", gap: 16, marginBottom: 18 },
  personRowSingle: { flexDirection: "row", justifyContent: "center", marginBottom: 18 },
  personCard: {
    backgroundColor: PRESENTATION_THEME.card,
    borderWidth: 0.5,
    borderColor: PRESENTATION_THEME.hair2,
    borderRadius: 4,
    padding: 14,
  },
  personName: { fontFamily: "Fraunces", fontSize: 15, fontWeight: 600, color: PRESENTATION_THEME.ink, marginBottom: 8 },
  fieldRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  fieldLabel: { fontFamily: "Inter", fontSize: 8, color: PRESENTATION_THEME.ink3 },
  fieldValue: { fontFamily: "Inter", fontSize: 9, color: PRESENTATION_THEME.ink },

  // Children cards
  childGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10, marginBottom: 20 },
  childCard: {
    width: "22%",
    backgroundColor: PRESENTATION_THEME.card,
    borderWidth: 0.5,
    borderColor: PRESENTATION_THEME.hair2,
    borderRadius: 4,
    padding: 8,
  },
  childName: { fontFamily: "Inter", fontSize: 9, fontWeight: 600, color: PRESENTATION_THEME.ink, marginBottom: 2 },
  childDob: { fontFamily: "Inter", fontSize: 8, color: PRESENTATION_THEME.ink2 },

  // Tables
  sectionLabel: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PRESENTATION_THEME.accent,
    letterSpacing: 0.4,
    marginTop: 6,
    marginBottom: 4,
  },
  table: { marginBottom: 16 },
  headerRow: {
    flexDirection: "row",
    backgroundColor: PRESENTATION_THEME.card,
    borderTopWidth: 1,
    borderTopColor: PRESENTATION_THEME.hair2,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderLeftColor: PRESENTATION_THEME.hair2,
    borderRightColor: PRESENTATION_THEME.hair2,
    borderBottomWidth: 1,
    borderBottomColor: PRESENTATION_THEME.accent,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  dataRow: {
    flexDirection: "row",
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderLeftColor: PRESENTATION_THEME.hair2,
    borderRightColor: PRESENTATION_THEME.hair2,
    borderBottomWidth: 0.5,
    borderBottomColor: PRESENTATION_THEME.hair2,
    paddingVertical: 3,
    paddingHorizontal: 2,
  },
  th: { fontFamily: "Inter", fontSize: 8, fontWeight: 700, color: PRESENTATION_THEME.ink },
  td: { fontFamily: "Inter", fontSize: 9, color: PRESENTATION_THEME.ink2 },
  tdStrong: { fontFamily: "Inter", fontSize: 9, fontWeight: 700, color: PRESENTATION_THEME.ink },
  right: { textAlign: "right" },
});

function mmddyyyy(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

function ageParen(value: number | null, year: number | null): string {
  if (value == null) return "—";
  return year != null ? `${value} (${year})` : String(value);
}

function PersonCard({ p }: { p: ProfilePersonCard }) {
  return (
    <View style={styles.personCard}>
      <Text style={styles.personName}>{p.name}</Text>
      <View style={styles.fieldRow}>
        <Text style={styles.fieldLabel}>DOB (Age)</Text>
        <Text style={styles.fieldValue}>{p.dob ? `${mmddyyyy(p.dob)}${p.age != null ? ` (${p.age})` : ""}` : "—"}</Text>
      </View>
      <View style={styles.fieldRow}>
        <Text style={styles.fieldLabel}>Retirement</Text>
        <Text style={styles.fieldValue}>{ageParen(p.retirementAge, p.retirementYear)}</Text>
      </View>
      <View style={styles.fieldRow}>
        <Text style={styles.fieldLabel}>Life Expectancy</Text>
        <Text style={styles.fieldValue}>{ageParen(p.lifeExpectancyAge, p.lifeExpectancyYear)}</Text>
      </View>
    </View>
  );
}

function ChildCard({ c }: { c: ProfileChildCard }) {
  return (
    <View style={styles.childCard}>
      <Text style={styles.childName}>{c.name}</Text>
      <Text style={styles.childDob}>{c.dob ? `${mmddyyyy(c.dob)}${c.age != null ? ` (${c.age})` : ""}` : "—"}</Text>
    </View>
  );
}

function IncomeTable({ rows }: { rows: ProfileIncomeRow[] }) {
  return (
    <View style={styles.table}>
      <View style={styles.headerRow}>
        <Text style={[styles.th, { flex: 2 }]}>Name</Text>
        <Text style={[styles.th, { flex: 1.4 }]}>Type</Text>
        <Text style={[styles.th, { flex: 1 }, styles.right]}>Amount</Text>
        <Text style={[styles.th, { width: 50 }, styles.right]}>Start</Text>
        <Text style={[styles.th, { width: 40 }, styles.right]}>End</Text>
      </View>
      {rows.map((r, i) => (
        <View key={`${r.name}-${i}`} style={styles.dataRow} wrap={false}>
          <Text style={[styles.td, { flex: 2 }]}>{r.name}</Text>
          <Text style={[styles.td, { flex: 1.4 }]}>{r.typeLabel}</Text>
          <Text style={[styles.td, { flex: 1 }, styles.right]}>{exactCurrency(r.amount)}</Text>
          <Text style={[styles.td, { width: 50 }, styles.right]}>{r.active ? "Active" : String(r.startYear)}</Text>
          <Text style={[styles.td, { width: 40 }, styles.right]}>{r.endYear == null ? "—" : String(r.endYear)}</Text>
        </View>
      ))}
    </View>
  );
}

function ExpenseTable({ rows }: { rows: ProfileExpenseRow[] }) {
  return (
    <View style={styles.table}>
      <View style={styles.headerRow}>
        <Text style={[styles.th, { flex: 2 }]}>Name</Text>
        <Text style={[styles.th, { flex: 1 }, styles.right]}>Current</Text>
        <Text style={[styles.th, { flex: 1 }, styles.right]}>Retirement</Text>
      </View>
      {rows.map((r, i) => {
        const cell = r.isTotal ? styles.tdStrong : styles.td;
        return (
          <View key={`${r.label}-${i}`} style={styles.dataRow} wrap={false}>
            <Text style={[cell, { flex: 2 }]}>{r.label}</Text>
            <Text style={[cell, { flex: 1 }, styles.right]}>{exactCurrency(r.current)}</Text>
            <Text style={[cell, { flex: 1 }, styles.right]}>{exactCurrency(r.retirement)}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function ClientProfilePagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  accent,
}: {
  data: ClientProfilePageData;
  firmName: string;
  clientName: string;
  reportDate: string;
  pageIndex: number;
  totalPages: number;
  accent: SectionAccent;
}) {
  const single = data.persons.length === 1;
  return (
    <PageFrame
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
    >
      <SectionHead title={data.title} subtitle={data.subtitle} accent={accent} />

      <View style={single ? styles.personRowSingle : styles.personRow}>
        {data.persons.map((p, i) => (
          <View key={i} style={single ? { width: "48%" } : { flex: 1 }}>
            <PersonCard p={p} />
          </View>
        ))}
      </View>

      {data.children.length > 0 && (
        <View style={styles.childGrid}>
          {data.children.map((c, i) => (
            <ChildCard key={i} c={c} />
          ))}
        </View>
      )}

      {data.income.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>INCOME SOURCES</Text>
          <IncomeTable rows={data.income} />
        </>
      )}

      {data.expenses.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>EXPENSES</Text>
          <ExpenseTable rows={data.expenses} />
        </>
      )}
    </PageFrame>
  );
}
