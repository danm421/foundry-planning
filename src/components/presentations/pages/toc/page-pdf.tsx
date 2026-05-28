import { Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";
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
  leader: { flex: 1, borderBottom: `1pt dotted ${PRESENTATION_THEME.hair}`, marginHorizontal: 6, marginBottom: 2 },
  pageNum: { fontSize: 12, color: PRESENTATION_THEME.ink2 },
});

export function TocPdf({ sections }: { sections: TocSection[] }) {
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
      <PdfPageFooter />
    </Page>
  );
}
