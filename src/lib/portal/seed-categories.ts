import { db } from "@/db";
import { transactionCategories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_TAXONOMY } from "./default-categories";

/**
 * Idempotently seed the default 2-level taxonomy for a client. No-op if the
 * client already has any transaction_categories rows. Called at the top of
 * the Plaid sync (so categories exist before transactions) and lazily by the
 * categories API.
 */
export async function ensureCategoriesSeeded(clientId: string): Promise<void> {
  const existing = await db
    .select({ id: transactionCategories.id })
    .from(transactionCategories)
    .where(eq(transactionCategories.clientId, clientId))
    .limit(1);
  if (existing.length > 0) return;

  await db.transaction(async (tx) => {
    const groupRows = DEFAULT_TAXONOMY.map((g) => ({
      clientId,
      parentId: null as string | null,
      name: g.name,
      slug: g.slug,
      color: g.color,
      sortOrder: g.sortOrder,
      kind: "group" as const,
      isSystem: true,
    }));
    const inserted = await tx
      .insert(transactionCategories)
      .values(groupRows)
      .returning({ id: transactionCategories.id, slug: transactionCategories.slug });
    const groupIdBySlug = new Map<string, string>();
    for (const row of inserted) if (row.slug) groupIdBySlug.set(row.slug, row.id);

    const leafRows = DEFAULT_TAXONOMY.flatMap((g) =>
      g.leaves.map((l, i) => ({
        clientId,
        parentId: groupIdBySlug.get(g.slug)!,
        name: l.name,
        slug: l.slug,
        color: g.color,
        sortOrder: i,
        kind: "category" as const,
        isSystem: true,
      })),
    );
    await tx.insert(transactionCategories).values(leafRows).returning({ id: transactionCategories.id });
  });
}
