import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: PRESENTATION_THEME.accentTint,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  text: {
    fontFamily: "Inter",
    fontSize: 10,
    color: PRESENTATION_THEME.ink,
  },
});

export function Callout({ children }: { children: string }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}
