import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { Tidbit } from "@/lib/presentations/tidbits";

const s = StyleSheet.create({
  wrap: { width: 150, gap: 6 },
  card: {
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.hair2,
    borderLeftWidth: 3,
    borderLeftColor: T.accent,
    borderRadius: 3,
    padding: 7,
  },
  title: { fontSize: 7.5, fontWeight: 700, color: T.ink, marginBottom: 2 },
  body: { fontSize: 7, color: T.ink2, lineHeight: 1.35 },
});

/** Narrow sidebar of educational tidbits, meant to sit beside a chart. */
export function TidbitSidebarPdf({ tidbits }: { tidbits: Tidbit[] }) {
  if (tidbits.length === 0) return null;
  return (
    <View style={s.wrap}>
      {tidbits.map((t) => (
        <View key={t.id} style={s.card}>
          <Text style={s.title}>{t.title}</Text>
          <Text style={s.body}>{t.body}</Text>
        </View>
      ))}
    </View>
  );
}
