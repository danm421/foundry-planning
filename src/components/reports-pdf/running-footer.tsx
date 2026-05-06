// src/components/reports-pdf/running-footer.tsx
//
// Fixed footer that repeats on every non-cover page. A 1pt hairline rule
// sits above a plain-text row: firm name + " · Confidential" on the LEFT
// in `ink2`, and the page index ("Page N") on the RIGHT in `ink3`.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "./theme";

const s = StyleSheet.create({
  wrap: {
    position: "absolute",
    bottom: 32,
    left: 48,
    right: 48,
  },
  hair: {
    height: 1,
    backgroundColor: PDF_THEME.hair,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  firm: {
    fontFamily: "Inter",
    fontSize: 9,
    color: PDF_THEME.ink2,
  },
  page: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.ink3,
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
    <View style={s.wrap} fixed>
      <View style={s.hair} />
      <View style={s.row}>
        <Text style={s.firm}>{firmName} · Confidential</Text>
        <Text style={s.page}>
          Page {String(pageIndex + 1).padStart(2, "0")} / {String(totalPages).padStart(2, "0")}
        </Text>
      </View>
    </View>
  );
}
