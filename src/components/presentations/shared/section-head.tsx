import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME, type SectionAccent } from "@/lib/presentations/theme";

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  eyebrow: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  title: {
    fontFamily: "Fraunces",
    fontSize: 22,
    fontWeight: 600,
    color: PRESENTATION_THEME.ink,
  },
  rule: {
    marginTop: 6,
    height: 1.5,
    width: "60%",
  },
});

export function SectionHead({
  title,
  subtitle,
  eyebrow,
  accent,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  accent: SectionAccent;
}) {
  return (
    <View style={styles.wrap}>
      {eyebrow && <Text style={[styles.eyebrow, { color: accent.accent }]}>{eyebrow}</Text>}
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10 }}>
        <Text style={styles.title}>{title}</Text>
        {subtitle && (
          <Text style={{ fontFamily: "Fraunces", fontSize: 14, color: PRESENTATION_THEME.ink2 }}>
            {`| ${subtitle}`}
          </Text>
        )}
      </View>
      <View style={[styles.rule, { backgroundColor: accent.accent }]} />
    </View>
  );
}
