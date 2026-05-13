// Fixed header that repeats on every non-cover page. Left side shows
// `Foundry · <household>`, right side shows `<report title> · <year>`.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "./theme";

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.ink3,
  },
});

export function RunningHeader({
  householdName,
  reportTitle,
  reportYear,
}: {
  householdName: string;
  reportTitle: string;
  reportYear: number;
}) {
  return (
    <View style={s.row} fixed>
      <Text>Foundry · {householdName}</Text>
      <Text>{reportTitle} · {reportYear}</Text>
    </View>
  );
}
