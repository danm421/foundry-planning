import { z } from "zod";
import type { LiabilityAmortizationPageOptions } from "./types";

export const liabilityAmortizationOptionsSchema = z.object({
  liabilityIds: z.array(z.string()).nullable(),
}) satisfies z.ZodType<LiabilityAmortizationPageOptions>;

export function summarizeLiabilityAmortizationOptions(o: LiabilityAmortizationPageOptions): string {
  if (o.liabilityIds == null) return "All loans";
  const n = o.liabilityIds.length;
  if (n === 0) return "No loans selected";
  return n === 1 ? "1 loan" : `${n} loans`;
}

/** An explicit pick of nothing would print nothing. */
export function isLiabilityAmortizationUnconfigured(o: LiabilityAmortizationPageOptions): boolean {
  return o.liabilityIds?.length === 0;
}
