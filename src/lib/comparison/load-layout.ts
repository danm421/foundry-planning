import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clientComparisonLayouts } from "@/db/schema";
import {
  ComparisonLayoutSchema,
  type ComparisonLayout,
} from "./layout-schema";
import { getDefaultLayout } from "./widgets/default-layout";

export async function loadLayout(
  clientId: string,
  firmId: string,
): Promise<ComparisonLayout> {
  const rows = await db
    .select({ layout: clientComparisonLayouts.layout })
    .from(clientComparisonLayouts)
    .where(
      and(
        eq(clientComparisonLayouts.clientId, clientId),
        eq(clientComparisonLayouts.firmId, firmId),
      ),
    );

  if (rows.length === 0) return getDefaultLayout();

  const parsed = ComparisonLayoutSchema.safeParse(rows[0].layout);
  if (!parsed.success) {
    console.warn(
      `[comparison-layout] failed to parse saved layout for client ${clientId}; falling back to default`,
      parsed.error.issues,
    );
    return getDefaultLayout();
  }
  return parsed.data;
}
