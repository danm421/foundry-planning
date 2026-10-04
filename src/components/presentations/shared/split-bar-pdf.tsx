import { View } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";

export interface SplitSegment<K extends string> {
  key: K;
  color: string;
}

/** One bar cut into colored parts, each as wide as its share of `parts.total`.
 *  The caller sizes the track through `style`; a zero total draws it empty. */
export function SplitBarPdf<K extends string>({
  parts,
  segments,
  style,
}: {
  parts: Record<K | "total", number>;
  segments: ReadonlyArray<SplitSegment<K>>;
  style?: Style;
}) {
  return (
    <View style={[{ flexDirection: "row", borderRadius: 2, overflow: "hidden" }, style ?? {}]}>
      {parts.total > 0
        ? segments.map((seg) => {
            const pct = (parts[seg.key] / parts.total) * 100;
            return pct > 0 ? <View key={seg.key} style={{ width: `${pct}%`, backgroundColor: seg.color }} /> : null;
          })
        : null}
    </View>
  );
}
