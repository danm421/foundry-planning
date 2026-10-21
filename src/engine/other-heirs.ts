/** The built-in Other Heirs recipient. Picked by the advisor or reached by the
 *  default order, it is one recipient: `recipientKind: "system_default"`,
 *  `recipientId: null`, removed from the household. */
export const OTHER_HEIRS_LABEL = "Other Heirs";

/** The Other Heirs recipient as a DeathTransfer names it. */
export const OTHER_HEIRS_SINK = {
  recipientKind: "system_default",
  recipientId: null,
  recipientLabel: OTHER_HEIRS_LABEL,
} as const;

/** Will recipient kinds that name no stored row — the co-client and Other
 *  Heirs — so their `recipientId` is null by design. */
export function takesNoRecipientId(kind: string): boolean {
  return kind === "spouse" || kind === "other_heirs";
}
