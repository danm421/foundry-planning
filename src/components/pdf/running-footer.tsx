// Fixed footer that repeats on every non-cover page. Left side shows
// `Confidential · <firm>`. Right side shows zero-padded page index and
// total ("01 / 12") with the current page in accent color.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "./theme";

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    position: "absolute",
    bottom: 32,
    left: 48,
    right: 48,
    fontFamily: "JetBrains Mono",
    fontSize: 9,
  },
});

export function RunningFooter({
  firmName,
  pageIndex,
  totalPages,
}: {
  firmName: string;
  pageIndex: number;
  totalPages: number;
}) {
  return (
    <View style={s.row} fixed>
      <Text style={{ color: PDF_THEME.ink3 }}>Confidential · {firmName}</Text>
      <Text>
        <Text style={{ color: PDF_THEME.accent }}>
          {String(pageIndex + 1).padStart(2, "0")}
        </Text>
        <Text style={{ color: PDF_THEME.ink3 }}>
          {" "}/ {String(totalPages).padStart(2, "0")}
        </Text>
      </Text>
    </View>
  );
}
