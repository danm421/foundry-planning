import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { ColumnHeader } from "@/lib/presentations/pages/scenario-comparison/types";
// The same formatter the Plan confidence row directly beneath this card uses
// (metrics.ts), so the card and the row can never print one number two ways.
import { fmtPct } from "@/lib/presentations/pages/scenario-comparison/format";
import { LABEL_COL_W, VALUE_COL_W } from "./geom";

const METER_W = VALUE_COL_W - 16;

/** The name is clamped to two lines and RESERVES both, so a one-line name and a
 *  two-line one start their descriptor on the same baseline instead of one
 *  column's sub-text sitting a line higher than its neighbour's.
 *
 *  It does NOT align the badges: below the name sit 1-3 descriptor entries
 *  (each itself two lines at most) and then 0-2 badges, so the bottom of a card
 *  is ragged by content, not by the name. Aligning those too would mean an
 *  equal-height card with `justifyContent: "space-between"`, the idiom
 *  retirement-comparison/page-pdf.tsx uses for exactly that. */
const NAME_SIZE = 8.5;
const NAME_LINE_H = 1.15;
const NAME_BOX_H = NAME_SIZE * NAME_LINE_H * 2;

const s = StyleSheet.create({
  row: { flexDirection: "row", marginBottom: 8 },
  spacer: { width: LABEL_COL_W },
  card: { width: VALUE_COL_W, paddingRight: 8 },
  rule: { height: 3, borderRadius: 1.5, marginBottom: 5 },
  // Both of these carry advisor-authored text out of `text` columns with no
  // length bound, into a 96pt card, and an unclamped card grows the whole of
  // sheet one. Measured (two-sheet-geometry.test.tsx): with the descriptor
  // wrapping to three lines per entry, sheet one breaks and the chart lands on
  // a sheet of its own — three sheets where the page count promises two.
  // `maxLines` is a STYLE in react-pdf, not a prop; as a prop it is inert.
  // The full text of both still prints on sheet two's band.
  name: {
    fontSize: NAME_SIZE, fontWeight: 700, color: T.ink, lineHeight: NAME_LINE_H,
    maxLines: 2, textOverflow: "ellipsis", marginTop: 5, minHeight: NAME_BOX_H,
  },
  desc: { fontSize: 6.5, color: T.ink3, lineHeight: 1.25, marginTop: 3, maxLines: 2, textOverflow: "ellipsis" },
  meterTrack: { width: METER_W, height: 4, backgroundColor: T.hair, borderRadius: 2, marginTop: 3 },
  meterFill: { height: 4, borderRadius: 2 },
  // Drawn on top of the track so every column reads against the same reference
  // without needing a legend.
  meterTick: { position: "absolute", top: -1, width: 0.75, height: 6, backgroundColor: T.ink2 },
  conf: { fontSize: 10, fontWeight: 600, color: T.ink },
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
          {/* Confidence sits ABOVE the name, not under it: the name is advisor
              text of unbounded length and wraps to a second line in some
              columns and not others, which used to leave the headline figure
              on a different baseline in every card. */}
          <Text style={s.conf}>{fmtPct(c.confidence)}</Text>
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
          <Text style={s.name}>{c.name}</Text>
          {c.descriptor.map((d, i) => (
            <Text key={i} style={s.desc}>{d}</Text>
          ))}
          {c.badges.map((b) => (
            <Text key={b} style={s.badge}>{`◆ ${b}`}</Text>
          ))}
        </View>
      ))}
    </View>
  );
}
