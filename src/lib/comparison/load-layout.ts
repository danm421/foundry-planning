import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clientComparisons } from "@/db/schema";
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

export function defaultV5(ctx: MigrationContext): ComparisonLayoutV5 {
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

export interface ComparisonSummary {
  id: string;
  name: string;
}

export async function listClientComparisons(
  clientId: string,
  firmId: string,
): Promise<ComparisonSummary[]> {
  return db
    .select({ id: clientComparisons.id, name: clientComparisons.name })
    .from(clientComparisons)
    .where(
      and(
        eq(clientComparisons.clientId, clientId),
        eq(clientComparisons.firmId, firmId),
      ),
    )
    .orderBy(asc(clientComparisons.name));
}

export interface LoadedComparison {
  id: string;
  name: string;
  layout: ComparisonLayoutV5;
}

export async function loadComparison(
  comparisonId: string,
  clientId: string,
  firmId: string,
  ctx: MigrationContext,
): Promise<LoadedComparison | null> {
  const [row] = await db
    .select()
    .from(clientComparisons)
    .where(
      and(
        eq(clientComparisons.id, comparisonId),
        eq(clientComparisons.clientId, clientId),
        eq(clientComparisons.firmId, firmId),
      ),
    );
  if (!row) return null;

  const parsed = parseSavedLayout(row.layout, ctx);
  if (parsed) return { id: row.id, name: row.name, layout: parsed };

  console.warn(
    `[client-comparison] failed to parse saved layout for comparison ${comparisonId}; falling back to default`,
  );
  return { id: row.id, name: row.name, layout: defaultV5(ctx) };
}
