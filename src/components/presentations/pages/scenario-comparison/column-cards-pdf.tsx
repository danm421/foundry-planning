import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { ColumnHeader } from "@/lib/presentations/pages/scenario-comparison/types";
import { LABEL_COL_W, VALUE_COL_W } from "./geom";

const METER_W = VALUE_COL_W - 16;

const s = StyleSheet.create({
  row: { flexDirection: "row", marginBottom: 8 },
  spacer: { width: LABEL_COL_W },
  card: { width: VALUE_COL_W, paddingRight: 8 },
  rule: { height: 3, borderRadius: 1.5, marginBottom: 5 },
  name: { fontSize: 8.5, fontWeight: 700, color: T.ink, lineHeight: 1.15 },
  desc: { fontSize: 6.5, color: T.ink3, lineHeight: 1.25, marginTop: 3 },
  meterTrack: { width: METER_W, height: 4, backgroundColor: T.hair, borderRadius: 2, marginTop: 5 },
  meterFill: { height: 4, borderRadius: 2 },
  // Drawn on top of the track so every column reads against the same reference
  // without needing a legend.
  meterTick: { position: "absolute", top: -1, width: 0.75, height: 6, backgroundColor: T.ink2 },
  conf: { fontSize: 10, fontWeight: 600, color: T.ink, marginTop: 3 },
  badge: { fontSize: 5.5, color: T.ink2, marginTop: 2 },
});

export function ColumnCardsPdf({ columns }: { columns: ColumnHeader[] }) {
  const baseConfidence = columns[0]?.confidence ?? null;
  return (
    <View style={s.row}>
      <View style={s.spacer} />
      {columns.map((c) => (
        <View key={c.refKey} style={s.card}>
          <View style={[s.rule, { backgroundColor: c.color }]} />
          <Text style={s.name}>{c.name}</Text>
          {c.descriptor.map((d, i) => (
            <Text key={i} style={s.desc}>{d}</Text>
          ))}
          <View style={s.meterTrack}>
            <View
              style={[s.meterFill, {
                width: METER_W * (c.confidence ?? 0),
                backgroundColor: c.color,
              }]}
            />
            {baseConfidence != null ? (
              <View style={[s.meterTick, { left: METER_W * baseConfidence }]} />
            ) : null}
          </View>
          <Text style={s.conf}>
            {c.confidence == null ? "—" : `${Math.round(c.confidence * 100)}%`}
          </Text>
          {c.badges.map((b) => (
            <Text key={b} style={s.badge}>{`◆ ${b}`}</Text>
          ))}
        </View>
      ))}
    </View>
  );
}
