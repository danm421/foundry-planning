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
});

type Strategy = PlanStoryChapterView["strategies"][number];

/** Everything before the first occurrence of `phrase`, plus everything after it. */
function strikeFirst(text: string, phrase: string): string {
  if (phrase.length === 0) return text;
  const at = text.toLowerCase().indexOf(phrase.toLowerCase());
  return at < 0 ? text : text.slice(0, at) + text.slice(at + phrase.length);
}

const WORDLIKE = /[\p{L}\p{N}]/u;

/**
 * Does this paragraph say anything the card doesn't already say?
 *
 * On the AI-off path `narrateWhatWeRecommend` writes one sentence per strategy —
 * `"Delay Social Security — Claim age: 67 → 70."` — and `generateChapter` STORES
 * that sentence as the chapter's text, so by export time it arrives here as
 * prose, indistinguishable from an advisor's own. The card below then repeats
 * the same name and the same clause, out of the same `quotableDetail` call on
 * the same facts. Printing both puts the identical sentence on a client's page
 * twice, ten points apart.
 *
 * The card is the richer of the two — it also carries WHAT WE'D DO — so the
 * PARAGRAPH is what goes, and only when it is a pure restatement: strike the
 * strategy's name and its quoted clause out of the sentence and drop it only if
 * nothing but punctuation is left. A lead-in that opens with the strategy's name
 * and then says something of its own is exactly what a good generated (or
 * hand-written) chapter looks like, and it keeps every word.
 */
function restatesCard(paragraph: string, strategy: Strategy): boolean {
  if (strategy.name.length === 0) return false;
  const withoutName = strikeFirst(paragraph, strategy.name);
  if (withoutName === paragraph) return false;
  return !WORDLIKE.test(strikeFirst(withoutName, strategy.detail));
}

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
  const cards = chapter.layout === "strategyCards" ? chapter.strategies : [];
  const paragraphs = chapter.paragraphs.filter(
    (p) => !cards.some((strategy) => restatesCard(p, strategy)),
  );

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
    </View>
  );
}
