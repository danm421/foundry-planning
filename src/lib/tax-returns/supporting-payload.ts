import { z } from "zod";

/**
 * Role-specific data that is NOT 1040 facts. A W-2's employer and box 1 has no
 * home in `TaxReturnFacts` because line 1a is the total across every W-2 — one
 * form can never state it, and D6 forbids a W-2 from writing that aggregate
 * anyway. The review form reads these to populate the K-1 wage-assignment
 * dropdown (D10).
 */
export const w2PairSchema = z
  .object({
    employer: z.string().nullable().default(null),
    wages: z.number().finite().nullable().default(null),
  })
  .strict();

export const supportingPayloadSchema = z
  .object({
    w2s: z.array(w2PairSchema).default([]),
  })
  .strict();

export type W2Pair = z.infer<typeof w2PairSchema>;
export type SupportingPayload = z.infer<typeof supportingPayloadSchema>;

/** Same posture as `rowToMergeDocument`: a payload that no longer satisfies the
 *  schema contributes nothing rather than failing the whole year. */
export function parseSupportingPayload(value: unknown): SupportingPayload {
  const parsed = supportingPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : { w2s: [] };
}
