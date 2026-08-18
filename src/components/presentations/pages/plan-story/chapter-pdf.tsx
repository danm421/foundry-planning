// The story's page primitive. Deliberately about half the ink density of the
// rest of the deck: one idea, generous margins, body copy at 11pt rather than
// the 6-7pt the data tables use. If this page looks like the data pages, the
// whole report has failed.
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";
import type { SectionAccent } from "@/lib/presentations/theme";
import type { PlanStoryChapterView } from "@/lib/presentations/pages/plan-story/view-model";
import { PlanStoryChapterChartPdf } from "./chapter-chart-pdf";

/** The text measure this page reads at — every full-width run of words on the
 *  sheet, prose and glossary alike, stops at the same line length. */
const MEASURE = 430;

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
  body: { fontSize: 11, lineHeight: 1.65, color: PRESENTATION_THEME.ink2, marginBottom: 11, maxWidth: MEASURE },
  card: {
    borderWidth: 0.75,
    borderColor: PRESENTATION_THEME.hair2,
    backgroundColor: PRESENTATION_THEME.card,
    borderRadius: 3,
    padding: 12,
    marginBottom: 9,
  },
  // Two fixed columns that do NOT wrap: react-pdf cannot split a `flexWrap` row
  // across sheets, and both columns are capped upstream (BUDGET_WORDS_TWO_UP,
  // MAX_FIGURE_CARDS), which is what keeps one chapter on one sheet here too.
  twoUp: { flexDirection: "row", gap: 22 },
  proseCol: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  figureCol: { width: 170, flexGrow: 0, flexShrink: 0 },
  figureCard: {
    borderWidth: 0.75,
    borderColor: PRESENTATION_THEME.hair2,
    backgroundColor: PRESENTATION_THEME.card,
    borderRadius: 3,
    padding: 10,
    marginBottom: 8,
  },
  figureLabel: {
    fontSize: 7.5,
    letterSpacing: 0.6,
    color: PRESENTATION_THEME.ink3,
    marginBottom: 3,
  },
  // Fraunces, the same display face as the chapter title, rather than the deck's
  // mono. This page is one idea at half the ink density of a data page, and its
  // figures are display type, not a table. (The brand's numeral mono is B612
  // Mono, which this repo does not vendor; the monos it does register mark the
  // zero, which the brand forbids.)
  figureValue: {
    fontFamily: "Fraunces",
    fontSize: 18,
    fontWeight: 600,
    color: PRESENTATION_THEME.ink,
  },
  step: { flexDirection: "row", gap: 10, marginBottom: 10, alignItems: "flex-start" },
  // The one number on this page that IS a label rather than a figure, so it
  // takes the deck's mono — the same face the eyebrow uses.
  stepNum: { fontFamily: "JetBrains Mono", fontSize: 10, width: 18, paddingTop: 1 },
  stepBody: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  stepText: { fontSize: 10.5, lineHeight: 1.5, color: PRESENTATION_THEME.ink },
  stepMeta: {
    fontSize: 8,
    letterSpacing: 0.4,
    color: PRESENTATION_THEME.ink3,
    marginTop: 2,
  },
  /** The glossary, set off from the prose by a hairline rather than a panel —
   *  hierarchy on this deck comes from rules, never from a box or a shadow. */
  glossaryBlock: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 0.75,
    borderTopColor: PRESENTATION_THEME.hair2,
  },
  /** One line per term, a little smaller than the body copy above it: this is
   *  reference matter a client comes back to, not the page's argument. */
  term: {
    fontSize: 10,
    lineHeight: 1.5,
    color: PRESENTATION_THEME.ink2,
    marginBottom: 5,
    maxWidth: MEASURE,
  },
  // Inter 600 — the same weight the deck's own headings use, and enough to let
  // the eye find a word down the list without a second colour.
  termWord: { fontWeight: 600, color: PRESENTATION_THEME.ink },
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

/** The eyebrow, the chapter heading and its accent rule — identical on every
 *  layout, so a new layout cannot quietly restyle the page's head. */
function ChapterHead({ title, accent, eyebrow }: { title: string; accent: SectionAccent; eyebrow: string }) {
  return (
    <>
      {eyebrow.length > 0 && (
        <Text style={[styles.eyebrow, { color: accent.accent }]}>{eyebrow}</Text>
      )}
      <Text style={styles.title}>{title}</Text>
      <View style={[styles.rule, { backgroundColor: accent.accent }]} />
    </>
  );
}

function Paragraphs({ paragraphs }: { paragraphs: string[] }) {
  return (
    <>
      {paragraphs.map((p, i) => (
        <Text key={i} style={styles.body}>
          {p}
        </Text>
      ))}
    </>
  );
}

function OverflowNote({ note }: { note: string }) {
  return note.length > 0 ? <Text style={styles.overflow}>{note}</Text> : null;
}

/** "Cooper · Before 15 April", or whichever half exists. A separator with
 *  nothing on one side of it reads as a missing value rather than as an absent
 *  one. */
function stepMeta(step: { owner: string; when: string }): string {
  return [step.owner, step.when].map((s) => s.trim()).filter(Boolean).join(" · ");
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
  // Everything below is already decided by `buildPlanStoryData`, which is where
  // the sheet budget is spent — a paragraph dropped here rather than there would
  // be charged against a sheet it never reached. This component renders; it does
  // not choose. The layout still reads its OWN collection only, so a chapter
  // carrying stale strategies from another layout prints none of them.
  const cards = chapter.layout === "strategyCards" ? chapter.strategies : [];

  if (chapter.layout === "chartWithProse") {
    return (
      <View style={styles.wrap}>
        <ChapterHead title={chapter.title} accent={accent} eyebrow={eyebrow} />
        {/* The chart FIRST: it is the page's subject and the prose explains it.
            No `flexWrap` row here — react-pdf cannot split one across sheets, and
            a full-width chart above full-measure prose needs no row at all. */}
        {chapter.chart && (
          <View style={{ marginBottom: 14 }}>
            <PlanStoryChapterChartPdf chart={chapter.chart} />
          </View>
        )}
        <Paragraphs paragraphs={chapter.paragraphs} />
        <OverflowNote note={chapter.overflowNote} />
      </View>
    );
  }

  if (chapter.layout === "twoUp") {
    return (
      <View style={styles.wrap}>
        <ChapterHead title={chapter.title} accent={accent} eyebrow={eyebrow} />
        <View style={styles.twoUp}>
          <View style={styles.proseCol}>
            <Paragraphs paragraphs={chapter.paragraphs} />
            <OverflowNote note={chapter.overflowNote} />
          </View>
          <View style={styles.figureCol}>
            {chapter.figures.map((f, i) => (
              <View key={i} style={styles.figureCard}>
                <Text style={styles.figureLabel}>{f.label.toUpperCase()}</Text>
                <Text style={styles.figureValue}>{f.value}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  if (chapter.layout === "glossary") {
    return (
      <View style={styles.wrap}>
        <ChapterHead title={chapter.title} accent={accent} eyebrow={eyebrow} />
        <Paragraphs paragraphs={chapter.paragraphs} />
        {chapter.glossary.length > 0 && (
          <View style={styles.glossaryBlock}>
            {/* The lead-in is a LABEL, not a sentence of prose — prose on this
                chapter is replaced by the model the first time an advisor hits
                Generate, and the list would be left without its introduction. */}
            <Text style={[styles.cardLabel, { marginBottom: 7 }]}>IN PLAIN ENGLISH</Text>
            {chapter.glossary.map((t, i) => (
              <Text key={i} style={styles.term}>
                {/* The term is stored lowercase, because it is matched against
                    the gates' ban list; the capital belongs to the line. */}
                <Text style={styles.termWord}>
                  {t.term.charAt(0).toUpperCase() + t.term.slice(1)}
                </Text>
                {` — ${t.plain}`}
              </Text>
            ))}
          </View>
        )}
        <OverflowNote note={chapter.overflowNote} />
      </View>
    );
  }

  if (chapter.layout === "checklist") {
    return (
      <View style={styles.wrap}>
        <ChapterHead title={chapter.title} accent={accent} eyebrow={eyebrow} />
        <Paragraphs paragraphs={chapter.paragraphs} />
        {chapter.steps.map((s, i) => {
          const meta = stepMeta(s);
          return (
            <View key={i} style={styles.step}>
              <Text style={[styles.stepNum, { color: accent.accent }]}>{i + 1}</Text>
              <View style={styles.stepBody}>
                <Text style={styles.stepText}>{s.text}</Text>
                {meta.length > 0 && <Text style={styles.stepMeta}>{meta}</Text>}
              </View>
            </View>
          );
        })}
        <OverflowNote note={chapter.overflowNote} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <ChapterHead title={chapter.title} accent={accent} eyebrow={eyebrow} />

      <Paragraphs paragraphs={chapter.paragraphs} />

      {cards.map((s, i) => (
        <View key={i} style={styles.card}>
          <Text style={styles.cardName}>{s.name}</Text>
          {/* Conditional for the same reason "what it does" below is: the
              view-model refuses a `what` whose figures the fact pack does not
              hold, and a heading over an empty line reads as a rendering
              failure rather than as a withheld figure. */}
          {s.what.length > 0 && (
            <>
              <Text style={styles.cardLabel}>WHAT WE&apos;D DO</Text>
              <Text style={styles.cardText}>{s.what}</Text>
            </>
          )}
          {s.detail.length > 0 && (
            <>
              <Text style={[styles.cardLabel, { marginTop: 6 }]}>WHAT IT DOES</Text>
              <Text style={styles.cardText}>{s.detail}</Text>
            </>
          )}
        </View>
      ))}

      <OverflowNote note={chapter.overflowNote} />
    </View>
  );
}
