// src/components/comparison-pdf/widgets/client-profile.tsx
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "@/components/pdf/theme";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { McSharedResult } from "@/lib/comparison/widgets/types";
import type { CellSpan, YearRange } from "@/lib/comparison/layout-schema";
import type { BrandingResolved } from "@/lib/comparison-pdf/branding";

const s = StyleSheet.create({
  wrap: { padding: 6 },
  card: { borderWidth: 0.5, borderColor: PDF_THEME.hair, padding: 10 },
  row: { flexDirection: "row", flexWrap: "wrap" },
  field: { width: "33%", paddingVertical: 3 },
  label: { fontFamily: "JetBrains Mono", fontSize: 7, color: PDF_THEME.ink3 },
  value: { fontFamily: "Inter", fontSize: 10, color: PDF_THEME.ink, marginTop: 1 },
  empty: { fontFamily: "JetBrains Mono", fontSize: 9, color: PDF_THEME.ink3 },
});

const SPAN_WIDTH: Record<CellSpan, string> = { 1: "20%", 2: "40%", 3: "60%", 4: "80%", 5: "100%" };

interface Props {
  config: unknown;
  plans: ComparisonPlan[];
  mc: McSharedResult | null;
  yearRange: YearRange | null;
  span: CellSpan;
  branding: BrandingResolved;
}

function birthYear(dob: string | undefined | null): number | null {
  if (!dob) return null;
  const y = new Date(dob).getFullYear();
  return Number.isFinite(y) ? y : null;
}

export function ClientProfilePdf({ plans, span }: Props) {
  const plan = plans[0];
  if (!plan) {
    return (
      <View style={[s.wrap, { width: SPAN_WIDTH[span] }]}>
        <Text style={s.empty}>(no plan bound)</Text>
      </View>
    );
  }
  const c = plan.tree.client;
  const ps = plan.tree.planSettings;
  const now = new Date().getFullYear();
  const cb = birthYear(c.dateOfBirth);
  const sb = birthYear(c.spouseDob);
  const filing = c.filingStatus.replace(/_/g, " ");

  return (
    <View style={[s.wrap, { width: SPAN_WIDTH[span] }]}>
      <View style={s.card}>
        <View style={s.row}>
          <Field label="Client" value={`${c.firstName} ${c.lastName}`.trim()} />
          {cb !== null && <Field label="Age" value={String(now - cb)} />}
          <Field label="Retires" value={cb !== null ? String(cb + c.retirementAge) : "—"} />
          {c.spouseName && <Field label="Spouse" value={c.spouseName} />}
          {sb !== null && <Field label="Spouse age" value={String(now - sb)} />}
          {c.spouseRetirementAge != null && sb !== null && (
            <Field label="Spouse retires" value={String(sb + c.spouseRetirementAge)} />
          )}
          <Field label="Filing" value={filing} />
          <Field label="State" value={ps.residenceState ?? "—"} />
          <Field label="Plan end" value={`age ${c.planEndAge}`} />
        </View>
      </View>
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label.toUpperCase()}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}
