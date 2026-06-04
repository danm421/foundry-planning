import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME, type SectionAccent } from "@/lib/presentations/theme";

const styles = StyleSheet.create({
  wrap: {
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

export function Callout({ children, accent }: { children: string; accent: SectionAccent }) {
  return (
    <View style={[styles.wrap, { backgroundColor: accent.tint }]}>
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}
