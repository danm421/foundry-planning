import { z } from "zod";
import type { CashFlowPageOptions } from "@/lib/presentations/types";

const customRange = z
  .object({
    startYear: z.number().int(),
    endYear: z.number().int(),
  })
  .refine((r) => r.endYear >= r.startYear, {
    message: "endYear must be >= startYear",
  });

export const cashFlowOptionsSchema = z.object({
  range: z.union([z.literal("retirement"), z.literal("lifetime"), customRange]),
  showCallout: z.boolean(),
  calloutText: z.string().optional(),
}) satisfies z.ZodType<CashFlowPageOptions>;

export type CashFlowOptions = z.infer<typeof cashFlowOptionsSchema>;
