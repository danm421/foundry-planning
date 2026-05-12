import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clientComparisonLayouts } from "@/db/schema";
import {
  ComparisonLayoutSchema,
  ComparisonLayoutV4Schema,
  ComparisonLayoutV5Schema,
  ComparisonWidgetKindSchema,
  YearRangeSchema,
  type ComparisonLayout,
  type ComparisonLayoutV5,
} from "./layout-schema";
import { migrateV3ToV4, type MigrationContext } from "./migrate-to-v4";
import { migrateV4ToV5 } from "./migrate-v4-to-v5";

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

function parseLegacyV1Layout(raw: unknown): ComparisonLayout | null {
  const v1 = LegacyV1LayoutSchema.safeParse(raw);
  if (!v1.success) return null;
  return { version: 3, yearRange: null, items: promoteItems(v1.data.items) };
}

function parseLegacyV2Layout(raw: unknown): ComparisonLayout | null {
  const v2 = LegacyV2LayoutSchema.safeParse(raw);
  if (!v2.success) return null;
  return { version: 3, yearRange: v2.data.yearRange, items: promoteItems(v2.data.items) };
}

export function parseSavedLayout(raw: unknown, ctx: MigrationContext): ComparisonLayoutV5 | null {
  const v5 = ComparisonLayoutV5Schema.safeParse(raw);
  if (v5.success) return v5.data;

  const v4 = ComparisonLayoutV4Schema.safeParse(raw);
  if (v4.success) return migrateV4ToV5(v4.data);

  const v3 = ComparisonLayoutSchema.safeParse(raw);
  if (v3.success) return migrateV4ToV5(migrateV3ToV4(v3.data, ctx));

  const v2 = parseLegacyV2Layout(raw);
  if (v2) return migrateV4ToV5(migrateV3ToV4(v2, ctx));

  const v1 = parseLegacyV1Layout(raw);
  if (v1) return migrateV4ToV5(migrateV3ToV4(v1, ctx));

  return null;
}

function defaultV5(ctx: MigrationContext): ComparisonLayoutV5 {
  return {
    version: 5,
    title: ctx.defaultTitle ?? "Comparison Report",
    groups: [
      {
        id: globalThis.crypto.randomUUID(),
        title: "",
        cells: [{ id: globalThis.crypto.randomUUID(), span: 5, widget: null }],
      },
    ],
  };
}

export async function loadLayout(
  clientId: string,
  firmId: string,
  ctx: MigrationContext,
): Promise<ComparisonLayoutV5> {
  const rows = await db
    .select({ layout: clientComparisonLayouts.layout })
    .from(clientComparisonLayouts)
    .where(
      and(
        eq(clientComparisonLayouts.clientId, clientId),
        eq(clientComparisonLayouts.firmId, firmId),
      ),
    );

  if (rows.length === 0) return defaultV5(ctx);

  const parsed = parseSavedLayout(rows[0].layout, ctx);
  if (parsed) return parsed;

  console.warn(
    `[comparison-layout] failed to parse saved layout for client ${clientId}; falling back to default`,
  );
  return defaultV5(ctx);
}
