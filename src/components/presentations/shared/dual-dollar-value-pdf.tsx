import { Text, View, StyleSheet } from "@react-pdf/renderer";
import { exactCurrency } from "@/lib/presentations/format";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { DollarPair } from "@/lib/presentations/real-dollars";

const s = StyleSheet.create({
  wrap: { gap: 0.5 },
  primary: { fontSize: 7.5, fontWeight: 700, color: T.ink, lineHeight: 1.1 },
  secondary: { fontSize: 6, color: T.ink3, lineHeight: 1.1 },
});

export function DualDollarValuePdf({
  value,
  nominalLabel,
  align = "right",
  emphasis = true,
}: {
  value: DollarPair;
  nominalLabel: string;
  align?: "left" | "right";
  emphasis?: boolean;
}) {
  const secondary =
    Math.round(value.today) === Math.round(value.nominal)
      ? `Same ${nominalLabel}`
      : `${exactCurrency(value.nominal)} ${nominalLabel}`;

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
      <Text style={[s.secondary, { textAlign: align }]}>{secondary}</Text>
    </View>
  );
}
