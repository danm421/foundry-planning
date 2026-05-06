// src/components/reports-pdf/running-header.tsx
//
// Fixed header that repeats on every non-cover page. Renders as a dark
// `inkDeep` band (full content width, ~24pt tall) with the firm name on
// the LEFT in `inkOnDark` and the "<client> · <title> · <year>" string
// on the RIGHT in `accent`. A 1.5pt accent rule sits beneath the band as
// an underline, with `marginBottom: 16` of breathing room before page
// content starts.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "./theme";

const FIRM_NAME = "FOUNDRY PLANNING";

const s = StyleSheet.create({
  band: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: PDF_THEME.inkDeep,
    height: 24,
    paddingHorizontal: 12,
  },
  firm: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.inkOnDark,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  meta: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.accent,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  underline: {
    height: 1.5,
    backgroundColor: PDF_THEME.accent,
    marginBottom: 16,
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
    <View fixed>
      <View style={s.band}>
        <Text style={s.firm}>{FIRM_NAME}</Text>
        <Text style={s.meta}>
          {householdName} · {reportTitle} · {reportYear}
        </Text>
      </View>
      <View style={s.underline} />
    </View>
  );
}
