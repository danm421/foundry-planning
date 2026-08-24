import { Text, View, StyleSheet } from "@react-pdf/renderer";
import { exactCurrency } from "@/lib/presentations/format";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { DollarPair } from "@/lib/presentations/real-dollars";

const s = StyleSheet.create({
  wrap: { width: "100%", gap: 0.5 },
  primary: { fontSize: 7.5, fontWeight: 700, color: T.ink, lineHeight: 1.1 },
  secondary: { fontSize: 6, color: T.ink3, lineHeight: 1.1 },
});

/**
 * The deck's unit convention, in the client's own words. ONE home for it: five
 * tables print it, and three phrasings of one convention read as three
 * conventions on a deck whose whole claim is that its figures are comparable.
 */
export const DUAL_DOLLAR_UNITS =
  "today's dollars, with the future-year amount beneath";

/** "Salary in each year · today's dollars, with the future-year amount beneath" */
export function dualDollarCaption(quantity: string): string {
  return `${quantity} · ${DUAL_DOLLAR_UNITS}`;
}

/**
 * One figure in the deck's two units: today's dollars on top, the same amount
 * in the year it happens beneath.
 *
 * FOR CELLS. A hero figure — the two arm cards on the debt-or-invest sheet, the
 * bar total on the human-capital sheet — spells its units out in its own text
 * instead, because there is no column header or caption beside it to carry
 * them. Cells bare, heroes labelled.
 *
 * The units are named ONCE — by the page subtitle and by the caption over each
 * table — never inside the cell. A "today" / "future-year dollars" suffix on
 * every cell is the same six words repeated sixty times across a deck, and it
 * pushes the digits (the thing being compared down the column) off their own
 * right edge. Weight and size carry the distinction instead.
 *
 * The second line is dropped when the two round to the same number, so it
 * appears exactly where inflation has actually separated them — the starting
 * year, and every zero, print one figure.
 */
export function DualDollarValuePdf({
  value,
  align = "right",
  emphasis = true,
}: {
  value: DollarPair;
  align?: "left" | "right";
  emphasis?: boolean;
}) {
  const isSame = Math.round(value.today) === Math.round(value.nominal);

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
        {exactCurrency(value.today)}
      </Text>
      {!isSame && (
        <Text style={[s.secondary, { textAlign: align }]}>
          {exactCurrency(value.nominal)}
        </Text>
      )}
    </View>
  );
}
