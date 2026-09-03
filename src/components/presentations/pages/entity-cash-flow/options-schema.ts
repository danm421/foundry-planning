import { z } from "zod";
import { rangeSchema, summarizeRange } from "@/lib/presentations/shared/drill-options";
import type { EntityCashFlowPageOptions } from "./types";

export const entityCashFlowOptionsSchema = z.object({
  entityId: z.string(),
  entityName: z.string(),
  range: rangeSchema,
}) satisfies z.ZodType<EntityCashFlowPageOptions>;

export function summarizeEntityCashFlowOptions(o: EntityCashFlowPageOptions): string {
  const name = o.entityName || "No entity selected";
  return `${name} · ${summarizeRange(o.range)}`;
}

export function estimateEntityCashFlowPageCount(): number {
  return 1;
}
