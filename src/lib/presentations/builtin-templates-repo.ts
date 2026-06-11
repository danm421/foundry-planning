import { db } from "@/db";
import { builtinTemplateDismissals } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function listDismissedSlugs(
  firmId: string,
  userId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ slug: builtinTemplateDismissals.builtinSlug })
    .from(builtinTemplateDismissals)
    .where(
      and(
        eq(builtinTemplateDismissals.firmId, firmId),
        eq(builtinTemplateDismissals.userId, userId),
      ),
    );
  return new Set(rows.map((r) => r.slug));
}

export async function dismissBuiltin(
  firmId: string,
  userId: string,
  slug: string,
): Promise<void> {
  await db
    .insert(builtinTemplateDismissals)
    .values({ firmId, userId, builtinSlug: slug })
    .onConflictDoNothing();
}

export async function restoreBuiltin(
  firmId: string,
  userId: string,
  slug: string,
): Promise<void> {
  await db
    .delete(builtinTemplateDismissals)
    .where(
      and(
        eq(builtinTemplateDismissals.firmId, firmId),
        eq(builtinTemplateDismissals.userId, userId),
        eq(builtinTemplateDismissals.builtinSlug, slug),
      ),
    );
}
