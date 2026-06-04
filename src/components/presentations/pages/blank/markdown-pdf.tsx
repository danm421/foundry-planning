import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";
import type { Block, Run } from "@/lib/presentations/pages/blank/markdown-blocks";

const s = StyleSheet.create({
  h1: { fontFamily: "Inter", fontSize: 18, fontWeight: 700, color: PRESENTATION_THEME.ink, marginTop: 10, marginBottom: 6 },
  h2: { fontFamily: "Inter", fontSize: 14, fontWeight: 700, color: PRESENTATION_THEME.ink, marginTop: 8, marginBottom: 5 },
  h3: { fontFamily: "Inter", fontSize: 11.5, fontWeight: 700, color: PRESENTATION_THEME.ink, marginTop: 6, marginBottom: 4 },
  para: { fontFamily: "Inter", fontSize: 10, lineHeight: 1.5, color: PRESENTATION_THEME.ink, marginBottom: 6 },
  listRow: { flexDirection: "row", marginBottom: 3 },
  bullet: { fontFamily: "Inter", fontSize: 10, color: PRESENTATION_THEME.ink, width: 16 },
  listText: { fontFamily: "Inter", fontSize: 10, lineHeight: 1.5, color: PRESENTATION_THEME.ink, flex: 1 },
  quote: { borderLeftWidth: 2, borderLeftColor: PRESENTATION_THEME.accent, paddingLeft: 8, marginBottom: 6 },
  quoteText: { fontFamily: "Inter", fontSize: 10, lineHeight: 1.5, color: PRESENTATION_THEME.ink2, fontStyle: "italic" as const },
  empty: { fontFamily: "JetBrains Mono", fontSize: 9, color: PRESENTATION_THEME.ink3 },
});

function runStyle(r: Run) {
  // Inline code renders in JetBrains Mono, which ships only upright weights
  // (400–600) — no italic or bold face. Pin code runs to a normal style so they
  // never request an unregistered italic variant, either directly (e.g. *`x`*)
  // or by inheriting the italic blockquote style. @react-pdf throws on a missing
  // style and that aborts rendering of the whole deck.
  if (r.code) {
    return { fontFamily: "JetBrains Mono", fontStyle: "normal" as const };
  }
  return {
    fontWeight: r.bold ? (700 as const) : undefined,
    fontStyle: r.italic ? ("italic" as const) : undefined,
    fontFamily: "Inter",
  };
}

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((r, i) => (
        <Text key={i} style={runStyle(r)}>
          {r.text}
        </Text>
      ))}
    </>
  );
}

export function MarkdownPdf({ blocks }: { blocks: Block[] }) {
  if (blocks.length === 0) {
    return <Text style={s.empty}>(empty page)</Text>;
  }
  return (
    <View>
      {blocks.map((b, i) => {
        if (b.type === "heading") {
          const style = b.level === 1 ? s.h1 : b.level === 2 ? s.h2 : s.h3;
          return (
            <Text key={i} style={style}>
              <Runs runs={b.runs} />
            </Text>
          );
        }
        if (b.type === "paragraph") {
          return (
            <Text key={i} style={s.para}>
              <Runs runs={b.runs} />
            </Text>
          );
        }
        if (b.type === "quote") {
          return (
            <View key={i} style={s.quote}>
              <Text style={s.quoteText}>
                <Runs runs={b.runs} />
              </Text>
            </View>
          );
        }
        return (
          <View key={i}>
            {b.items.map((item, j) => (
              <View key={j} style={s.listRow}>
                <Text style={s.bullet}>{b.ordered ? `${j + 1}.` : "•"}</Text>
                <Text style={s.listText}>
                  <Runs runs={item} />
                </Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}
