import { Text, View, StyleSheet } from "@react-pdf/renderer";
import { exactCurrency } from "@/lib/presentations/format";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { DollarPair } from "@/lib/presentations/real-dollars";

const s = StyleSheet.create({
  wrap: { width: "100%", gap: 0.5 },
  primary: { fontSize: 7.5, fontWeight: 700, color: T.ink, lineHeight: 1.1 },
  secondary: { fontSize: 6, color: T.ink3, lineHeight: 1.1 },
});

export function DualDollarValuePdf({
  value,
  align = "right",
  emphasis = true,
}: {
  value: DollarPair;
  align?: "left" | "right";
  emphasis?: boolean;
}) {
  const isZero = Math.round(value.today) === 0 && Math.round(value.nominal) === 0;
  const isSame = Math.round(value.today) === Math.round(value.nominal);
  const secondary = isSame
    ? "Same amount in future-year dollars"
    : `${exactCurrency(value.nominal)} future-year dollars`;

  return (
    <View style={s.wrap}>
      <Text
        style={[
          s.primary,
          {
            textAlign: align,
            color: emphasis ? T.ink : T.ink2,
            fontWeight: emphasis ? 700 : 400,
          },
        ]}
      >
        {`${exactCurrency(value.today)} today`}
      </Text>
      {!isZero && <Text style={[s.secondary, { textAlign: align }]}>{secondary}</Text>}
    </View>
  );
}
