// src/components/reports-pdf/widgets/chart-image.tsx
//
// Standalone image widget for embedding a pre-captured chart PNG into a PDF.
// `ChartImage` (the type) is aliased to `ChartImageData` at the import site
// to avoid a name collision with the component export.

import { View, Image, StyleSheet } from "@react-pdf/renderer";
import type { ChartImage as ChartImageData } from "@/lib/report-artifacts/types";

const s = StyleSheet.create({
  wrap: { alignItems: "center", marginVertical: 12 },
  img: { width: "100%", maxWidth: 480 },
});

export function ChartImage({
  chart,
  maxWidth,
}: {
  chart: ChartImageData;
  maxWidth?: number;
}) {
  // jsx-a11y/alt-text targets HTML <img>; @react-pdf/renderer's <Image>
  // has no `alt` and is not announced by AT — eslint-disable on the line.
  // eslint-disable-next-line jsx-a11y/alt-text
  return (
    <View style={s.wrap}>
      <Image src={chart.dataUrl} style={[s.img, maxWidth ? { maxWidth } : {}]} />
    </View>
  );
}
