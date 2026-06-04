// src/lib/presentations/pages/cash-flow/options-schema.ts
import { z } from "zod";
import type { CashFlowPageOptions } from "@/lib/presentations/types";
import { rangeSchema } from "@/lib/presentations/shared/drill-options";

export const cashFlowOptionsSchema = z.object({
  range: rangeSchema,
  showCallout: z.boolean(),
  calloutText: z.string().optional(),
}) satisfies z.ZodType<CashFlowPageOptions>;

export type CashFlowOptions = z.infer<typeof cashFlowOptionsSchema>;
