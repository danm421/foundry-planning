import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";
import { useAccent } from "./accent-context";

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

export function Callout({ children }: { children: string }) {
  const { tint } = useAccent();
  return (
    <View style={[styles.wrap, { backgroundColor: tint }]}>
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}
