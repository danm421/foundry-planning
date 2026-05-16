import { View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "./theme";

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.ink3,
  },
  left: { flexDirection: "row", alignItems: "center", gap: 6 },
  logo: { height: 14, width: "auto" },
});

export function RunningHeader({
  firmName,
  logoDataUrl,
  householdName,
  reportTitle,
  reportYear,
}: {
  firmName: string;
  logoDataUrl: string | null;
  householdName: string;
  reportTitle: string;
  reportYear: number;
}) {
  return (
    <View style={s.row} fixed>
      <View style={s.left}>
        {logoDataUrl ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image src={logoDataUrl} style={s.logo} />
        ) : (
          <Text>{firmName}</Text>
        )}
        <Text> · {householdName}</Text>
      </View>
      <Text>{reportTitle} · {reportYear}</Text>
    </View>
  );
}
