import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { PRESENTATION_THEME, type SectionAccent } from "@/lib/presentations/theme";
import { groupGoalsByYear } from "@/lib/household-map/goals";
import type { MapGoalRow, MapGoalsPageData } from "@/lib/presentations/pages/household-map/types";
import { PageFrame } from "../../shared/page-frame";
import { SectionHead } from "../../shared/section-head";

/**
 * The Goals board in print: a year spine with each goal's card hung off the
 * owner's side, joint goals straddling it.
 *
 * Portrait, unlike the other two Map pages. This board is a TIMELINE — it runs
 * from today to the later life expectancy, which is thirty-odd rows for a
 * typical household — and a landscape page would fit half as many before
 * breaking. The other two are wide grids; this one is tall.
 *
 * One row per YEAR, in the order `buildMapGoals` returns them (ascending), so
 * the page reads top-to-bottom as time. Everything in a year shares its one
 * year label: same-side cards stack in their column, and joint cards split a
 * centred band side by side.
 */
const YEAR_COLUMN = 74;

const styles = StyleSheet.create({
  headRow: { flexDirection: "row", alignItems: "flex-end", marginBottom: 8 },
  headSide: {
    flex: 1,
    fontFamily: "JetBrains Mono",
    fontSize: 7.5,
    letterSpacing: 0.5,
    color: PRESENTATION_THEME.ink2,
    textAlign: "center",
    borderBottomWidth: 1,
    paddingBottom: 3,
  },
  headSpine: { width: YEAR_COLUMN },

  yearGroup: { alignItems: "center", marginBottom: 7, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", alignSelf: "stretch" },
  side: { flex: 1, gap: 4 },
  // Solo: the one column is the whole page wide, so a year's cards share it
  // side by side, the same way joint cards share their band.
  soloCards: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 4 },
  soloCard: { flexGrow: 1, flexBasis: 0, minWidth: 140 },
  spine: { width: YEAR_COLUMN, alignItems: "center" },
  year: { fontFamily: "JetBrains Mono", fontSize: 9, fontWeight: 700, color: PRESENTATION_THEME.ink },
  ages: { fontFamily: "Inter", fontSize: 6.5, color: PRESENTATION_THEME.ink3 },

  card: {
    backgroundColor: PRESENTATION_THEME.card,
    borderWidth: 0.5,
    borderColor: PRESENTATION_THEME.hair,
    borderRadius: 3,
    paddingVertical: 4,
    paddingHorizontal: 7,
  },
  kind: {
    fontFamily: "JetBrains Mono",
    fontSize: 5.5,
    letterSpacing: 0.5,
    color: PRESENTATION_THEME.ink3,
  },
  title: { fontFamily: "Inter", fontSize: 8, fontWeight: 500, color: PRESENTATION_THEME.ink },
  detail: { fontFamily: "Inter", fontSize: 6.5, color: PRESENTATION_THEME.ink3, marginTop: 1 },

  // Several joint cards in one year split the band rather than each spanning
  // it; past three they wrap to a second line instead of shrinking illegibly.
  jointBand: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", width: "58%", gap: 4 },
  jointCard: { flexGrow: 1, flexBasis: 0, minWidth: 90 },

  note: {
    fontFamily: "Inter",
    fontSize: 8,
    color: PRESENTATION_THEME.ink3,
    textAlign: "center",
    marginBottom: 12,
  },
});

/**
 * One goal card. `side` drives which edge carries the kind's accent and which
 * way the text runs, so a client-side card reads toward the spine and a
 * spouse-side card reads away from it — the same mirroring the board does with
 * its border-r / border-l pair.
 */
function GoalCard({
  row,
  solo = false,
  style,
}: {
  row: MapGoalRow;
  solo?: boolean;
  style?: Style;
}) {
  // Solo: there is no second side to mirror against, so every card hangs to the
  // right of the spine and reads left-to-right like any other list.
  const left = !solo && row.side === "client";
  const edge =
    !solo && row.side === "joint"
      ? { borderWidth: 1.5, borderColor: row.accentHex }
      : left
        ? { borderRightWidth: 2.5, borderRightColor: row.accentHex }
        : { borderLeftWidth: 2.5, borderLeftColor: row.accentHex };
  const align = solo ? "left" : row.side === "joint" ? "center" : left ? "right" : "left";
  return (
    <View style={[styles.card, edge, style ?? {}]} wrap={false}>
      <Text style={[styles.kind, { textAlign: align }]}>{row.kindLabel.toUpperCase()}</Text>
      <Text style={[styles.title, { textAlign: align }]}>{row.title}</Text>
      {row.forLabel ? (
        <Text style={[styles.detail, { textAlign: align }]}>{row.forLabel}</Text>
      ) : null}
      {row.detail ? (
        <Text style={[styles.detail, { textAlign: align }]}>{row.detail}</Text>
      ) : null}
    </View>
  );
}

/** The year and the ages in it — the same for every row in that year, so the
 *  first row of the group supplies them. */
function SpineLabel({ row }: { row: MapGoalRow }) {
  return (
    <View style={styles.spine}>
      <Text style={styles.year}>{String(row.year)}</Text>
      {row.agesLabel ? <Text style={styles.ages}>{row.agesLabel}</Text> : null}
    </View>
  );
}

export function MapGoalsPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  accent,
}: {
  data: MapGoalsPageData;
  firmName: string;
  clientName: string;
  reportDate: string;
  pageIndex: number;
  totalPages: number;
  accent: SectionAccent;
}) {
  // Solo household: one principal, so there is no second side and no second
  // header. Printing the empty one drew a bare accent rule across the right
  // half of the page under no name at all.
  const solo = data.spouseName === null;
  return (
    <PageFrame
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
    >
      <SectionHead title={data.title} subtitle={data.subtitle} accent={accent} />

      {/* Above the rows, not below: it says "the milestones below", and it is
          the reason the page has any rows at all. */}
      {data.emptyNote ? <Text style={styles.note}>{data.emptyNote}</Text> : null}

      <View style={styles.headRow}>
        {!solo && (
          <Text style={[styles.headSide, { borderBottomColor: accent.accent }]}>
            {data.clientName.toUpperCase()}
          </Text>
        )}
        <View style={styles.headSpine} />
        <Text style={[styles.headSide, { borderBottomColor: accent.accent }]}>
          {(solo ? data.clientName : (data.spouseName ?? "")).toUpperCase()}
        </Text>
      </View>

      {groupGoalsByYear(data.rows).map((group) => {
        const all = [...group.client, ...group.spouse, ...group.joint];
        const label = <SpineLabel row={all[0]} />;
        if (solo) {
          return (
            <View key={group.year} style={[styles.row, { marginBottom: 7 }]} wrap={false}>
              {label}
              <View style={styles.soloCards}>
                {all.map((row) => (
                  <GoalCard key={row.id} row={row} solo style={styles.soloCard} />
                ))}
              </View>
            </View>
          );
        }
        const hasSides = group.client.length > 0 || group.spouse.length > 0;
        return (
          <View key={group.year} style={styles.yearGroup} wrap={false}>
            {hasSides ? (
              <View style={styles.row}>
                <View style={styles.side}>
                  {group.client.map((row) => (
                    <GoalCard key={row.id} row={row} />
                  ))}
                </View>
                {label}
                <View style={styles.side}>
                  {group.spouse.map((row) => (
                    <GoalCard key={row.id} row={row} />
                  ))}
                </View>
              </View>
            ) : (
              label
            )}
            {/* A joint goal belongs to neither side, so it sits in a centred
                band that visibly straddles the spine rather than being pushed
                onto one principal's column. */}
            {group.joint.length > 0 ? (
              <View style={styles.jointBand}>
                {group.joint.map((row) => (
                  <GoalCard key={row.id} row={row} style={styles.jointCard} />
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </PageFrame>
  );
}
