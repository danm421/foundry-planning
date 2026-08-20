import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { EarlyYearsTidbitsPageData } from "@/lib/presentations/pages/early-years-tidbits/types";

// Two columns of cards, not the shared 150pt sidebar: here the notes ARE the
// page rather than a margin note beside a chart, so they get page-sized type.
// 47% + 47% + a 10pt gap fits the 526pt content width twice over and no more —
// three per row would drop the body below the sidebar's own 7pt floor.
const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 8, color: T.ink2, marginBottom: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  card: {
    flexBasis: "47%",
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.hair2,
    borderLeftWidth: 3,
    borderRadius: 3,
    padding: 9,
  },
  cardTitle: { fontSize: 9, fontWeight: 700, color: T.ink, marginBottom: 3 },
  cardBody: { fontSize: 8, color: T.ink2, lineHeight: 1.4 },
  empty: { fontSize: 11, color: T.ink2, textAlign: "center", marginTop: 60 },
});

export function EarlyYearsTidbitsPagePdf(
  input: RenderPdfInput<EarlyYearsTidbitsPageData>,
) {
  const { data, firmName, clientName, reportDate, pageIndex, totalPages, accent } = input;
  const frame = { firmName, clientName, reportDate, pageIndex, totalPages };

  // The advisor added this page on purpose but picked nothing. A heading over
  // blank paper promises notes that aren't there; say what happened instead.
  if (data.tidbits.length === 0) {
    return (
      <PageFrame {...frame}>
        <Text style={s.title}>Things Worth Knowing</Text>
        <Text style={s.empty}>
          No notes were picked for this page. Choose up to six in the page&apos;s options,
          or remove the page from the deck.
        </Text>
      </PageFrame>
    );
  }

  return (
    <PageFrame {...frame}>
      <Text style={s.title}>Things Worth Knowing</Text>
      <Text style={s.subtitle}>General financial education, not advice about your plan.</Text>
      <View style={s.grid}>
        {data.tidbits.map((t) => (
          <View key={t.id} style={[s.card, { borderLeftColor: accent.accent }]}>
            <Text style={s.cardTitle}>{t.title}</Text>
            <Text style={s.cardBody}>{t.body}</Text>
          </View>
        ))}
      </View>
    </PageFrame>
  );
}
