// src/components/reports-pdf/widgets/divider.tsx
//
// PDF render for the divider widget — a single hairline rule, mirroring
// the screen render with @react-pdf/renderer primitives + PDF_THEME.

import { View } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";

export function DividerPdfRender() {
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderColor: PDF_THEME.hair,
        marginVertical: 12,
      }}
    />
  );
}
