// src/components/reports-pdf/row-render.tsx
//
// Renders one row of slots in PDF mode. Each slot delegates to the
// widget registry's `Render` component with `mode: "pdf"`. Empty slots
// reserve space so layouts stay symmetric.

import { View } from "@react-pdf/renderer";
import { getWidget } from "@/lib/reports/widget-registry";
import type { Row } from "@/lib/reports/types";

export function RowRender({
  row,
  widgetData,
  chartImages,
}: {
  row: Row;
  widgetData: Record<string, unknown>;
  chartImages: Record<string, string>;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 12, marginBottom: 12 }}>
      {row.slots.map((w, i) => {
        const flex = 1;
        if (w === null) return <View key={i} style={{ flex }} />;
        const entry = getWidget(w.kind);
        const Render = entry.RenderPdf ?? entry.Render;
        return (
          <View key={w.id} style={{ flex }}>
            <Render
              props={w.props as never}
              data={widgetData[w.id]}
              mode="pdf"
              chartImage={chartImages[w.id]}
              widgetId={w.id}
            />
          </View>
        );
      })}
    </View>
  );
}
