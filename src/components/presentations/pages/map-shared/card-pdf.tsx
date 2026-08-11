import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";
import { MAP_CATEGORY_HEX } from "@/lib/presentations/pages/household-map/tokens";
import type { MapItem } from "@/lib/household-map/types";

/**
 * One Household Map card, in print. The paper twin of
 * `components/household-map/map-card.tsx`: category-coloured left stripe, name,
 * at most one chip, and the value.
 *
 * Everything interactive on the board is gone — the pencil, the inline value
 * editor, the growth-rate cell, the "+ add" placeholders. None of them is
 * information; each is an affordance, and a printed affordance is a lie. What
 * survives is what a card SAYS.
 *
 * Chip precedence matches the board exactly: ownership context (tray owner,
 * uneven split) wins over the free-form note, because an item sitting in the
 * tray or on a 60/40 split has to explain itself before it explains anything
 * else.
 */
const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: PRESENTATION_THEME.card,
    borderWidth: 0.5,
    borderColor: PRESENTATION_THEME.hair,
    borderLeftWidth: 2.5,
    borderRadius: 3,
    paddingVertical: 4,
    paddingHorizontal: 6,
    // The gap between cards, not the card's own breathing room — 1pt off the gap
    // is invisible (every card is a bordered, filled block) and it is the only
    // slack that SCALES with the column, which is where the pressure is: a
    // twelve-row board reclaims 12pt, enough to keep its summary row off a page
    // of its own. Take it out of `paddingVertical` instead and the cards look
    // squeezed for the same points.
    marginBottom: 2,
  },
  body: { flex: 1 },
  name: { fontFamily: "Inter", fontSize: 7.5, fontWeight: 500, color: PRESENTATION_THEME.ink },
  chip: { fontFamily: "Inter", fontSize: 6, color: PRESENTATION_THEME.ink3, marginTop: 1 },
  trailing: { flexDirection: "row", alignItems: "center", gap: 5 },
  meta: {
    fontFamily: "JetBrains Mono",
    fontSize: 6,
    color: PRESENTATION_THEME.ink3,
    textAlign: "right",
  },
  value: {
    fontFamily: "JetBrains Mono",
    fontSize: 7.5,
    fontWeight: 700,
    color: PRESENTATION_THEME.ink2,
    textAlign: "right",
  },
});

/** "2026-2060", a single year when the window is one year wide, or the row's
 *  own note when it has one. Mirrors `timingLabel` in `cash-flow-board.tsx`:
 *  Social Security's persisted years are inert, so an unclaimed benefit prints
 *  "at 70" rather than a range the projection never uses. */
function timingLabel(item: MapItem): string | null {
  const t = item.timing;
  if (!t) return null;
  if (t.startsAt) return t.startsAt.label;
  return t.startYear === t.endYear ? String(t.startYear) : `${t.startYear}-${t.endYear}`;
}

export function MapCardPdf({ item, showTiming = false }: { item: MapItem; showTiming?: boolean }) {
  const chip = item.trayOwnerLabel ?? item.splitChip ?? item.noteChip;
  const timing = showTiming ? timingLabel(item) : null;
  return (
    <View style={[styles.card, { borderLeftColor: MAP_CATEGORY_HEX[item.category] }]} wrap={false}>
      <View style={styles.body}>
        <Text style={styles.name}>{item.name}</Text>
        {chip ? <Text style={styles.chip}>{chip}</Text> : null}
      </View>
      <View style={styles.trailing}>
        {timing ? <Text style={styles.meta}>{timing}</Text> : null}
        <Text style={styles.value}>{item.valueLabel}</Text>
      </View>
    </View>
  );
}

/** The tray both board pages carry, three cards to a row — the same three-up
 *  grid both boards use on screen. */
export function MapTrayPdf({
  label,
  cards,
  showTiming = false,
}: {
  label: string;
  cards: MapItem[];
  showTiming?: boolean;
}) {
  // `wrap={false}`: the grid below is a `flexWrap` ROW, and react-pdf cannot
  // split one — asked to, it prints the label at the foot of the page and draws
  // the cards straight through the footer band (Martin's Net Worth did exactly
  // that). Moving the tray whole to the next page is the only clean break, and
  // it takes the summary row with it, so the summary stops landing alone.
  return (
    <View style={trayStyles.wrap} wrap={false}>
      <Text style={trayStyles.label}>{label}</Text>
      <View style={trayStyles.grid}>
        {cards.map((c) => (
          <View key={c.id} style={trayStyles.cell}>
            <MapCardPdf item={c} showTiming={showTiming} />
          </View>
        ))}
      </View>
    </View>
  );
}

const trayStyles = StyleSheet.create({
  wrap: {
    marginTop: 6,
    borderTopWidth: 0.5,
    borderTopColor: PRESENTATION_THEME.hair2,
    paddingTop: 5,
  },
  label: {
    fontFamily: "JetBrains Mono",
    fontSize: 6.5,
    letterSpacing: 0.4,
    color: PRESENTATION_THEME.ink3,
    marginBottom: 4,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  // Three up. `gap: 6` eats 12pt across the row, so each cell claims a hair
  // under a third — a flat 33.33% overflows and drops the third card to its own
  // line.
  cell: { width: "32%" },
});
