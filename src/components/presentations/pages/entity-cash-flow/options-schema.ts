import { z } from "zod";
import { rangeSchema } from "@/lib/presentations/shared/drill-options";
import type { EntityCashFlowPageOptions } from "./types";

export const entityCashFlowOptionsSchema = z.object({
  entityId: z.string(),
  entityName: z.string(),
  range: rangeSchema,
}) satisfies z.ZodType<EntityCashFlowPageOptions>;

export function summarizeEntityCashFlowOptions(o: EntityCashFlowPageOptions): string {
  const name = o.entityName || "No entity selected";
  const range = o.range === "full" ? "Full range" : `${o.range.startYear}–${o.range.endYear}`; // en-dash U+2013
  return `${name} · ${range}`;
}

export function estimateEntityCashFlowPageCount(): number {
  return 1;
}
