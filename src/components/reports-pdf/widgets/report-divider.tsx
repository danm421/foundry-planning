// src/components/reports-pdf/widgets/report-divider.tsx
//
// Between-artifact separator for combined-PDF (package) mode. Forces a page
// break and renders the artifact title as a section heading at the top of the
// new page. Used by the shell when concatenating multiple artifacts into one
// PDF document (Plan 3 package mode).

import { View, Text, StyleSheet } from "@react-pdf/renderer";

const s = StyleSheet.create({
  // `break` is a @react-pdf/renderer prop — forces a new page before this View.
  divider: {
    paddingTop: 16,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#888",
  },
  title: { fontSize: 16, fontWeight: 700 },
});

export function ReportDivider({ title }: { title: string }) {
  return (
    <View break style={s.divider}>
      <Text style={s.title}>{title}</Text>
    </View>
  );
}
