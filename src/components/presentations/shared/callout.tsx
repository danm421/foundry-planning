import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME, type SectionAccent } from "@/lib/presentations/theme";

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 4,
    borderLeftWidth: 3,
    borderLeftColor: PRESENTATION_THEME.accent, // overridden per-section inline
    paddingVertical: 8,
    paddingRight: 12,
    paddingLeft: 10,
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
    <View style={[styles.wrap, { backgroundColor: accent.tint, borderLeftColor: accent.accent }]}>
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}
