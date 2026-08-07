import { cache } from "react";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { intakeEmailSettings, intakeForms } from "@/db/schema";
import { portalCollectsNothing, type IntakeSectionKey } from "./sections";

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
 * THE one row that "the client's active intake" means. A client can hold more
 * than one — an advisor resending data collection leaves the old form active —
 * so which one is picked has to be defined, not incidental: the portal page
 * bounces a form it cannot render back to the Organizer while the proxy's soft
 * gate pushes the other way, and if the two resolved different rows that pair
 * of redirects would loop forever.
 *
 * Newest wins. The id tiebreak matters because two forms written in one
 * transaction share a `createdAt` to the microsecond.
 */
const activePrefilledFormWhere = (clientId: string) =>
  and(
    eq(intakeForms.clientId, clientId),
    eq(intakeForms.mode, "prefilled"),
    inArray(intakeForms.status, ["draft", "submitted"]),
  );
const ACTIVE_PREFILLED_ORDER = [desc(intakeForms.createdAt), desc(intakeForms.id)];

/**
 * Load the active (draft or submitted) prefilled form for a client.
 * React.cache'd so the middleware soft-route check + the page render in the
 * same request only hit the DB once, consistent with the sibling queries.
 */
export const loadActivePrefilledForm = cache(async (
  clientId: string,
): Promise<IntakeFormRow | null> => {
  const rows = await db
    .select()
    .from(intakeForms)
    .where(activePrefilledFormWhere(clientId))
    .orderBy(...ACTIVE_PREFILLED_ORDER)
    .limit(1);
  return rows[0] ?? null;
});

/**
 * Load a form by ID, scoped to the given firm. Returns null if the form
 * belongs to a different firm (prevents cross-firm access).
 * React.cache'd so the apply route's 404 guard and applyIntake's internal
 * load share one DB round-trip, consistent with the sibling queries.
 */
export const loadFormForFirm = cache(async (
  id: string,
  firmId: string,
): Promise<IntakeFormRow | null> => {
  const rows = await db
    .select()
    .from(intakeForms)
    .where(and(eq(intakeForms.id, id), eq(intakeForms.firmId, firmId)))
    .limit(1);
  return rows[0] ?? null;
});

/**
 * Returns true if the client has a prefilled form in DRAFT state (not yet
 * submitted) THAT THE PORTAL CAN ACTUALLY RENDER. Used by the middleware
 * soft-route to redirect clients to the intake page before they can access the
 * rest of the portal.
 *
 * The renderability half is not a nicety: the portal intake page bounces a form
 * it cannot render back to the Organizer, so a gate that still pushed the client
 * at /portal/intake would be an infinite redirect. This asks the SAME predicate
 * and the SAME ordering the page resolves through `loadActivePrefilledForm`, so
 * the two cannot answer about different rows — status is filtered here rather
 * than in the WHERE clause for exactly that reason. Narrow select: this runs on
 * every portal request and the row carries a whole payload.
 *
 * Wrapped in React.cache for middleware + page deduplication.
 */
export const hasUnsubmittedPrefilledForm = cache(async (
  clientId: string,
): Promise<boolean> => {
  const rows = await db
    .select({ status: intakeForms.status, sections: intakeForms.sections })
    .from(intakeForms)
    .where(activePrefilledFormWhere(clientId))
    .orderBy(...ACTIVE_PREFILLED_ORDER)
    .limit(1);
  const form = rows[0];
  return form?.status === "draft" && !portalCollectsNothing(form.sections);
});

/**
 * Load the most recent submitted form for a client, scoped to the given firm.
 * Used by the advisor's portal-management page to show a "pending review" indicator.
 * React.cache'd for per-request dedup, consistent with the sibling queries.
 */
export const loadSubmittedFormForClient = cache(
  async (clientId: string, firmId: string): Promise<IntakeFormRow | null> => {
    const rows = await db
      .select()
      .from(intakeForms)
      .where(
        and(
          eq(intakeForms.clientId, clientId),
          eq(intakeForms.firmId, firmId),
          eq(intakeForms.status, "submitted"),
        ),
      )
      .orderBy(desc(intakeForms.createdAt))
      .limit(1);
    return rows[0] ?? null;
  },
);

/**
 * List all intake forms for a firm, newest first.
 * React.cache'd for per-request dedup, consistent with the sibling queries.
 */
export const listFormsForFirm = cache(
  async (firmId: string): Promise<IntakeFormRow[]> =>
    db
      .select()
      .from(intakeForms)
      .where(eq(intakeForms.firmId, firmId))
      .orderBy(desc(intakeForms.createdAt)),
);

/**
 * The advisor's saved default section set, or null when they never set one.
 *
 * Read only where a form is being COMPOSED — the send cards and the preview.
 * A form row's own `sections` is a snapshot taken at send time, so nothing on a
 * render or apply path may ever resolve sections from here instead.
 */
export const loadAdvisorDefaultSections = cache(
  async (firmId: string, userId: string): Promise<IntakeSectionKey[] | null> => {
    const rows = await db
      .select({ sections: intakeEmailSettings.sections })
      .from(intakeEmailSettings)
      .where(
        and(eq(intakeEmailSettings.firmId, firmId), eq(intakeEmailSettings.userId, userId)),
      )
      .limit(1);
    return rows[0]?.sections ?? null;
  },
);
