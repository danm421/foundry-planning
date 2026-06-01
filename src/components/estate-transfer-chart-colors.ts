import type { RecipientTotal } from "@/lib/estate/transfer-report";
import { colors, data, dataLight } from "@/brand";

// Per-recipient-kind categorical palettes, sourced from the editorial brand
// palette. This chart can show ~19 distinct recipients at once — more than the
// nine named hues — so the deeper `dataLight` variants fill the extra slots:
// every entry is a brand hue and the whole set is mutually distinct.
// (Light-theme recoloring of this chart is deferred — see future-work/ui.md;
// it renders on its dark report canvas today.)
const PALETTES: Record<RecipientTotal["recipientKind"], readonly string[]> = {
  spouse: [data.violet],
  family_member: [
    data.slate,
    data.emerald,
    data.indigo,
    data.sage,
    data.terra,
    data.rose,
    data.amber,
  ],
  external_beneficiary: [
    dataLight.terra,
    dataLight.rose,
    dataLight.amber,
    dataLight.wheat,
    dataLight.slate,
    dataLight.emerald,
  ],
  entity: [dataLight.violet, dataLight.indigo, dataLight.sage, data.wheat],
  system_default: [colors.ink4],
};

export function assignRecipientColors(
  totals: RecipientTotal[],
): Record<string, string> {
  const counts: Record<RecipientTotal["recipientKind"], number> = {
    spouse: 0,
    family_member: 0,
    external_beneficiary: 0,
    entity: 0,
    system_default: 0,
  };
  const out: Record<string, string> = {};
  for (const t of totals) {
    const palette = PALETTES[t.recipientKind];
    const idx = counts[t.recipientKind] % palette.length;
    out[t.key] = palette[idx];
    counts[t.recipientKind] += 1;
  }
  return out;
}
