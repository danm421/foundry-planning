import { View, Image, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "@/components/pdf/theme";
import type { CellSpan } from "@/lib/comparison/layout-schema";

const s = StyleSheet.create({
  wrap: { padding: 6 },
  img: { width: "100%", height: "auto" },
  placeholder: {
    borderWidth: 1,
    borderColor: PDF_THEME.hair,
    borderStyle: "dashed",
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: {
    fontSize: 9,
    color: PDF_THEME.ink3,
    fontFamily: "JetBrains Mono",
  },
});

const SPAN_WIDTH: Record<CellSpan, string> = {
  1: "20%",
  2: "40%",
  3: "60%",
  4: "80%",
  5: "100%",
};

export function SnapshotCell({
  pngDataUrl,
  span,
}: {
  pngDataUrl: string | null;
  span: CellSpan;
}) {
  return (
    <View style={[s.wrap, { width: SPAN_WIDTH[span] }]}>
      {pngDataUrl ? (
        // eslint-disable-next-line jsx-a11y/alt-text
        <Image src={pngDataUrl} style={s.img} />
      ) : (
        <View style={s.placeholder}>
          <Text style={s.placeholderText}>
            Chart unavailable — open in browser to refresh
          </Text>
        </View>
      )}
    </View>
  );
}
