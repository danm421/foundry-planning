import type { RecipientTotal } from "@/lib/estate/transfer-report";

const PALETTES: Record<RecipientTotal["recipientKind"], readonly string[]> = {
  spouse: ["#a78bfa"],
  family_member: [
    "#2563eb",
    "#0891b2",
    "#16a34a",
    "#0ea5e9",
    "#14b8a6",
    "#22c55e",
    "#3b82f6",
  ],
  external_beneficiary: [
    "#f59e0b",
    "#ea580c",
    "#e11d48",
    "#f97316",
    "#fb7185",
    "#facc15",
  ],
  entity: ["#9333ea", "#a855f7", "#7c3aed", "#c084fc"],
  system_default: ["#6b7280"],
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
