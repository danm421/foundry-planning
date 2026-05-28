import { Text, View, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";

const styles = StyleSheet.create({
  footer: {
    position: "absolute",
    bottom: 18,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  text: {
    fontSize: 8,
    color: PRESENTATION_THEME.ink3,
  },
});

export function PdfPageFooter() {
  return (
    <View style={styles.footer} fixed>
      <Text
        style={styles.text}
        render={({ pageNumber, totalPages }) =>
          `Page ${pageNumber} of ${totalPages}`
        }
      />
    </View>
  );
}
