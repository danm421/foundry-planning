import { Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "@/components/pdf/theme";
import type { CoverProps } from "@/lib/comparison-pdf/build-cover";

const s = StyleSheet.create({
  page: {
    backgroundColor: PDF_THEME.paper,
    color: PDF_THEME.ink,
    fontFamily: "Inter",
    padding: 56,
  },
  eyebrow: { fontFamily: "JetBrains Mono", fontSize: 9 },
  title: {
    fontFamily: "Fraunces",
    fontSize: 48,
    fontWeight: 700,
    marginTop: 24,
    color: PDF_THEME.ink,
  },
  subtitle: { fontFamily: "Inter", fontSize: 16, marginTop: 12, color: PDF_THEME.ink2 },
  spacer: { flex: 1 },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  footerLeft: { fontFamily: "JetBrains Mono", fontSize: 9, color: PDF_THEME.ink3 },
  logo: { height: 36, width: "auto" },
});

export function CoverPage({
  title,
  householdName,
  eyebrow,
  advisorName,
  asOfIso,
  primaryColor,
  firmName,
  logoDataUrl,
}: CoverProps) {
  return (
    <Page size="LETTER" orientation="portrait" style={s.page}>
      <Text style={{ ...s.eyebrow, color: primaryColor }}>{eyebrow}</Text>
      <Text style={s.title}>{title}</Text>
      <Text style={s.subtitle}>{householdName}</Text>
      <View style={s.spacer} />
      <View style={s.footer}>
        <View>
          <Text style={s.footerLeft}>Prepared by {advisorName}</Text>
          <Text style={s.footerLeft}>As of {asOfIso}</Text>
        </View>
        {logoDataUrl ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image src={logoDataUrl} style={s.logo} />
        ) : (
          <Text style={{ ...s.footerLeft, fontSize: 14 }}>{firmName}</Text>
        )}
      </View>
    </Page>
  );
}
