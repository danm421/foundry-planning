import { cache } from "react";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { intakeForms } from "@/db/schema";

export type IntakeFormRow = typeof intakeForms.$inferSelect;

/**
 * Load a form by its public token. Wrapped in React.cache so middleware +
 * page in the same request only hit the DB once.
 */
export const loadFormByToken = cache(async (
  token: string,
): Promise<IntakeFormRow | null> => {
  const rows = await db
    .select()
    .from(intakeForms)
    .where(eq(intakeForms.token, token))
    .limit(1);
  return rows[0] ?? null;
});

/**
 * Load the active (draft or submitted) prefilled form for a client.
 */
export async function loadActivePrefilledForm(
  clientId: string,
): Promise<IntakeFormRow | null> {
  const rows = await db
    .select()
    .from(intakeForms)
    .where(
      and(
        eq(intakeForms.clientId, clientId),
        eq(intakeForms.mode, "prefilled"),
        inArray(intakeForms.status, ["draft", "submitted"]),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Load a form by ID, scoped to the given firm. Returns null if the form
 * belongs to a different firm (prevents cross-firm access).
 */
export async function loadFormForFirm(
  id: string,
  firmId: string,
): Promise<IntakeFormRow | null> {
  const rows = await db
    .select()
    .from(intakeForms)
    .where(and(eq(intakeForms.id, id), eq(intakeForms.firmId, firmId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Returns true if the client has a prefilled form in draft or submitted state.
 * Wrapped in React.cache for middleware + page deduplication.
 */
export const hasUnsubmittedPrefilledForm = cache(async (
  clientId: string,
): Promise<boolean> => {
  const rows = await db
    .select({ id: intakeForms.id })
    .from(intakeForms)
    .where(
      and(
        eq(intakeForms.clientId, clientId),
        eq(intakeForms.mode, "prefilled"),
        inArray(intakeForms.status, ["draft", "submitted"]),
      ),
    )
    .limit(1);
  return rows.length > 0;
});
