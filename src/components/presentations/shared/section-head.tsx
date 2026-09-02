import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME, type SectionAccent } from "@/lib/presentations/theme";

// Every deck page wears this head — the dense data pages (Retirement Summary,
// Income & Funding, Tax Summary, Tax Comparison) used to print a plain 16pt
// bold sans title instead, which read as a second template inside one deck.
//
// The size is capped by the tightest page in the deck, not chosen by taste.
// Retirement Summary's funding sheet is full to the footer: measured by sweeping
// this file against render-smoke.test.tsx, a head over ~42pt tall splits its
// bottom panel row onto a third sheet and re-breaks every Contents page number
// after it. This head is ~37pt (18 x 1.2 + 5 + 1.5 + 9), leaving ~5pt of margin.
// 18pt also proportions better against 8pt body copy than the 22pt it replaced.
const styles = StyleSheet.create({
  wrap: { marginBottom: 9 },
  eyebrow: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  title: {
    fontFamily: "Fraunces",
    fontSize: 18,
    fontWeight: 600,
    color: PRESENTATION_THEME.ink,
    // The title owns its measured width and never yields it. Without this the
    // row shrank the title's BOX to make room for a long subtitle — and since
    // react-pdf does not clip text to its box, the title's words stayed put
    // while the subtitle started INSIDE them.
    flexShrink: 0,
  },
  // Takes whatever the title leaves and ellipses past it, so a long scenario
  // name can neither overprint the title nor run off the paper (a real deck
  // printed "… Retire age 64 in 2026 · through 2058" 49pt past the right edge).
  //
  // `maxLines` is a STYLE property in react-pdf, not a Text prop — as a prop it
  // is silently ignored and the subtitle wraps to a second line, which lands
  // ABOVE the title under `alignItems: baseline` and busts the ~42pt head cap.
  // One line is what the cap allows; the truncated tail ("Retire age X in Y")
  // is the same figure the page's own RETIRE AGE card prints.
  subtitle: {
    fontFamily: "Fraunces",
    fontSize: 12,
    color: PRESENTATION_THEME.ink2,
    flex: 1,
    maxLines: 1,
    textOverflow: "ellipsis",
  },
  rule: {
    marginTop: 5,
    height: 1.5,
    width: "60%",
  },
});

export function SectionHead({
  title,
  subtitle,
  eyebrow,
  accent,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  accent: SectionAccent;
}) {
  return (
    <View style={styles.wrap}>
      {eyebrow && <Text style={[styles.eyebrow, { color: accent.accent }]}>{eyebrow}</Text>}
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10 }}>
        <Text style={styles.title}>{title}</Text>
        {subtitle && (
          <Text style={styles.subtitle}>
            {`| ${subtitle}`}
          </Text>
        )}
      </View>
      <View style={[styles.rule, { backgroundColor: accent.accent }]} />
    </View>
  );
}
