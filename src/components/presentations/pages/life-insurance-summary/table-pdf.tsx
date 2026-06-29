// src/components/presentations/pages/life-insurance-summary/table-pdf.tsx
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { LiPolicyRow } from "@/lib/insurance-policies/load-li-inventory";
import { fmtUsd, termExpiryLabel, POLICY_TYPE_LABEL } from "@/lib/presentations/pages/life-insurance-summary/aggregate";

const s = StyleSheet.create({
  table: { borderWidth: 1, borderColor: T.hair2, borderRadius: 3, overflow: "hidden" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: T.hair2, paddingVertical: 3, paddingHorizontal: 5 },
  head: { backgroundColor: T.paper, borderBottomWidth: 1 },
  hCell: { fontSize: 6, fontWeight: 700, color: T.ink2, textTransform: "uppercase", letterSpacing: 0.3 },
  cell: { fontSize: 8, color: T.ink },
  cName: { flex: 2.2 },
  cType: { flex: 1.1 },
  cOwner: { flex: 1 },
  cInsured: { flex: 1 },
  cNum: { flex: 1, textAlign: "right" },
  sub: { fontSize: 6.5, color: T.ink3 },
});

export function LiPolicyTablePdf({ policies }: { policies: LiPolicyRow[] }) {
  return (
    <View style={s.table}>
      <View style={[s.row, s.head]} fixed>
        <Text style={[s.hCell, s.cName]}>Policy / carrier</Text>
        <Text style={[s.hCell, s.cType]}>Type</Text>
        <Text style={[s.hCell, s.cOwner]}>Owner</Text>
        <Text style={[s.hCell, s.cInsured]}>Insured</Text>
        <Text style={[s.hCell, s.cNum]}>Death ben.</Text>
        <Text style={[s.hCell, s.cNum]}>Cash val.</Text>
        <Text style={[s.hCell, s.cNum]}>Premium</Text>
        <Text style={[s.hCell, s.cNum]}>Expiry</Text>
      </View>
      {policies.map((p) => (
        <View style={s.row} key={p.accountId} wrap={false}>
          <View style={s.cName}>
            <Text style={s.cell}>{p.name}</Text>
            {p.carrier ? <Text style={s.sub}>{p.carrier}</Text> : null}
          </View>
          <Text style={[s.cell, s.cType]}>{POLICY_TYPE_LABEL[p.policyType]}</Text>
          <Text style={[s.cell, s.cOwner]}>{p.ownerLabel}</Text>
          <Text style={[s.cell, s.cInsured]}>{p.insuredLabel}</Text>
          <Text style={[s.cell, s.cNum]}>{fmtUsd(p.deathBenefit)}</Text>
          <Text style={[s.cell, s.cNum]}>{p.cashValue > 0 ? fmtUsd(p.cashValue) : "—"}</Text>
          <Text style={[s.cell, s.cNum]}>{fmtUsd(p.premiumAmount)}</Text>
          <Text style={[s.cell, s.cNum]}>{termExpiryLabel(p)}</Text>
        </View>
      ))}
    </View>
  );
}
