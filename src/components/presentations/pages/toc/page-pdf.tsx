import { Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";
import { DISCLOSURES_HEADING, longDisclaimerParagraphs } from "@/lib/presentations/disclaimers";
import { PdfPageFooter } from "../../pdf-page-footer";

export interface TocSection {
  title: string;
  startPage: number;
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: PRESENTATION_THEME.paper,
    padding: 72,
  },
  heading: { fontSize: 22, fontWeight: 700, color: PRESENTATION_THEME.ink, marginBottom: 32 },
  row: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  title: { fontSize: 12, color: PRESENTATION_THEME.ink },
  leader: { flex: 1, borderBottom: `1pt dotted ${PRESENTATION_THEME.hair2}`, marginHorizontal: 6, marginBottom: 2 },
  pageNum: { fontSize: 12, color: PRESENTATION_THEME.ink2 },
  disclosures: {
    marginTop: 36,
    borderTopWidth: 1,
    borderTopColor: PRESENTATION_THEME.hair2,
    paddingTop: 18,
  },
  disclosuresHeading: {
    fontSize: 9,
    fontWeight: 700,
    color: PRESENTATION_THEME.ink2,
    marginBottom: 6,
  },
  disclosureParagraph: {
    fontSize: 8,
    lineHeight: 1.45,
    color: PRESENTATION_THEME.ink3,
    marginBottom: 5,
  },
});

export function TocPdf({
  sections,
  firmName,
  clientName,
  reportDate,
}: {
  sections: TocSection[];
  firmName: string;
  clientName: string;
  reportDate: string;
}) {
  const disclosures = longDisclaimerParagraphs({ firmName, clientName, reportDate });
  return (
    <Page size="LETTER" style={styles.page}>
      <Text style={styles.heading}>Contents</Text>
      {sections.map((s) => (
        <View key={`${s.title}-${s.startPage}`} style={styles.row}>
          <Text style={styles.title}>{s.title}</Text>
          <View style={styles.leader} />
          <Text style={styles.pageNum}>{s.startPage}</Text>
        </View>
      ))}
      <View style={styles.disclosures}>
        <Text style={styles.disclosuresHeading}>{DISCLOSURES_HEADING}</Text>
        {disclosures.map((paragraph, i) => (
          <Text key={i} style={styles.disclosureParagraph}>
            {paragraph}
          </Text>
        ))}
      </View>
      <PdfPageFooter />
    </Page>
  );
}
