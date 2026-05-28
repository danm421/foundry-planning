import { Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";

interface CoverProps {
  title?: string;
  firmName: string;
  firmTagline: string | null;
  clientName: string;
  spouseName: string | null;
  scenarioLabel: string;
  reportDate: string;
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: PRESENTATION_THEME.paper,
    padding: 72,
    flexDirection: "column",
    justifyContent: "center",
  },
  brandBlock: { alignItems: "center", marginBottom: 96 },
  firmName: { fontSize: 28, fontWeight: 700, color: PRESENTATION_THEME.ink },
  tagline: { fontSize: 11, fontStyle: "italic", color: PRESENTATION_THEME.accent, marginTop: 4 },
  titleBlock: { alignItems: "center", marginBottom: 32 },
  title: { fontSize: 32, fontWeight: 700, color: PRESENTATION_THEME.ink, textAlign: "center" },
  clientBlock: { alignItems: "center", marginBottom: 48 },
  preparedFor: { fontSize: 10, letterSpacing: 2, color: PRESENTATION_THEME.ink3, marginBottom: 8 },
  clientName: { fontSize: 22, fontWeight: 600, color: PRESENTATION_THEME.ink },
  meta: { alignItems: "center" },
  metaRow: { fontSize: 11, color: PRESENTATION_THEME.ink2, marginBottom: 4 },
});

export function CoverPdf(props: CoverProps) {
  const names = props.spouseName ? `${props.clientName} & ${props.spouseName}` : props.clientName;
  const title = props.title?.trim();
  return (
    <Page size="LETTER" style={styles.page}>
      <View style={styles.brandBlock}>
        <Text style={styles.firmName}>{props.firmName}</Text>
        {props.firmTagline && <Text style={styles.tagline}>{props.firmTagline}</Text>}
      </View>
      {title && (
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{title}</Text>
        </View>
      )}
      <View style={styles.clientBlock}>
        <Text style={styles.preparedFor}>PREPARED FOR</Text>
        <Text style={styles.clientName}>{names}</Text>
      </View>
      <View style={styles.meta}>
        <Text style={styles.metaRow}>{props.scenarioLabel}</Text>
        <Text style={styles.metaRow}>{props.reportDate}</Text>
      </View>
    </Page>
  );
}
