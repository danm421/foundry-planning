// The story's page primitive. Deliberately about half the ink density of the
// rest of the deck: one idea, generous margins, body copy at 11pt rather than
// the 6-7pt the data tables use. If this page looks like the data pages, the
// whole report has failed.
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";
import type { SectionAccent } from "@/lib/presentations/theme";
import type { PlanStoryChapterView } from "@/lib/presentations/pages/plan-story/view-model";

const styles = StyleSheet.create({
  wrap: { paddingTop: 18, paddingHorizontal: 24 },
  // The deck's eyebrow, verbatim from `shared/section-head.tsx` — this page
  // opts out of the data pages' heading block, not out of the report.
  eyebrow: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  // Fraunces at 600, the same display face and weight every other page's title
  // uses. Fraunces registers no 700 (components/pdf/fonts.ts).
  title: {
    fontFamily: "Fraunces",
    fontSize: 22,
    fontWeight: 600,
    color: PRESENTATION_THEME.ink,
    marginBottom: 4,
  },
  rule: { height: 2, width: 48, marginBottom: 18 },
  body: { fontSize: 11, lineHeight: 1.65, color: PRESENTATION_THEME.ink2, marginBottom: 11, maxWidth: 430 },
  card: {
    borderWidth: 0.75,
    borderColor: PRESENTATION_THEME.hair2,
    backgroundColor: PRESENTATION_THEME.card,
    borderRadius: 3,
    padding: 12,
    marginBottom: 9,
  },
  cardName: { fontSize: 12, fontWeight: 700, color: PRESENTATION_THEME.ink, marginBottom: 3 },
  cardLabel: { fontSize: 7.5, letterSpacing: 0.6, color: PRESENTATION_THEME.ink3, marginBottom: 2 },
  cardText: { fontSize: 10, lineHeight: 1.5, color: PRESENTATION_THEME.ink2 },
  /** The note that stands in for what the sheet could not hold. Italic and in
   *  the quietest ink: it is an aside to the reader, not another card. */
  overflow: {
    fontSize: 10,
    lineHeight: 1.5,
    color: PRESENTATION_THEME.ink3,
    marginTop: 4,
    fontStyle: "italic",
  },
});

export function PlanStoryChapterPdf({
  chapter,
  accent,
  eyebrow,
}: {
  chapter: PlanStoryChapterView;
  accent: SectionAccent;
  /** The report's own name and the plan it narrates — "Your Plan · Proposed". */
  eyebrow: string;
}) {
  // Both already decided by `buildPlanStoryData`, which is where the sheet
  // budget is spent — a paragraph dropped here rather than there would be
  // charged against a sheet it never reached. This component renders; it does
  // not choose.
  const cards = chapter.layout === "strategyCards" ? chapter.strategies : [];
  const paragraphs = chapter.paragraphs;

  return (
    <View style={styles.wrap}>
      {eyebrow.length > 0 && (
        <Text style={[styles.eyebrow, { color: accent.accent }]}>{eyebrow}</Text>
      )}
      <Text style={styles.title}>{chapter.title}</Text>
      <View style={[styles.rule, { backgroundColor: accent.accent }]} />

      {paragraphs.map((p, i) => (
        <Text key={i} style={styles.body}>
          {p}
        </Text>
      ))}

      {cards.map((s, i) => (
        <View key={i} style={styles.card}>
          <Text style={styles.cardName}>{s.name}</Text>
          <Text style={styles.cardLabel}>WHAT WE&apos;D DO</Text>
          <Text style={styles.cardText}>{s.what}</Text>
          {s.detail.length > 0 && (
            <>
              <Text style={[styles.cardLabel, { marginTop: 6 }]}>WHAT IT DOES</Text>
              <Text style={styles.cardText}>{s.detail}</Text>
            </>
          )}
        </View>
      ))}

      {chapter.overflowNote.length > 0 && (
        <Text style={styles.overflow}>{chapter.overflowNote}</Text>
      )}
    </View>
  );
}
