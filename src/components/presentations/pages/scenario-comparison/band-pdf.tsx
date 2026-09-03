import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { MONO } from "@/components/presentations/pages/retirement-comparison/chart-axis";
import type { TradeoffBand } from "@/lib/presentations/pages/scenario-comparison/types";

const s = StyleSheet.create({
  // NO marginBottom here. A trailing margin on the LAST band counts toward the
  // page break, and 0.3pt is enough to spill a third sheet. The parent owns the
  // spacing between bands.
  band: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderRadius: 3, padding: 8 },
  head: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  rule: { width: 3, height: 12, borderRadius: 1.5, marginRight: 6 },
  name: { fontSize: 9.5, fontWeight: 700, color: T.ink, flex: 1 },
  chip: { marginLeft: 8, alignItems: "flex-end" },
  chipVal: { fontSize: 8, fontWeight: 600, color: T.ink, fontFamily: MONO },
  chipDelta: { fontSize: 6, fontFamily: MONO },
  body: { flexDirection: "row", gap: 10 },
  left: { width: "36%" },
  right: { flex: 1 },
  h4: { fontSize: 6, color: T.ink2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 },
  // Capped for the same reason the narrative below is, and measured the same
  // way: change lines are capped at four ENTRIES, not at length, and four of
  // them wrapping to three lines each in this 36%-wide column takes the three
  // bands onto a second tradeoff sheet.
  changeLine: { fontSize: 7, color: T.ink2, lineHeight: 1.3, marginBottom: 1.5, maxLines: 2, textOverflow: "ellipsis" },
  more: { fontSize: 6.5, color: T.ink3, fontStyle: "italic" },
  // maxLines is a STYLE in react-pdf, not a prop. As a prop it is inert, and an
  // over-long narrative would silently push the band onto a third sheet. The
  // count comes from `narrativeMaxLines` — it scales with the number of bands
  // sharing the sheet, exactly as the sentence budget does.
  // ⚠️ `narrativeMaxLines` (view-model.ts, beside the sentence budget it has to
  // move with) was sized against THIS fontSize and lineHeight and the right
  // column's width. Changing any of the three without re-running
  // two-sheet-geometry.test.tsx is what spills a third sheet.
  narrative: { fontSize: 7.5, color: T.ink, lineHeight: 1.35, textOverflow: "ellipsis" },
  placeholder: { fontSize: 7.5, color: T.ink3, fontStyle: "italic" },
  // `gap` is load bearing: the two sides are flex: 1 with no gutter otherwise,
  // so a wrapping GAINS line ran straight into the COSTS label ("−$1.7M
  // lifetimeCOSTS −$32k assets at retirement").
  strip: { flexDirection: "row", gap: 10, marginTop: 6, paddingTop: 5, borderTopWidth: 0.5, borderTopColor: T.hair },
  stripLbl: { fontSize: 5.5, fontWeight: 700, letterSpacing: 0.4, marginRight: 5 },
  stripText: { fontSize: 6.5, color: T.ink2, flex: 1 },
});

function Side({ label, color, items }: {
  label: string; color: string; items: Array<{ label: string; amount: string }>;
}) {
  if (items.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flex: 1, alignItems: "baseline" }}>
      <Text style={[s.stripLbl, { color }]}>{label}</Text>
      <Text style={s.stripText}>
        {items.map((i) => `${i.amount} ${i.label.toLowerCase()}`).join(" · ")}
      </Text>
    </View>
  );
}

export function BandPdf({ band, maxLines }: { band: TradeoffBand; maxLines: number }) {
  return (
    <View style={s.band} wrap={false}>
      <View style={s.head}>
        <View style={[s.rule, { backgroundColor: band.color }]} />
        <Text style={s.name}>{band.name}</Text>
        {band.chips.map((c) => (
          <View key={c.label} style={s.chip}>
            <Text style={s.chipVal}>{c.value}</Text>
            {c.delta ? (
              <Text style={[s.chipDelta, {
                color: c.direction === 1 ? T.good : c.direction === -1 ? T.crit : T.ink3,
              }]}>{c.delta}</Text>
            ) : null}
          </View>
        ))}
      </View>

      <View style={s.body}>
        <View style={s.left}>
          <Text style={s.h4}>What changed</Text>
          {band.changeLines.length === 0 ? (
            <Text style={s.placeholder}>No changes recorded.</Text>
          ) : (
            band.changeLines.map((l, i) => (
              <Text key={i} style={s.changeLine}>{`• ${l}`}</Text>
            ))
          )}
          {band.moreChangeCount > 0 ? (
            <Text style={s.more}>{`+${band.moreChangeCount} more`}</Text>
          ) : null}
        </View>
        <View style={s.right}>
          {band.narrative ? (
            <Text style={[s.narrative, { maxLines }]}>{band.narrative}</Text>
          ) : (
            <Text style={s.placeholder}>Commentary will appear here once generated.</Text>
          )}
        </View>
      </View>

      {band.gains.length > 0 || band.costs.length > 0 ? (
        <View style={s.strip}>
          <Side label="GAINS" color={T.good} items={band.gains} />
          <Side label="COSTS" color={T.crit} items={band.costs} />
        </View>
      ) : null}
    </View>
  );
}
