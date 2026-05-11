import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clientComparisonLayouts } from "@/db/schema";
import {
  ComparisonLayoutSchema,
  ComparisonWidgetKindSchema,
  YearRangeSchema,
  type ComparisonLayout,
} from "./layout-schema";
import { getDefaultLayout } from "./widgets/default-layout";

const LegacyItemSchema = z.object({
  instanceId: z.string().uuid(),
  kind: ComparisonWidgetKindSchema,
  hidden: z.boolean().optional().default(false),
  collapsed: z.boolean().optional().default(false),
  config: z.unknown().optional(),
});

const LegacyV1LayoutSchema = z.object({
  version: z.literal(1),
  items: z.array(LegacyItemSchema),
});

const LegacyV2LayoutSchema = z.object({
  version: z.literal(2),
  yearRange: YearRangeSchema.nullable(),
  items: z.array(LegacyItemSchema),
});

function promoteItems(
  items: ReadonlyArray<{ instanceId: string; kind: string; hidden?: boolean; config?: unknown }>,
) {
  return items
    .filter((i) => !i.hidden)
    .map((i) => ({
      instanceId: i.instanceId,
      kind: i.kind as ComparisonLayout["items"][number]["kind"],
      ...(i.config !== undefined ? { config: i.config } : {}),
    }));
}

export function parseLegacyV1Layout(raw: unknown): ComparisonLayout | null {
  const v1 = LegacyV1LayoutSchema.safeParse(raw);
  if (!v1.success) return null;
  return {
    version: 3,
    yearRange: null,
    items: promoteItems(v1.data.items),
  };
}

export function parseLegacyV2Layout(raw: unknown): ComparisonLayout | null {
  const v2 = LegacyV2LayoutSchema.safeParse(raw);
  if (!v2.success) return null;
  return {
    version: 3,
    yearRange: v2.data.yearRange,
    items: promoteItems(v2.data.items),
  };
}

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
  if (parsed.success) return parsed.data;

  // Lazy migration: parse legacy shapes in-memory; next save writes v3.
  const v2 = parseLegacyV2Layout(rows[0].layout);
  if (v2) return v2;

  const v1 = parseLegacyV1Layout(rows[0].layout);
  if (v1) return v1;

  console.warn(
    `[comparison-layout] failed to parse saved layout for client ${clientId}; falling back to default`,
    parsed.error.issues,
  );
  return getDefaultLayout();
}
